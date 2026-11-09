import "server-only";
import { NextResponse } from "next/server";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: { fields?: Record<string, string>; current?: unknown },
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Cookie, Origin, Sec-Fetch-Site",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function handle(operation: () => Promise<NextResponse>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) {
      return json({
        error: { code: error.code, message: error.message, ...error.details },
      }, error.status);
    }
    // Never serialize or log SQL, credentials, owner identifiers or input.
    return json({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "No se pudo confirmar la operación. Conserva tus cambios y vuelve a intentarlo.",
      },
    }, 503);
  }
}

export function invalid(fields: Record<string, string>): never {
  throw new ApiError(400, "INVALID_INPUT", "Revisa los campos indicados.", { fields });
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    invalid({ body: "Envía un objeto JSON." });
  }
  // Bound streaming input, including requests with no Content-Length.
  const reader = request.body?.getReader();
  if (!reader) invalid({ body: "Envía un objeto JSON." });
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 16384) {
        // A transport cancellation failure must not turn a known invalid
        // payload into an uncertain server failure.
        try { await reader.cancel(); } catch { /* The size violation is known. */ }
        invalid({ body: "La solicitud es demasiado grande." });
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  let parsed: unknown;
  try {
    // Buffer.toString silently substitutes malformed UTF-8. Reject it instead
    // of persisting text different from the visitor's submitted bytes.
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    invalid({ body: "Envía un objeto JSON válido." });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    invalid({ body: "Envía un objeto JSON." });
  }
  return parsed as Record<string, unknown>;
}
