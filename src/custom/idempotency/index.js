/**
 * src/custom/idempotency/index.js
 *
 * In-memory, single-process Idempotency-Key store (Stripe-style).
 *
 * Concurrency note: this implementation is intentionally single-process and
 * synchronous. Multi-process locking (Redis/PG advisory locks, etc.) is OUT
 * OF SCOPE — a production multi-instance deployment must front this with a
 * shared store or a lock. Documented here so callers do not assume cross-process
 * safety.
 *
 * Digest model: the caller computes a stable digest (e.g. SHA-256 of the
 * normalized request body) and passes it on claim/complete. Two distinct
 * digests on the same key = different request = conflict (409-eligible).
 * Same digest = idempotent replay (return the stored result, do not re-execute).
 */

/**
 * Create an idempotency store.
 * @param {object} [opts]
 * @param {number} [opts.maxEntries=256]   LRU capacity
 * @param {number} [opts.ttlMs=86400000]   TTL for in-progress entries (lazy expiry)
 * @param {() => number} [opts.now]        injectable clock for tests
 * @returns {{
 *   claim: (key: string, requestDigest: string) =>
 *     { status: 'in-progress'|'completed'|'conflict', seq?: number, value?: any, expectedDigest?: string },
 *   complete: (key: string, requestDigest: string, value: any) => boolean,
 *   get:    (key: string) => { status: 'in-progress'|'completed'|'missing', value?: any, seq: number },
 *   seq:    (key: string) => number,
 *   invalidate: (key: string) => void,
 *   clear:  () => void,
 *   stats:  () => { size: number, completed: number, inProgress: number, evictions: number, conflicts: number },
 * }}
 */
export function createIdempotencyStore({
  maxEntries = 256,
  ttlMs = 24 * 60 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  // LRU via Map (insertion order = recency; re-insert on access to bump).
  const map = new Map();
  // stats
  let evictions = 0;
  let conflicts = 0;

  function isExpired(entry, ts) {
    if (entry.status !== "in-progress") return false; // completed entries never expire
    if (typeof entry.createdAt !== "number") return false;
    return ts - entry.createdAt > ttlMs;
  }

  // Bump entry to most-recent (LRU tail). Must preserve identity.
  function bump(key, entry) {
    map.delete(key);
    map.set(key, entry);
  }

  function evictLRU() {
    // Map preserves insertion order; first key = least recently used.
    const first = map.keys().next();
    if (!first.done) {
      map.delete(first.value);
      evictions++;
    }
  }

  function stats() {
    let completed = 0;
    let inProgress = 0;
    const ts = now();
    for (const [, e] of map) {
      if (isExpired(e, ts)) continue;
      if (e.status === "completed") completed++;
      else inProgress++;
    }
    return {
      size: map.size,
      completed,
      inProgress,
      evictions,
      conflicts,
    };
  }

  function claim(key, requestDigest) {
    const ts = now();

    let entry = map.get(key);
    if (entry && isExpired(entry, ts)) {
      // Lazy TTL expiry: remove expired in-progress entry, treat as missing.
      map.delete(key);
      entry = undefined;
    }

    if (entry) {
      if (entry.status === "completed") {
        if (entry.digest === requestDigest) {
          // Idempotent replay — return stored value, do not re-execute.
          bump(key, entry);
          return { status: "completed", value: entry.value, seq: entry.seq };
        }
        // Different digest on a completed key → conflict.
        conflicts++;
        bump(key, entry);
        return { status: "conflict", expectedDigest: entry.digest };
      }
      // in-progress: check digest match
      if (entry.digest === requestDigest) {
        entry.seq += 1;
        bump(key, entry);
        return { status: "in-progress", seq: entry.seq };
      }
      // in-progress but different digest → conflict
      conflicts++;
      bump(key, entry);
      return { status: "conflict", expectedDigest: entry.digest };
    }

    // New entry
    entry = {
      status: "in-progress",
      digest: requestDigest,
      seq: 1,
      value: undefined,
      createdAt: ts,
    };

    if (map.size >= maxEntries) evictLRU();
    map.set(key, entry);
    return { status: "in-progress", seq: 1 };
  }

  function complete(key, requestDigest, value) {
    const entry = map.get(key);
    if (!entry) return false;
    if (entry.status !== "in-progress") {
      // Already completed: idempotent no-op (same digest) or ignored (diff digest).
      // Either way, the stored value is authoritative and is not overwritten.
      return entry.digest === requestDigest;
    }
    if (entry.digest !== requestDigest) return false; // digest mismatch → no-op
    entry.status = "completed";
    entry.value = value;
    bump(key, entry);
    return true;
  }

  function get(key) {
    const entry = map.get(key);
    if (!entry) return { status: "missing", seq: 0 };
    if (isExpired(entry, now())) {
      map.delete(key);
      return { status: "missing", seq: 0 };
    }
    bump(key, entry);
    if (entry.status === "completed") {
      return { status: "completed", value: entry.value, seq: entry.seq };
    }
    return { status: "in-progress", seq: entry.seq };
  }

  function seq(key) {
    const entry = map.get(key);
    if (!entry) return 0;
    if (isExpired(entry, now())) {
      map.delete(key);
      return 0;
    }
    return entry.seq;
  }

  function invalidate(key) {
    map.delete(key);
  }

  /**
   * Release a claimed key without storing a result.
   *
   * The claim is dropped entirely: the request failed, so there is no result
   * to replay, and keeping the entry would make every later retry with the
   * same key see "in-progress" and be rejected with a conflict. The digest
   * must match, so a release cannot cancel a claim made for a different body.
   *
   * @returns {boolean} true when a matching in-progress claim was released
   */
  function release(key, requestDigest) {
    const entry = map.get(key);
    if (!entry) return false;
    if (entry.status !== "in-progress") return false;
    if (requestDigest !== undefined && entry.digest !== requestDigest) return false;
    map.delete(key);
    return true;
  }

  function clear() {
    map.clear();
    evictions = 0;
    conflicts = 0;
  }

  return { claim, complete, get, seq, invalidate, release, clear, stats };
}
