/**
 * Semantic cache — storage/lookup layer for an exact-match response cache.
 *
 * `fingerprint(body)` builds a stable key from a chat-completions-style body.
 * Cache-buster variance (user, stream, requestId, metadata, `_`-prefixed keys)
 * is excluded so identical requests map to the same fingerprint.
 *
 * `createSemanticCache()` is an in-memory LRU + TTL store. Streaming caveat:
 * the value stored is the CALLER's responsibility — this module keeps whatever
 * it is given, typically a serialized SSE transcript, and returns it verbatim.
 *
 * Pure ESM, no external deps. Wiring into the request pipeline happens
 * elsewhere (orchestrator-owned).
 */

/** Ordering keys of a body in a stable, order-preserving fashion. */
const FP_INCLUDED_KEYS = [
  "model",
  "messages",
  "temperature",
  "max_tokens",
  "top_p",
  "stop",
  "tools",
  "tool_choice",
  "response_format",
];

/**
 * Stable stringify: for objects keys are sorted so no key order can leak;
 * arrays stay order-precising (message tool-call part order IS semantics).
 */
function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
}

/**
 * Deterministic fingerprint for a chat-completions-style body.
 * Same body (modulo excluded keys) -> same string.
 */
export function fingerprint(body) {
  if (!body || typeof body !== "object") return stable(null);
  const parts = [];
  for (const key of FP_INCLUDED_KEYS) {
    if (body[key] === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${stable(body[key])}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * In-memory semantic cache. Factory (not a module singleton) so callers can
 * scope lifetime and inject a fake clock for tests.
 */
export function createSemanticCache({ maxEntries = 128, ttlMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
  const map = new Map(); // fp -> { value, expiresAt, hits, createdAt, lastAccess }
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  // Monotonic counter, not the clock: a fake `now` returning identical values
  // still gives every set/get a total order so LRU ordering is well-defined.
  let seq = 0;
  const word = () => ++seq;

  const touch = (fp) => {
    const entry = map.get(fp);
    if (!entry) return;
    entry.lastAccess = word();
    entry.hits += 1;
  };

  function get(fp) {
    const entry = map.get(fp);
    if (!entry) {
      misses += 1;
      return null;
    }
    if (now() >= entry.expiresAt) {
      map.delete(fp);
      misses += 1;
      return null;
    }
    touch(fp);
    hits += 1;
    return entry.value;
  }

  function evictIfNeeded() {
    while (map.size > maxEntries) {
      let oldestFp = null;
      let oldestAt = Infinity;
      for (const [fp, entry] of map) {
        if (entry.lastAccess < oldestAt) {
          oldestAt = entry.lastAccess;
          oldestFp = fp;
        }
      }
      if (oldestFp === null) break;
      map.delete(oldestFp);
      evictions += 1;
    }
  }

  function set(fp, value) {
    const t = now();
    map.set(fp, { value, expiresAt: t + ttlMs, hits: 0, createdAt: t, lastAccess: word() });
    evictIfNeeded();
  }

  function del(fp) {
    return map.delete(fp);
  }

  function clear() {
    map.clear();
  }

  function stats() {
    return { size: map.size, hits, misses, evictions };
  }

  return { get, set, touch, delete: del, clear, stats };
}
