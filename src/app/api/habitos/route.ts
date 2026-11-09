import { createHabit, listing } from "@/lib/server/habits";
import { body, handle, json } from "@/lib/server/http";
import { requireOwner } from "@/lib/server/session";
import { validate } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => json(await listing(requireOwner(request))));
}

export async function POST(request: Request) {
  return handle(async () => {
    const owner = requireOwner(request, true);
    const input = validate(await body(request), "create");
    const saved = await createHabit(owner, input);
    return json({ result: saved.result }, saved.status);
  });
}
