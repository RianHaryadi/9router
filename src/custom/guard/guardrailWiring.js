/**
 * guardrailWiring.js — the single place that owns the fork's inbound guardrails.
 *
 * Two guards, both pure and fail-open, both already written in src/custom:
 *   - injectionFirewall: scans INBOUND tool results before the model sees them
 *   - loopGuard:        detects an agent that repeats the same tool call forever
 *
 * This module owns their LIFECYCLE (one scanner + one guard per process) and
 * the decision "does this request get stopped?". The request path only calls
 * applyGuardrails() and honours the returned decision.
 *
 * Nothing here throws: a guard failure must never break a request.
 */

import { createInjectionScanner, scanToolResults } from "./injectionFirewall.js";
import { createLoopGuard } from "./loopGuard.js";

// One scanner and one guard for the whole process. Both keep their own
// bounded state (patterns / sessions), so they must not be re-created per
// request — the loop guard's session map would lose its history.
let scanner = null;
let loopGuard = null;

function getScanner() {
  if (!scanner) scanner = createInjectionScanner();
  return scanner;
}

function getLoopGuard() {
  if (!loopGuard) loopGuard = createLoopGuard();
  return loopGuard;
}

/**
 * The settings that turn a guard on. Both default to OFF: an existing agent
 * setup must not change behaviour until the owner asks for it.
 *
 * @param {object} settings the merged settings row
 * @returns {{ injection: boolean, loop: boolean }}
 */
export function guardrailFlags(settings) {
  const s = settings && typeof settings === "object" ? settings : {};
  // One master switch plus per-guard switches. The master switch off means
  // both off, whatever the per-guard flags say.
  if (s.guardrailsEnabled !== true) return { injection: false, loop: false };
  return {
    injection: s.injectionFirewallEnabled !== false,
    loop: s.loopGuardEnabled !== false,
  };
}

/**
 * Run the enabled guards over one request.
 *
 * The body is MUTATED IN PLACE by the injection firewall (that is how the
 * scanner is designed: it rewrites the tool result so the model never sees the
 * injected instruction). Callers must pass the body that goes upstream.
 *
 * @param {object} opts
 * @param {object} opts.body        the request body (mutated in place)
 * @param {object} opts.settings    the merged settings row
 * @param {string} [opts.sessionId] the agent session identity
 * @param {number} [opts.tokenCount] the estimated prompt tokens
 * @param {string} [opts.lastRole]  the role of the last message
 * @returns {{ allowed: boolean, reason: string|null, severity: string,
 *             injection: { scanned: number, blocked: number, stripped: number, warned: number },
 *             loop: object|null }}
 */
export function applyGuardrails(opts = {}) {
  const decision = {
    allowed: true,
    reason: null,
    severity: "ok",
    injection: { scanned: 0, blocked: 0, stripped: 0, warned: 0 },
    loop: null,
  };
  try {
    const { body, settings, sessionId, tokenCount, lastRole } = opts;
    if (!body || typeof body !== "object") return decision;

    const flags = guardrailFlags(settings);
    if (!flags.injection && !flags.loop) return decision;

    // 1) Inbound injection scan — mutates body.messages tool results.
    if (flags.injection) {
      const sc = getScanner();
      const { results } = scanToolResults(body, sc);
      const stats = sc.stats();
      decision.injection = {
        scanned: stats.scanned,
        blocked: stats.blocked,
        stripped: stats.stripped,
        warned: stats.warned,
        hits: results.length,
      };
    }

    // 2) Agent loop detection.
    if (flags.loop) {
      const guard = getLoopGuard();
      const toolCalls = Array.isArray(body.messages)
        ? body.messages.flatMap((m) => (Array.isArray(m.tool_calls) ? m.tool_calls : []))
        : [];
      const result = guard.check({
        sessionId: sessionId || body.user || "default",
        toolCalls,
        messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
        tokenCount,
        lastRole,
      });
      decision.loop = result;
      if (!result.allowed) {
        decision.allowed = false;
        decision.reason = result.reason;
        decision.severity = result.severity;
      }
    }
  } catch {
    // fail-open: a guard failure never breaks a request
  }
  return decision;
}

/** Reset the guard state (tests). */
export function __resetGuardrails() {
  scanner = null;
  loopGuard = null;
}
