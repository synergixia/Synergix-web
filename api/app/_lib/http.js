/**
 * HTTP helpers for the authenticated app API (/api/app/*)
 * ─────────────────────────────────────────────────────────────────────────────
 * These endpoints carry a session cookie, so they must NOT share the permissive
 * CORS policy of /api/mcp and /api/a2a. Those two are public, credential-less
 * agent surfaces where `*` is correct; here `*` plus cookies would be CSRF
 * served on a plate.
 */

const DEFAULT_ORIGINS = [
  "https://www.synergix.lol",
  "https://synergix.lol"
];

/** Origins allowed to call the app API with credentials. */
export function allowedOrigins() {
  const extra = (process.env.APP_ORIGIN || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ORIGINS, ...extra])];
}

/**
 * Applies the credentialed CORS policy. Echoes the origin only when it is on
 * the allowlist — never a wildcard, because wildcards and cookies cannot mix.
 * Returns false when the request came from an origin we do not accept.
 */
export function applyCors(req, res) {
  const origin = req.headers.origin;
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");

  if (!origin) return true; // same-origin / server-side call: no CORS needed

  if (allowedOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
    return true;
  }
  return false;
}

/**
 * Cross-origin write protection. SameSite=Lax already blocks most of this, but
 * an explicit Origin check is the part that does not depend on browser defaults.
 * Only enforced for state-changing methods.
 */
export function originAllowed(req) {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser client (curl, server-to-server)
  return allowedOrigins().includes(origin);
}

export function fail(res, status, code, message, extra = {}) {
  return res.status(status).json({ error: { code, message, ...extra } });
}

export function ok(res, payload) {
  return res.status(200).json(payload);
}

/** Parses a JSON body whether the platform pre-parsed it or not. */
export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Shared entry guard: CORS, preflight, method allowlist and CSRF-by-origin.
 * Returns true when the handler should stop (response already sent).
 */
export function guard(req, res, methods) {
  if (!applyCors(req, res)) {
    fail(res, 403, "origin_not_allowed", "Origin not allowed");
    return true;
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  if (!methods.includes(req.method)) {
    res.setHeader("Allow", methods.join(", "));
    fail(res, 405, "method_not_allowed", `Use ${methods.join(" or ")}`);
    return true;
  }
  if (!originAllowed(req)) {
    fail(res, 403, "bad_origin", "Cross-origin write rejected");
    return true;
  }
  return false;
}
