/**
 * Fixed-window rate limiter
 * ─────────────────────────────────────────────────────────────────────────────
 * Two backends, chosen automatically:
 *
 *   1. Upstash Redis (REST) when UPSTASH_REDIS_REST_URL + _TOKEN are set.
 *      Shared across every serverless instance — this is real enforcement.
 *   2. In-memory fallback otherwise.
 *
 * IMPORTANT about the fallback: Vercel runs many instances, each with its own
 * Map, and they are recycled. It raises the cost of an attack but it does NOT
 * enforce a global limit. Anything protecting a paid resource (the Groq key) or
 * a credential (the /web code) should run on the Redis backend in production.
 *
 * No dependency added: Upstash is reached over its REST API with fetch.
 */

const mem = new Map(); // key -> { count, resetAt }

function kvConfig() {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

export function backend() {
  return kvConfig() ? "redis" : "memory";
}

async function hitRedis(cfg, key, windowSec) {
  const r = await fetch(`${cfg.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, String(windowSec), "NX"]
    ])
  });
  if (!r.ok) throw new Error("kv " + r.status);
  const out = await r.json();
  const count = Array.isArray(out) && out[0] ? Number(out[0].result) : NaN;
  if (!isFinite(count)) throw new Error("kv bad reply");
  return count;
}

function hitMemory(key, windowSec) {
  const now = Date.now();
  const cur = mem.get(key);
  if (!cur || cur.resetAt <= now) {
    mem.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    if (mem.size > 5000) {
      for (const [k, v] of mem) if (v.resetAt <= now) mem.delete(k);
    }
    return 1;
  }
  cur.count += 1;
  return cur.count;
}

/**
 * Counts one hit against `key`.
 * @returns {Promise<{allowed:boolean, count:number, limit:number, retryAfter:number}>}
 */
export async function limit(key, max, windowSec) {
  const cfg = kvConfig();
  let count;
  if (cfg) {
    try {
      count = await hitRedis(cfg, `rl:${key}`, windowSec);
    } catch {
      count = hitMemory(key, windowSec); // never fail the request on limiter trouble
    }
  } else {
    count = hitMemory(key, windowSec);
  }
  return {
    allowed: count <= max,
    count,
    limit: max,
    retryAfter: windowSec
  };
}

/** Best-effort client IP behind Vercel's proxy. */
export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  if (Array.isArray(fwd) && fwd.length) return String(fwd[0]).split(",")[0].trim();
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}
