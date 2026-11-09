import { db } from "@/lib/db";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // A connection read only: no schema bootstrap, cookie or private query.
    await db.execute("SELECT 1 AS ok");
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 503);
  }
}
