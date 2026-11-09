import "server-only";
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { type NextResponse } from "next/server";
import { ApiError } from "./http";

const COOKIE = "pulso_session";

function key() {
  const secret = process.env.TURSO_AUTH_TOKEN;
  if (!secret) throw new Error("Session configuration unavailable");
  return Buffer.from(hkdfSync("sha256", secret, "pulso", "pulso/session/v1", 32));
}

function signature(identity: string) {
  return createHmac("sha256", key()).update(`pulso/session/v1\0${identity}`).digest("base64url");
}

function trustedOrigins(): Set<string> {
  const values = [
    process.env.APP_ORIGIN,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ];
  const origins = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
          url.pathname === "/" && !url.search && !url.hash) origins.add(url.origin);
    } catch { /* An invalid trusted configuration never grants access. */ }
  }
  return origins;
}

export function checkOrigin(request: Request, mutation = false) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (origin !== null) {
    if (!trustedOrigins().has(origin)) {
      throw new ApiError(403, "ORIGIN_FORBIDDEN", "El origen de la solicitud no está permitido.");
    }
  } else if (mutation || (site !== null && site !== "same-origin")) {
    throw new ApiError(403, "ORIGIN_FORBIDDEN", "El origen de la solicitud no está permitido.");
  }
  // Even an allowed Origin cannot override explicitly cross-site metadata.
  if (site === "cross-site" || site === "same-site") {
    throw new ApiError(403, "ORIGIN_FORBIDDEN", "El origen de la solicitud no está permitido.");
  }
}

function credential(request: Request): string | null {
  const values = (request.headers.get("cookie") ?? "").split(";")
    .map((part) => part.trim()).filter((part) => part.startsWith(`${COOKIE}=`));
  if (values.length !== 1) return null;
  return values[0].slice(COOKIE.length + 1);
}

export function hasSessionCookie(request: Request): boolean {
  return (request.headers.get("cookie") ?? "").split(";")
    .some((part) => part.trim().startsWith(`${COOKIE}=`));
}

export function owner(request: Request): string | null {
  const token = credential(request);
  if (!token || !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [identity, supplied] = token.split(".");
  // Require canonical base64url encoding as well as a constant-time MAC match.
  if (Buffer.from(identity, "base64url").toString("base64url") !== identity) return null;
  const expected = Buffer.from(signature(identity), "ascii");
  const actual = Buffer.from(supplied, "ascii");
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) return null;
  return createHmac("sha256", key()).update(`pulso/owner/v1\0${identity}`).digest("hex");
}

export function requireOwner(request: Request, mutation = false): string {
  checkOrigin(request, mutation);
  const result = owner(request);
  if (!result) throw new ApiError(401, "SESSION_REQUIRED", "No se pudo verificar tu sesión. Reintenta en el contexto original.");
  return result;
}

export function establishSession(request: Request, response: NextResponse) {
  const identity = randomBytes(32).toString("base64url");
  // Mutations already passed trusted-Origin validation. Never infer HTTPS
  // from arbitrary forwarded headers or from a caller-supplied Host.
  const secure = new URL(request.headers.get("origin")!).protocol === "https:";
  response.cookies.set({
    name: COOKIE,
    value: `${identity}.${signature(identity)}`,
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    partitioned: secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
