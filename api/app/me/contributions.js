/**
 * GET /api/app/me/contributions?cursor=&limit=
 * The signed-in user's contribution history with the verdict of the three
 * judges per aporte, and the Irys transaction once it is accepted.
 *
 * Cursor paginated, not offset: the list reorders while it is being paged.
 */

import { guard, fail, ok }  from "../_lib/http.js";
import { requireSession }   from "../_lib/session.js";
import * as bot             from "../_lib/bot.js";

export default async function handler(req, res) {
  if (guard(req, res, ["GET"])) return;

  const session = requireSession(req, res);
  if (!session) return;

  const url    = new URL(req.url, "http://localhost");
  const cursor = url.searchParams.get("cursor") || undefined;
  const limit  = url.searchParams.get("limit")  || 20;

  let data;
  try {
    data = await bot.contributions(session.sub, { cursor, limit });
  } catch (err) {
    const notWired = err.code === "bot_not_configured";
    return fail(
      res,
      notWired ? 501 : 503,
      err.code || "bot_unavailable",
      notWired
        ? "The dashboard is not connected to the bot yet."
        : "Could not load your contributions right now."
    );
  }

  return ok(res, {
    items:       Array.isArray(data?.items) ? data.items : [],
    next_cursor: data?.next_cursor ?? null
  });
}
