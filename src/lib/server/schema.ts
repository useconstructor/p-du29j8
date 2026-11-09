import "server-only";
import { type Transaction } from "@libsql/client";
import { db } from "@/lib/db";

let ready: Promise<void> | undefined;

// Match ECMAScript String.trim without altering the stored name. SQLite's
// default trim only handles U+0020; byte length also preserves embedded NUL.
const WHITESPACE = "char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)";
const HABIT_COLUMNS = "id,owner_hash,nombre,categoria,meta_semanal,version,clave_creacion,metadatos,created_at,updated_at";
const RECORD_COLUMNS = "id,habito_id,fecha,created_at";

// Names below are internal literals, never supplied by a request.
function habitTable(name: "habitos" | "habitos_schema_v2") {
  return `CREATE TABLE IF NOT EXISTS ${name} (
    id TEXT PRIMARY KEY NOT NULL,
    owner_hash TEXT NOT NULL,
    nombre TEXT,
    categoria TEXT,
    meta_semanal INTEGER,
    version INTEGER NOT NULL CHECK(typeof(version) = 'integer' AND version >= 1 AND version <= 9007199254740991),
    clave_creacion TEXT NOT NULL,
    metadatos TEXT NOT NULL CHECK(json_valid(metadatos)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(owner_hash, clave_creacion),
    CHECK (
      (json_extract(metadatos, '$.deleted') = 1
        AND nombre IS NULL AND categoria IS NULL AND meta_semanal IS NULL)
      OR
      (json_extract(metadatos, '$.deleted') = 0
        AND nombre IS NOT NULL AND typeof(nombre) = 'text'
        AND length(CAST(nombre AS BLOB)) BETWEEN 1 AND 240
        AND length(CAST(trim(nombre, ${WHITESPACE}) AS BLOB)) > 0
        AND categoria IS NOT NULL AND categoria IN ('Movimiento', 'Calma', 'Aprendizaje')
        AND meta_semanal IS NOT NULL AND typeof(meta_semanal) = 'integer'
        AND meta_semanal BETWEEN 1 AND 7)
    ),
    CHECK(COALESCE(json_type(metadatos, '$.deleted') IN ('true', 'false'), 0)),
    CHECK(COALESCE(json_type(metadatos, '$.operations') = 'array', 0))
  )`;
}

function recordTable(name: "registros_habito" | "registros_habito_schema_v2", parent: "habitos" | "habitos_schema_v2") {
  return `CREATE TABLE IF NOT EXISTS ${name} (
    id TEXT PRIMARY KEY NOT NULL,
    habito_id TEXT NOT NULL REFERENCES ${parent}(id) ON DELETE CASCADE,
    fecha TEXT NOT NULL CHECK (
      length(fecha) = 10 AND fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(fecha, '+0 days') IS NOT NULL AND date(fecha, '+0 days') = fecha
    ),
    created_at TEXT NOT NULL,
    UNIQUE(habito_id, fecha)
  )`;
}

async function upgradeNameConstraint(tx: Transaction) {
  const schema = await tx.execute({
    sql: "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: ["habitos"],
  });
  if (!String(schema.rows[0]?.sql).includes("length(replace(nombre, char(0), 'x'))")) return;

  // The old CHECK counted only the prefix before NUL. Rebuild both related
  // tables in one write transaction, copying every column without normalization.
  // Copy children before dropping the old parent so ON DELETE CASCADE can
  // never erase the only copy. Any failure rolls the complete migration back.
  const shadows = await tx.execute(
    "SELECT name FROM sqlite_master WHERE name IN ('habitos_schema_v2','registros_habito_schema_v2')",
  );
  if (shadows.rows.length) throw new Error("Unexpected migration objects");
  await tx.execute(habitTable("habitos_schema_v2"));
  await tx.execute(`INSERT INTO habitos_schema_v2 (${HABIT_COLUMNS}) SELECT ${HABIT_COLUMNS} FROM habitos`);
  await tx.execute(recordTable("registros_habito_schema_v2", "habitos_schema_v2"));
  await tx.execute(`INSERT INTO registros_habito_schema_v2 (${RECORD_COLUMNS}) SELECT ${RECORD_COLUMNS} FROM registros_habito`);
  for (const [original, replacement, columns] of [
    ["habitos", "habitos_schema_v2", HABIT_COLUMNS],
    ["registros_habito", "registros_habito_schema_v2", RECORD_COLUMNS],
  ]) {
    const difference = await tx.execute(`SELECT
      EXISTS(SELECT ${columns} FROM ${original} EXCEPT SELECT ${columns} FROM ${replacement})
      OR EXISTS(SELECT ${columns} FROM ${replacement} EXCEPT SELECT ${columns} FROM ${original}) AS changed`);
    if (Number(difference.rows[0]?.changed) !== 0) throw new Error("Migration copy differs");
  }
  await tx.execute("DROP TABLE registros_habito");
  await tx.execute("DROP TABLE habitos");
  await tx.execute("ALTER TABLE habitos_schema_v2 RENAME TO habitos");
  await tx.execute("ALTER TABLE registros_habito_schema_v2 RENAME TO registros_habito");
}

function nameGuard(event: "INSERT" | "UPDATE") {
  // SQLite length(TEXT) stops at NUL. Count the leading bytes of UTF-8 code
  // points instead; continuation bytes begin with hex 8, 9, A or B.
  // The table's 240-byte CHECK bounds this recursion even for direct SQL.
  return `CREATE TRIGGER IF NOT EXISTS habitos_name_${event.toLowerCase()}_v2
    BEFORE ${event} ON habitos
    WHEN json_extract(NEW.metadatos, '$.deleted') = 0
    BEGIN
      SELECT CASE WHEN (
        WITH RECURSIVE bytes(position) AS (
          SELECT 1
          UNION ALL SELECT position + 2 FROM bytes
            WHERE position + 2 <= min(length(hex(CAST(NEW.nombre AS BLOB))), 480)
        )
        SELECT count(*) FROM bytes
          WHERE substr(hex(CAST(NEW.nombre AS BLOB)), position, 1) NOT IN ('8','9','A','B')
      ) > 60 THEN RAISE(ABORT, 'Invalid habit name length') END;
    END`;
}

// Bootstrap is intentionally separate from /api/health and session inspection.
// No seed, cleanup, session table or modification of unrelated records occurs.
export function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await db.execute("PRAGMA foreign_keys = ON");
      const tx = await db.transaction("write");
      try {
        const foreignKeys = await tx.execute("PRAGMA foreign_keys");
        if (Number(foreignKeys.rows[0]?.foreign_keys) !== 1) throw new Error("Foreign keys unavailable");
        await tx.execute(habitTable("habitos"));
        await tx.execute(recordTable("registros_habito", "habitos"));
        await upgradeNameConstraint(tx);
        await tx.execute(nameGuard("INSERT"));
        await tx.execute(nameGuard("UPDATE"));
        await tx.execute("CREATE INDEX IF NOT EXISTS habitos_owner_created ON habitos(owner_hash, created_at, id)");
        const violations = await tx.execute("PRAGMA foreign_key_check");
        if (violations.rows.length) throw new Error("Foreign key integrity unavailable");
        await tx.commit();
      } catch (error) {
        if (!tx.closed) {
          try { await tx.rollback(); } catch { /* Preserve the original error. */ }
        }
        throw error;
      } finally {
        tx.close();
      }
    })().catch((error) => {
      ready = undefined;
      throw error;
    });
  }
  return ready;
}
