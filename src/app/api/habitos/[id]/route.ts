import { mutateHabit } from "@/lib/server/habits";
import { body, handle, json } from "@/lib/server/http";
import { requireOwner } from "@/lib/server/session";
import { validate, validateId } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

async function mutation(request: Request, context: Context, kind: "edit" | "delete") {
  return handle(async () => {
    const owner = requireOwner(request, true);
    const { id } = await context.params;
    validateId(id);
    const input = validate(await body(request), kind);
    const saved = await mutateHabit(owner, id, kind, input);
    return json({ result: saved.result }, saved.status);
  });
}
export async function PATCH(request: Request, context: Context) {
  return mutation(request, context, "edit");
}
export async function DELETE(request: Request, context: Context) {
  return mutation(request, context, "delete");
}
