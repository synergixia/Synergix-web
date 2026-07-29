/**
 * GET /api/app/me
 * Everything the dashboard home screen needs, in one round trip: profile,
 * rank and progress, daily quota, wallet balances and passport summary.
 *
 * Read-only. Moving funds is Phase 3 and goes through /wallet/intents with a
 * Telegram confirmation — never straight from a web session.
 */

import { guard, fail, ok }   from "../_lib/http.js";
import { requireSession }    from "../_lib/session.js";
import * as bot              from "../_lib/bot.js";

export default async function handler(req, res) {
  if (guard(req, res, ["GET"])) return;

  const session = requireSession(req, res);
  if (!session) return;

  let data;
  try {
    data = await bot.overview(session.sub);
  } catch (err) {
    const notWired = err.code === "bot_not_configured";
    return fail(
      res,
      notWired ? 501 : 503,
      err.code || "bot_unavailable",
      notWired
        ? "The dashboard is not connected to the bot yet."
        : "Could not load your data right now. Try again in a moment."
    );
  }

  if (!data) return fail(res, 404, "not_found", "No profile found for this account");

  return ok(res, {
    telegram_id: session.sub,
    handle:      data.handle ?? session.handle ?? null,
    points:      data.points ?? 0,
    streak_days: data.streak_days ?? 0,
    joined_at:   data.joined_at ?? null,
    rank:        data.rank     ?? null,
    quota:       data.quota    ?? null,
    wallet:      data.wallet   ?? null,
    passport:    data.passport ?? null
  });
}
