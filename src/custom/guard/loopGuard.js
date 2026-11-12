/**
 * loopGuard.js — agent loop detection guard.
 *
 * Detects when an agent is stuck repeating the same tool call, burning tokens
 * without progress, or exceeding a turn budget. Returns a severity signal the
 * caller can use to throttle or stop the loop — without ever breaking the
 * request (fail-open).
 *
 * Severity ladder:
 *   ok       → no issue detected
 *   warn     → early sign of a loop (3+ repeated tool hashes, or token growth
 *              >50 % without a role change)
 *   throttle → persistent loop (5+ repeated hashes)
 *   stop     → hard limit reached (7+ repeated hashes, or turn count exceeded)
 *
 * Per-session state is kept in an in-memory Map with LRU eviction (max 256
 * entries by default). Pure ESM, zero external deps.
 */

// ---------------------------------------------------------------------------
// Hash helper
// ---------------------------------------------------------------------------

/**
 * Deterministic 32-bit hash of a tool call (function name + arguments string).
 * Uses FNV-1a — fast, no deps, good enough for equality detection within a
 * single process lifetime.
 *
 * @param {object} toolCall - { function?: { name?, arguments? } }
 * @returns {string} hex hash
 */
export function hashToolCall(toolCall) {
  try {
    const name = (toolCall && toolCall.function && typeof toolCall.function.name === "string")
      ? toolCall.function.name
      : "";
    const args = (toolCall && toolCall.function && typeof toolCall.function.arguments === "string")
      ? toolCall.function.arguments
      : "";
    const src = `${name}\0${args}`;
    let h = 0x811c9dc5;
    for (let i = 0; i < src.length; i++) {
      h ^= src.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  } catch {
    return "00000000";
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a loop guard instance.
 *
 * @param {object} [opts]
 * @param {number} [opts.maxTurns=100]           hard turn-count ceiling
 * @param {number} [opts.repeatWarn=3]           repeated-hash count → warn
 * @param {number} [opts.repeatThrottle=5]       repeated-hash count → throttle
 * @param {number} [opts.repeatStop=7]           repeated-hash count → stop
 * @param {number} [opts.tokenGrowthThreshold=1.5]  1.5 = 50 % growth triggers warn
 * @param {number} [opts.maxSessions=256]        LRU capacity for session map
 * @returns {{ check: Function, reset: Function, stats: Function }}
 */
export function createLoopGuard(opts = {}) {
  const maxTurns            = opts.maxTurns            ?? 100;
  const repeatWarn          = opts.repeatWarn          ?? 3;
  const repeatThrottle      = opts.repeatThrottle      ?? 5;
  const repeatStop          = opts.repeatStop          ?? 7;
  const tokenGrowthThreshold = opts.tokenGrowthThreshold ?? 1.5;
  const maxSessions         = opts.maxSessions         ?? 256;

  /** @type {Map<string, object>} LRU session state (Map insertion order). */
  const sessions = new Map();

  // Aggregate counters
  let totalChecks = 0;
  let warnings  = 0;
  let throttles = 0;
  let stops     = 0;

  // -- internal helpers -----------------------------------------------------

  /** Bump a session key to the most-recently-used position (Map tail). */
  function touch(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) return;
    sessions.delete(sessionId);
    sessions.set(sessionId, s);
  }

  /** Evict the least-recently-used entry (Map head). */
  function evictLRU() {
    const first = sessions.keys().next();
    if (!first.done) sessions.delete(first.value);
  }

  /** Return (or create) the per-session state object. */
  function getSession(sessionId) {
    let s = sessions.get(sessionId);
    if (s) { touch(sessionId); return s; }
    if (sessions.size >= maxSessions) evictLRU();
    s = {
      lastHash:     null,
      repeatCount:  0,
      lastTokenCount: 0,
      lastRole:     null,
      turnCount:    0,
    };
    sessions.set(sessionId, s);
    return s;
  }

  // -- public API -----------------------------------------------------------

  /**
   * Clear all tracked state for a session.
   * @param {string} sessionId
   */
  function reset(sessionId) {
    sessions.delete(sessionId);
  }

  /**
   * Aggregate statistics.
   * @returns {{ totalChecks: number, sessions: number, tracked: number, warnings: number, throttles: number, stops: number }}
   */
  function stats() {
    return { totalChecks, sessions: sessions.size, tracked: sessions.size, warnings, throttles, stops };
  }

  /**
   * Run all loop-detection checks for one agent step.
   *
   * @param {object}  inp
   * @param {string}  inp.sessionId       session identifier (required)
   * @param {object[]} [inp.toolCalls]     tool_calls from the latest assistant turn
   * @param {number}  [inp.messageCount]  total messages in the conversation
   * @param {number}  [inp.tokenCount]    current estimated token count
   * @param {string}  [inp.lastHash]      pre-computed hash of the last tool call
   * @param {string}  [inp.lastRole]      role of the last message ("user"|"assistant"|"tool"|…)
   * @returns {{ allowed: boolean, reason: string|null, severity: "ok"|"warn"|"throttle"|"stop" }}
   */
  function check(inp = {}) {
    try {
      totalChecks++;
      const {
        sessionId,
        toolCalls,
        messageCount,
        tokenCount,
        lastHash,
        lastRole,
      } = inp;

      if (!sessionId) return { allowed: true, reason: null, severity: "ok" };

      const s = getSession(sessionId);
      s.turnCount = messageCount ?? s.turnCount + 1;

      // --- (a) Repeated tool-call hash detection ---------------------------
      const hash = lastHash
        || (Array.isArray(toolCalls) && toolCalls.length > 0
          ? hashToolCall(toolCalls[toolCalls.length - 1])
          : null);

      if (hash) {
        if (hash === s.lastHash) {
          s.repeatCount++;
        } else {
          s.lastHash    = hash;
          s.repeatCount = 1;
        }
      }

      // --- (b) Token growth without role change ----------------------------
      let tokenGrowthWarn = false;
      if (
        typeof tokenCount === "number" && tokenCount > 0 &&
        s.lastTokenCount > 0 &&
        lastRole && lastRole === s.lastRole
      ) {
        if (tokenCount > s.lastTokenCount * tokenGrowthThreshold) {
          tokenGrowthWarn = true;
        }
      }
      if (typeof tokenCount === "number" && tokenCount > 0) {
        s.lastTokenCount = tokenCount;
      }
      if (lastRole) s.lastRole = lastRole;

      // --- (c) Turn-count ceiling ------------------------------------------
      if (s.turnCount > maxTurns) {
        stops++;
        return {
          allowed:  false,
          reason:   `max-turns-exceeded:${s.turnCount}>${maxTurns}`,
          severity: "stop",
        };
      }

      // --- Combine signals → worst severity wins ---------------------------
      let severity = "ok";
      let reason   = null;

      if (s.repeatCount >= repeatStop) {
        severity = "stop";
        reason   = `loop-detected:${s.repeatCount}x:${s.lastHash || "?"}`;
        stops++;
      } else if (s.repeatCount >= repeatThrottle) {
        severity = "throttle";
        reason   = `loop-throttle:${s.repeatCount}x:${s.lastHash || "?"}`;
        throttles++;
      } else if (s.repeatCount >= repeatWarn || tokenGrowthWarn) {
        severity = "warn";
        reason   = s.repeatCount >= repeatWarn
          ? `loop-warn:${s.repeatCount}x:${s.lastHash || "?"}`
          : "token-growth-warn";
        warnings++;
      }

      return { allowed: severity !== "stop", reason, severity };
    } catch {
      return { allowed: true, reason: null, severity: "ok" };
    }
  }

  return { check, reset, stats };
}
