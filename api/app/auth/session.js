/**
 * GET    /api/app/auth/session  → who the current session belongs to
 * DELETE /api/app/auth/session  → sign out on this device
 */

import { guard, fail, ok }         from "../_lib/http.js";
import { current, revoke }         from "../_lib/session.js";

export default async function handler(req, res) {
  if (guard(req, res, ["GET", "DELETE"])) return;

  if (req.method === "DELETE") {
    revoke(res);
    return ok(res, { signed_out: true });
  }

  const s = current(req);
  if (!s) return fail(res, 401, "unauthenticated", "No active session");

  return ok(res, {
    telegram_id: s.sub,
    handle: s.handle || null,
    expires_at: new Date(s.exp * 1000).toISOString(),
    // Handed to the client now so Phase 2 writes can double-submit it.
    csrf_token: s.csrf || null
  });
}
