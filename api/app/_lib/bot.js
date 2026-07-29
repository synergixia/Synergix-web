/**
 * The bot adapter — the single seam between the website and the Synergix bot
 * ─────────────────────────────────────────────────────────────────────────────
 * The bot owns the state: users, points, ranks, quotas, custodial wallets. The
 * web tier never computes any of it, so the two clients can never disagree.
 *
 * This file is the ONLY place that talks to the bot. Everything the bot has to
 * implement is listed below; nothing else in the web tier needs to change when
 * it lands.
 *
 * ── CONTRACT THE BOT MUST EXPOSE ────────────────────────────────────────────
 * Base URL in BOT_API_URL, bearer token in BOT_API_TOKEN.
 *
 *   POST {BOT_API_URL}/auth/verify-code
 *        → { "code": "K7M2XQ4P" }
 *        ← 200 { "telegram_id": 1234567, "handle": "@user" }
 *        ← 404 when unknown, expired or already used
 *        The bot generates the code on /web, stores it hashed with a short TTL,
 *        and marks it used on the first successful verify.
 *
 *   GET  {BOT_API_URL}/users/{telegram_id}/overview
 *        ← 200 {
 *            handle, points, joined_at, streak_days,
 *            rank:   { key, label, multiplier, next, next_at },
 *            quota:  { used, limit, resets_at },
 *            wallet: { synx, synergix, address, membership:{tier,next_tier_at} },
 *            passport:{ citations, royalties_accrued, impact_score }
 *          }
 *
 *   GET  {BOT_API_URL}/users/{telegram_id}/contributions?cursor=&limit=
 *        ← 200 { items: [ { id, excerpt, status, judges:{llm,oracle,antisybil},
 *                           points_awarded, irys_tx, created_at } ],
 *                next_cursor }
 *
 * Amounts are strings (18-decimal tokens lose precision as floats).
 * Timestamps are ISO 8601 UTC.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TIMEOUT_MS = 8000;

export class BotUnavailable extends Error {
  constructor(message, code = "bot_unavailable") {
    super(message);
    this.code = code;
  }
}

export function isConfigured() {
  return Boolean(process.env.BOT_API_URL && process.env.BOT_API_TOKEN);
}

function config() {
  const url   = process.env.BOT_API_URL;
  const token = process.env.BOT_API_TOKEN;
  if (!url || !token) {
    throw new BotUnavailable(
      "The bot API is not connected yet. Set BOT_API_URL and BOT_API_TOKEN.",
      "bot_not_configured"
    );
  }
  return { url: url.replace(/\/+$/, ""), token };
}

async function call(path, { method = "GET", body } = {}) {
  const cfg  = config();
  const ctl  = new AbortController();
  const stop = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(cfg.url + path, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new BotUnavailable(`Bot API responded ${r.status}`);
    return await r.json();
  } catch (err) {
    if (err instanceof BotUnavailable) throw err;
    if (err.name === "AbortError") throw new BotUnavailable("Bot API timed out");
    throw new BotUnavailable("Could not reach the bot API");
  } finally {
    clearTimeout(stop);
  }
}

/** Exchanges a /web code for the identity behind it. Null when invalid. */
export function verifyCode(code) {
  return call("/auth/verify-code", { method: "POST", body: { code } });
}

export function overview(telegramId) {
  return call(`/users/${encodeURIComponent(telegramId)}/overview`);
}

export function contributions(telegramId, { cursor, limit = 20 } = {}) {
  const q = new URLSearchParams();
  if (cursor) q.set("cursor", cursor);
  q.set("limit", String(Math.min(Math.max(1, parseInt(limit) || 20), 50)));
  return call(`/users/${encodeURIComponent(telegramId)}/contributions?${q}`);
}
