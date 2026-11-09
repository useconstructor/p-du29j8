import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { type Row, type Transaction } from "@libsql/client";
import { db } from "@/lib/db";
import { calendar } from "./calendar";
import { ApiError, invalid } from "./http";
import { ensureSchema } from "./schema";
import { type Category, type Kind, type Operation } from "./validation";

export type Habit = {
  id: string; nombre: string; categoria: Category; meta_semanal: number;
  version: number; created_at: string; updated_at: string;
};
type RecordEntry = { id: string; habito_id: string; fecha: string; created_at: string };
type Result = { id: string; version: number; deleted?: true };
type Entry = { clave: string; tipo: Kind; huella: string; result: Result; status: number };
type Metadata = { creationFingerprint: string; operations: Entry[]; deleted: boolean; deletedAt?: string };
type Stored = Habit & { metadatos: string };
const COLUMNS = "id,nombre,categoria,meta_semanal,version,created_at,updated_at,metadatos";

function habit(row: Row): Habit {
  return {
    id: String(row.id), nombre: String(row.nombre), categoria: row.categoria as Category,
    meta_semanal: Number(row.meta_semanal), version: Number(row.version),
    created_at: String(row.created_at), updated_at: String(row.updated_at),
  };
}
function record(row: Row): RecordEntry {
  return {
    id: String(row.id), habito_id: String(row.habito_id),
    fecha: String(row.fecha), created_at: String(row.created_at),
  };
}
function stored(row: Row): Stored {
  return { ...habit(row), metadatos: String(row.metadatos) };
}
function metadata(row: Stored): Metadata {
  const parsed = JSON.parse(row.metadatos) as Metadata;
  if (!parsed || typeof parsed.deleted !== "boolean" || !Array.isArray(parsed.operations)) {
    throw new Error("Invalid operation metadata");
  }
  return parsed;
}
function fingerprint(kind: Kind, id: string | undefined, input: Operation): string {
  // validate() supplies stable property ordering independent of caller ordering.
  return createHash("sha256").update(JSON.stringify({ kind, id: id ?? null, input })).digest("hex");
}
function replay(meta: Metadata, input: Operation, hash: string): Entry | undefined {
  const previous = meta.operations.find((entry) => entry.clave === input.clave);
  if (previous && previous.huella !== hash) {
    throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Esta clave ya corresponde a otra operación. Recupera el envío original.");
  }
  return previous;
}
function notFound(): never {
  throw new ApiError(404, "NOT_FOUND", "No se encontró el hábito.");
}

async function transaction<T>(mode: "read" | "write", operation: (tx: Transaction) => Promise<T>): Promise<T> {
  await ensureSchema();
  const tx = await db.transaction(mode);
  try {
    // Fail closed if the actual connection cannot enforce the declared FK.
    const foreignKeys = await tx.execute("PRAGMA foreign_keys");
    if (Number(foreignKeys.rows[0]?.foreign_keys) !== 1) throw new Error("Foreign keys unavailable");
    const result = await operation(tx);
    await tx.commit();
    return result;
  } catch (error) {
    if (!tx.closed) {
      try { await tx.rollback(); } catch { /* Keep the original failure. */ }
    }
    throw error;
  } finally {
    tx.close();
  }
}

async function records(tx: Transaction, ownerHash: string, context: ReturnType<typeof calendar>, id?: string) {
  const result = await tx.execute({
    sql: `SELECT r.id,r.habito_id,r.fecha,r.created_at FROM registros_habito r
      JOIN habitos h ON h.id = r.habito_id
      WHERE h.owner_hash = ? AND json_extract(h.metadatos, '$.deleted') = 0
        AND r.fecha BETWEEN ? AND ? ${id ? "AND h.id = ?" : ""}
      ORDER BY r.fecha,r.habito_id`,
    args: id ? [ownerHash, context.weekStart, context.weekEnd, id] : [ownerHash, context.weekStart, context.weekEnd],
  });
  return result.rows.map(record);
}

export async function listing(ownerHash: string) {
  return transaction("read", async (tx) => {
    const context = calendar();
    const result = await tx.execute({
      sql: `SELECT ${COLUMNS} FROM habitos WHERE owner_hash = ?
        AND json_extract(metadatos, '$.deleted') = 0 ORDER BY created_at,id`,
      args: [ownerHash],
    });
    return { habitos: result.rows.map(habit), registros: await records(tx, ownerHash, context), context };
  });
}

