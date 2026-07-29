/**
 * Session handling for /api/app/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Stateless signed sessions (HS256) so the web tier needs no session store.
 * Implemented on node:crypto — no dependency added to the project.
 *
 * Trade-off worth knowing: statelessness means a token stays valid until it
 * expires, so lifetimes are deliberately short. Immediate revocation ("log me
 * out everywhere" from the bot) requires a shared deny-list — see SESSION_TTL
 * and the note in revoke().
 */

import crypto from "node:crypto";

export const COOKIE      = "sx_session";
export const SESSION_TTL = 60 * 60 * 12; // 12 h, in seconds

/** Fail fast rather than signing with a guessable key. */
export function requireSecret() {
  const s = process.env.APP_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "APP_SESSION_SECRET is not set (or is shorter than 32 chars). " +
      "Generate one with: openssl rand -hex 32"
    );
  }
  return s;
}

const b64url = buf => Buffer.from(buf)
  .toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const b64urlJson = obj => b64url(JSON.stringify(obj));

function sign(data, secret) {
  return b64url(crypto.createHmac("sha256", secret).update(data).digest());
}

/** Creates a signed session token for a Telegram identity. */
export function issue({ telegram_id, handle }) {
  const secret = requireSecret();
  const now    = Math.floor(Date.now() / 1000);
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const body   = b64urlJson({
    sub:  String(telegram_id),
    handle: handle || null,
    csrf: crypto.randomBytes(16).toString("hex"),
    iat:  now,
    exp:  now + SESSION_TTL
  });
  const data = `${header}.${body}`;
  return { token: `${data}.${sign(data, secret)}`, expires_in: SESSION_TTL };
}

/** Verifies signature and expiry. Returns the claims, or null. */
export function verify(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  let secret;
  try { secret = requireSecret(); } catch { return null; }

  const expected = sign(`${parts[0]}.${parts[1]}`, secret);
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  // Constant-time compare; lengths must match first or timingSafeEqual throws.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let claims;
  try {
    claims = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
    );
  } catch { return null; }

  if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

export function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  raw.split(";").forEach(pair => {
    const i = pair.indexOf("=");
    if (i < 0) return;
    out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  });
  return out;
}

export function setSessionCookie(res, token, maxAge = SESSION_TTL) {
  res.setHeader("Set-Cookie", [
    `${COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ].join("; "));
}

/**
 * Clears the cookie. Because sessions are stateless, this ends the session on
 * this device only; a stolen token would remain valid until it expires. Cutting
 * that window is why SESSION_TTL is short. A shared deny-list (KV) is the
 * upgrade path when the bot gains "revoke all sessions".
 */
export function revoke(res) {
  res.setHeader("Set-Cookie", [
    `${COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0"
  ].join("; "));
}

/** Reads and validates the session from the request. Returns claims or null. */
export function current(req) {
  return verify(parseCookies(req)[COOKIE]);
}

/** Guard for authenticated routes: sends 401 and returns null when absent. */
export function requireSession(req, res) {
  const s = current(req);
  if (!s) {
    res.status(401).json({
      error: { code: "unauthenticated", message: "Sign in from the Telegram bot with /web" }
    });
    return null;
  }
  return s;
}
