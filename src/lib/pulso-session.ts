"use client";

export class SessionProblem extends Error {}
let knownInThisDocument = false;

async function inspect() {
  const response = await fetch("/api/session", {
    credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(12000),
  });
  if (response.status === 401) return false;
  if (!response.ok) throw new Error("No se pudo comprobar el acceso. Reintenta.");
  const body = await response.json();
  if (body.authenticated !== true) throw new Error("No se pudo comprobar el acceso.");
  return true;
}

function contextMarker() {
  if (window.self === window.top) return "pulso:context:v1:direct";
  let parentOrigin: string | null = null;
  try { parentOrigin = window.top?.location.origin ?? null; } catch { /* Cross-site parent. */ }
  const ancestors = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  if (!parentOrigin && ancestors?.length) parentOrigin = ancestors[ancestors.length - 1];
  // A referrer may identify an immediate frame, not the actual top-level partition.
  // Do not infer an unseen top-level site from it.
  return parentOrigin ? `pulso:context:v1:embedded:${parentOrigin}` : null;
}

export async function establishSession(restart = false) {
  if (!navigator.locks?.request)
    throw new SessionProblem("Este navegador no permite coordinar el acceso de forma segura. Abre Pulso directamente en un navegador compatible.");
  return navigator.locks.request("pulso:session:v1", { mode: "exclusive" }, async () => {
    const marker = contextMarker();
    let known = false;
    let ambiguous = !marker;
    try {
      const probe = "pulso:storage-probe";
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
      sessionStorage.setItem(probe, "1");
      sessionStorage.removeItem(probe);
      known = knownInThisDocument || (marker ? localStorage.getItem(marker) === "known" : false);
      // Legacy unscoped evidence can never authorize a fresh owner.
      ambiguous ||= !!localStorage.getItem("pulso:context") || !!localStorage.getItem("pulso-owner-known");
    } catch {
      throw new SessionProblem("El almacenamiento necesario está bloqueado. Permítelo y reintenta, o abre Pulso directamente.");
    }
    if (await inspect()) {
      knownInThisDocument = true;
      if (marker) localStorage.setItem(marker, "known");
      return;
    }
    if ((known || ambiguous) && !restart)
      throw new SessionProblem("No encontramos la sesión anterior en este contexto. Vuelve al contexto original para recuperarla. No crearemos otro contexto automáticamente.");
    // An attempted initialization may commit even if the response is lost.
    // Retain expectation before sending, including in this mounted document.
    knownInThisDocument = true;
    if (marker) localStorage.setItem(marker, "known");
    const response = await fetch("/api/session", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: restart ? "restart" : "initialize" }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new SessionProblem("No se pudo establecer el acceso. Reintenta en este contexto.");
    if (!await inspect())
      throw new SessionProblem("Las cookies necesarias pueden estar bloqueadas. No podemos acceder a tus hábitos.");
  });
}
