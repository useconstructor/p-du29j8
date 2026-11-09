import { listing } from "@/lib/server/habits";
import { handle, json } from "@/lib/server/http";
import { requireOwner } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => json(await listing(requireOwner(request))));
}
