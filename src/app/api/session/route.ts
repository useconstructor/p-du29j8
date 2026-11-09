import { ApiError, body, handle, invalid, json } from "@/lib/server/http";
import { checkOrigin, establishSession, hasSessionCookie, owner, requireOwner } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    requireOwner(request);
    return json({ authenticated: true });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request, true);
    const input = await body(request);
    const errors: Record<string, string> = Object.create(null);
    for (const field of Object.keys(input)) {
      if (field !== "action") errors[field] = "Este campo no está permitido.";
    }
    if (input.action !== "initialize" && input.action !== "restart") errors.action = "Elige initialize o restart.";
    if (Object.keys(errors).length) invalid(errors);
    if (owner(request)) return json({ authenticated: true });
    if (hasSessionCookie(request) && input.action !== "restart") {
      throw new ApiError(401, "SESSION_REQUIRED", "No se pudo verificar tu sesión anterior. Reintenta antes de comenzar un contexto nuevo.");
    }
    const response = json({ authenticated: true });
    establishSession(request, response);
    return response;
  });
}