export async function createHabit(ownerHash: string, input: Operation) {
  const hash = fingerprint("create", undefined, input);
  return transaction("write", async (tx) => {
    const found = await tx.execute({
      sql: `SELECT ${COLUMNS} FROM habitos WHERE owner_hash = ? AND clave_creacion = ?`,
      args: [ownerHash, input.clave],
    });
    if (found.rows[0]) {
      const previous = replay(metadata(stored(found.rows[0])), input, hash);
      if (!previous) throw new Error("Missing creation operation");
      return { result: previous.result, status: previous.status };
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const result: Result = { id, version: 1 };
    const entry: Entry = { clave: input.clave, tipo: "create", huella: hash, result, status: 201 };
    const meta: Metadata = { creationFingerprint: hash, operations: [entry], deleted: false };
    await tx.execute({
      sql: `INSERT INTO habitos
        (id,owner_hash,nombre,categoria,meta_semanal,version,clave_creacion,metadatos,created_at,updated_at)
        VALUES (?,?,?,?,?,1,?,?,?,?)`,
      args: [id, ownerHash, input.nombre!, input.categoria!, input.meta_semanal!,
        input.clave, JSON.stringify(meta), now, now],
    });
    return { result, status: 201 };
  });
}

export async function mutateHabit(ownerHash: string, id: string, kind: Exclude<Kind, "create">, input: Operation) {
  const hash = fingerprint(kind, id, input);
  return transaction("write", async (tx) => {
    const found = await tx.execute({
      sql: `SELECT ${COLUMNS} FROM habitos WHERE id = ? AND owner_hash = ?`,
      args: [id, ownerHash],
    });
    if (!found.rows[0]) notFound();
    const current = stored(found.rows[0]);
    const meta = metadata(current);
    // Lookup happens before deleted/version/calendar checks so a known,
    // committed request remains recoverable after later edits or rollover.
    const previous = replay(meta, input, hash);
    if (previous) return { result: previous.result, status: previous.status };
    if (meta.deleted) notFound();
    const context = calendar();
    if (kind === "record" && (input.fecha! > context.today ||
        input.fecha! < context.weekStart || input.fecha! > context.weekEnd)) {
      invalid({ fecha: "Elige un día no futuro de la semana actual." });
    }
    if (current.version !== input.version) {
      throw new ApiError(409, "VERSION_CONFLICT", "El hábito cambió en otra vista. Elige qué valores conservar.", {
        current: { habito: habit(found.rows[0]), registros: await records(tx, ownerHash, context, id) },
      });
    }
    if (current.version >= Number.MAX_SAFE_INTEGER) {
      throw new ApiError(409, "VERSION_CONFLICT", "No se puede avanzar la versión del hábito.", {
        current: { habito: habit(found.rows[0]), registros: await records(tx, ownerHash, context, id) },
      });
    }
    const now = new Date().toISOString();
    const version = current.version + 1;
    const result: Result = { id, version, ...(kind === "delete" ? { deleted: true as const } : {}) };
    meta.operations.push({ clave: input.clave, tipo: kind, huella: hash, result, status: 200 });
    if (kind === "delete") {
      meta.deleted = true;
      meta.deletedAt = now;
      await tx.execute({ sql: "DELETE FROM registros_habito WHERE habito_id = ?", args: [id] });
    } else if (kind === "record") {
      if (input.completado) {
        await tx.execute({
          sql: `INSERT INTO registros_habito (id,habito_id,fecha,created_at) VALUES (?,?,?,?)
            ON CONFLICT(habito_id,fecha) DO NOTHING`,
          args: [randomUUID(), id, input.fecha!, now],
        });
      } else {
        await tx.execute({ sql: "DELETE FROM registros_habito WHERE habito_id = ? AND fecha = ?", args: [id, input.fecha!] });
      }
    }
    const update = await tx.execute({
      sql: `UPDATE habitos SET nombre = ?,categoria = ?,meta_semanal = ?,version = ?,metadatos = ?,updated_at = ?
        WHERE id = ? AND owner_hash = ? AND version = ?`,
      args: [
        kind === "delete" ? null : kind === "edit" ? input.nombre! : current.nombre,
        kind === "delete" ? null : kind === "edit" ? input.categoria! : current.categoria,
        kind === "delete" ? null : kind === "edit" ? input.meta_semanal! : current.meta_semanal,
        version, JSON.stringify(meta), now, id, ownerHash, current.version,
      ],
    });
    if (update.rowsAffected !== 1) throw new Error("Atomic update unavailable");
    return { result, status: 200 };
  });
}
