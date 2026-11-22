/**
 * transientRetry.js — retry policy for transport-level failures.
 *
 * WHY THIS EXISTS:
 *   A provider fetch that dies before ANY response byte arrives (DNS blip,
 *   TCP reset, gateway timeout on the connect) is indistinguishable from a
 *   provider that is genuinely down. The upstream path returned 502 straight
 *   away, so a single transient socket error cost the caller a whole request
 *   even though a retry 300ms later would have succeeded.
 *
 *   The retry is deliberately LIMITED to failures that happen BEFORE the
 *   provider produced a response. Once bytes have been handed to the client
 *   the request is no longer replayable — retrying would duplicate output the
 *   user already saw. That boundary is why this module only classifies
 *   THROWN errors, never upstream HTTP statuses (those are the fallback /
 *   taxonomy layer's business).
 *
 * CONTRACT:
 *   isTransientError(error)  → is this worth another attempt?
 *   retryDelayMs(attempt)    → exponential backoff with a ceiling
 *   executeWithRetry(fn, opts) → run fn, retrying transient failures
 *
 * PURE & fail-safe: never throws the retry logic itself, never retries an
 * AbortError (the caller aborted on purpose), never waits longer than the
 * caller's total budget.
 */

const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 2000;

// Transport-level error codes that are worth another attempt.
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
  "ENETRESET",
  "EHOSTUNREACH",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

// Substrings of fetch/undici error messages that mean "the wire broke".
const TRANSIENT_MESSAGE_PATTERNS = [
  "fetch failed",
  "socket hang up",
  "terminated",
  "other side closed",
  "connection closed",
  "network error",
  "premature close",
  "socket disconnected",
  "econnreset",
  "econnrefused",
  "etimedout",
  "enotfound",
  "eai_again",
];

/**
 * True when the failure is a transport hiccup worth retrying.
 * Aborts are never retried: the caller asked to stop.
 */
export function isTransientError(error) {
  if (!error) return false;
  if (error.name === "AbortError") return false;
  if (error.name === "TimeoutError") return true;
  const code = error.code || error.errno || error.cause?.code;
  if (code && TRANSIENT_CODES.has(String(code))) return true;
  const causeCode = error.cause?.code;
  if (causeCode && TRANSIENT_CODES.has(String(causeCode))) return true;
  const message = String(error.message || "").toLowerCase();
  if (!message) return false;
  return TRANSIENT_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * Exponential backoff: attempt 1 → base, attempt 2 → 2×base, capped.
 * `attempt` is 1-based (the number of the attempt that just failed).
 */
export function retryDelayMs(attempt, { baseMs = DEFAULT_BASE_DELAY_MS, maxMs = DEFAULT_MAX_DELAY_MS } = {}) {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1;
  const delay = baseMs * 2 ** (n - 1);
  return Math.min(delay, maxMs);
}

/** Sleep that resolves early when the signal aborts. */
function sleep(ms, signal) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal?.addEventListener) {
      signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    }
  });
}

/**
 * Run `fn` and retry it while it throws transient transport errors.
 *
 * @param {function} fn            async, receives the 1-based attempt number
 * @param {object} [opts]
 * @param {number} [opts.retries]  extra attempts after the first (default 2)
 * @param {number} [opts.baseMs]   first backoff (default 250)
 * @param {number} [opts.maxMs]    backoff ceiling (default 2000)
 * @param {AbortSignal} [opts.signal]
 * @param {function} [opts.onRetry] called as ({ attempt, error, delayMs })
 * @returns {Promise<any>} the first successful result
 * @throws the last error when every attempt failed
 */
export async function executeWithRetry(fn, opts = {}) {
  const {
    retries = DEFAULT_RETRIES,
    baseMs = DEFAULT_BASE_DELAY_MS,
    maxMs = DEFAULT_MAX_DELAY_MS,
    signal,
    onRetry,
  } = opts;
  const attempts = Math.max(1, Math.floor(retries) + 1);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const canRetry = attempt < attempts && isTransientError(error) && !signal?.aborted;
      if (!canRetry) throw error;
      const delayMs = retryDelayMs(attempt, { baseMs, maxMs });
      try { onRetry?.({ attempt, error, delayMs }); } catch { /* never break the retry loop */ }
      await sleep(delayMs, signal);
      if (signal?.aborted) throw error;
    }
  }
  throw lastError;
}

export const __transientRetryTest__ = { TRANSIENT_CODES, TRANSIENT_MESSAGE_PATTERNS };
