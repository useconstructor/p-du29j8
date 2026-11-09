import { mutateHabit } from "@/lib/server/habits";
import { body, handle, json } from "@/lib/server/http";
import { requireOwner } from "@/lib/server/session";
import { validate, validateId } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const owner = requireOwner(request, true);
    const { id } = await context.params;
    validateId(id);
    const input = validate(await body(request), "record");
    const saved = await mutateHabit(owner, id, "record", input);
    return json({ result: saved.result }, saved.status);
  });
}
