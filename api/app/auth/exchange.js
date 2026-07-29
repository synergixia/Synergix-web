/**
 * POST /api/app/auth/exchange
 * Trades a one-time code from the Telegram bot (/web) for a session cookie.
 *
 * This is the only unauthenticated write in the app API and it guards an
 * account, so it is rate limited on two axes: per IP (stops one host walking
 * the keyspace) and per code (stops a distributed guess at one target).
 */

import { guard, fail, ok, readJson } from "../_lib/http.js";
import { issue, setSessionCookie }    from "../_lib/session.js";
import { limit, clientIp, backend }   from "../_lib/ratelimit.js";
import * as bot                       from "../_lib/bot.js";

const CODE_RE = /^[A-Z0-9]{6,12}$/;

export default async function handler(req, res) {
  if (guard(req, res, ["POST"])) return;

  const ip = clientIp(req);

  // 10 attempts per IP per 10 minutes.
  const perIp = await limit(`xch:ip:${ip}`, 10, 600);
  if (!perIp.allowed) {
    res.setHeader("Retry-After", String(perIp.retryAfter));
    return fail(res, 429, "rate_limited", "Too many attempts. Try again shortly.", {
      retry_after: perIp.retryAfter
    });
  }

  const body = await readJson(req);
  if (!body) return fail(res, 400, "bad_json", "Malformed JSON body");

  const code = String(body.code || "").trim().toUpperCase();
  if (!CODE_RE.test(code)) {
    return fail(res, 400, "invalid_code", "That code does not look right. Ask the bot for a new one with /web.");
  }

  // 5 attempts against any single code per 10 minutes.
  const perCode = await limit(`xch:code:${code}`, 5, 600);
  if (!perCode.allowed) {
    res.setHeader("Retry-After", String(perCode.retryAfter));
    return fail(res, 429, "rate_limited", "Too many attempts for that code.", {
      retry_after: perCode.retryAfter
    });
  }

  let identity;
  try {
    identity = await bot.verifyCode(code);
  } catch (err) {
    const notWired = err.code === "bot_not_configured";
    return fail(
      res,
      notWired ? 501 : 503,
      err.code || "bot_unavailable",
      notWired
        ? "Sign-in is not switched on yet: the site is not connected to the bot."
        : "The bot is not reachable right now. Try again in a moment.",
      { rate_limit_backend: backend() }
    );
  }

  if (!identity || !identity.telegram_id) {
    // Same answer for unknown, expired and already-used: revealing which one
    // would tell an attacker whether a guessed code exists.
    return fail(res, 400, "invalid_code", "Invalid or expired code. Ask the bot for a new one with /web.");
  }

  let session;
  try {
    session = issue({ telegram_id: identity.telegram_id, handle: identity.handle });
  } catch (err) {
    return fail(res, 500, "session_misconfigured", err.message);
  }

  setSessionCookie(res, session.token, session.expires_in);
  return ok(res, {
    telegram_id: identity.telegram_id,
    handle: identity.handle || null,
    expires_in: session.expires_in
  });
}
