/**
 * pipeline.js — single fail-open hook the core calls before dispatch.
 *
 * Aggregates the src/custom transform modules into one entry point that
 * chatCore invokes ONCE (1 line). Everything in src/custom is:
 *   - optional (no-op unless a config block is passed in),
 *   - fail-open (never throws, never breaks a request),
 *   - pure where possible.
 *
 * The hook is intentionally thin: chatCore decides WHICH savers run (it owns
 * the toggles that already exist upstream). Here we only ADD the custom
 * behaviours those toggles don't cover (tool whitelist, token deltas, the
 * transform end-user guard, generic tool-call repair markers, cache-aware
 * combo ordering) on top of the existing body.
 */

import { estimateBodyTokens } from "./rtk/tokenMeter.js";
import { repairToolArguments, shouldRetryToolCall } from "./toolcall/repair.js";
import { rankByCacheWarm } from "./cache/awareRouting.js";
import { classifyComplexity, pickRouteTier } from "./routing/complexity.js";

/**
 * Run the custom pipeline. Mutates `body` like the other savers do.
 * @param {object} opts
 *   - body        the translated request body (mutated in place)
 *   - finalFormat the wire format (openai/claude/gemini/...)
 *   - modelInfo   { provider, model }
 *   - clientTool  detected client tool (for end-user guard)
 *   - ctx         { lastModel, lastProvider, cachePreferred } for cache routing
 *   - config      { rtkPolicy, transformGuard, repair, cacheWarm } optional blocks
 * @returns {object} diagnostics (never throws)
 */
export function runCustomPipeline(opts = {}) {
  const diag = { applied: [], skipped: [], tokens: null, cacheRank: null, toolWarnings: [] };
  try {
    const {
      body, finalFormat, modelInfo = {}, clientTool = null,
      ctx = {}, config = {},
    } = opts;
    if (!body || typeof body !== "object") return diag;

    // 1) Token telemetry (before) — non-mutating; the pipeline itself applies
    //    no compression, so after == before when diagnostics only.
    if (config.tokens !== false) {
      diag.tokens = { before: estimateBodyTokens(body), after: estimateBodyTokens(body), saved: 0 };
    }

    // 2) Transform end-user guard: when enabled, gate Caveman/Ponytail.
    const transformGuard = config.transformGuard !== false;
    if (transformGuard) {
      // The upstream toggles live in chatCore; here we only PREVENT application
      // on end-user-facing output. If both were already applied upstream we
      // cannot un-apply, so we report it for the log line instead.
      const endUser = requiresEndUserGuard({ clientTool });
      if (endUser) {
        diag.skipped.push("transform:end-user-facing");
      }
    }

    // 3) RTK per-tool whitelist: mark compressible tool indices per policy.
    //    (The actual compression still runs upstream; this tells that pass
    //     which tool results are safe to compress under this key's policy.)
    if (config.rtkPolicy) {
      const indices = compressibleToolIndices(body, config.rtkPolicy);
      diag.applied.push(`rtk-whitelist:${indices.length}`);
      // Indices exposed on diag only — NEVER stashed on the body: translatedBody
      // is serialized to the upstream wire, and a _custom* field there would leak.
      diag.rtkWhitelistIndices = indices;
    }

    // 4) Generic tool-call repair: inspect existing assistant tool_calls and
    //    mark which are repairable vs retry-worthy. Non-mutating diagnostics
    //    unless repair.rescue is true (then we fix arguments in place).
    if (config.repair) {
      const r = inspectToolCalls(body, config.repair);
      diag.applied.push(`toolcall-repair:${r.repaired}/${r.broken}`);
      if (r.repaired > 0) diag.toolWarnings = r.warnings;
    }

    // 5) Cache-aware combo ordering: reorder body-level candidates? This module
    //    is used by the combo layer; here we only expose the ranking for the
    //    caller and record it. Actual reorder happens where combos are built.
    if (config.cacheWarm) {
      const ordered = rankByCacheWarm(config.cacheWarm.models || [], ctx);
      diag.cacheRank = ordered;
      diag.applied.push(`cache-warm:${ordered.join(",")}`);
    }

    // 6) Complexity routing: classify the request content surface; the
    //    classification itself never mutates the body — it only exposes
    //    advisory data (for the caller to pick cheap/strong models).
    if (config.complexity) {
      const c = classifyComplexity(body);
      diag.complexity = { level: c.level, score: c.score, reasons: c.reasons };
      diag.applied.push(`route-tier:${c.level}`);
    }
  } catch {
    // fail-open: any custom error never breaks the request
  }
  return diag;
}

/** True when this request's output is read directly by an end user. */
export function requiresEndUserGuard({ clientTool, endUserFacing } = {}) {
  if (endUserFacing === true) return true;
  return typeof clientTool === "string"
    && ["chat-ui", "web-chat", "basic-chat", "deepseek-tui"].includes(clientTool);
}

/**
 * Collect the tool-message array indices allowed for compression under a policy.
 * Mirrors whitelist.collectCompressibleToolIndices with a defensive wrapper.
 */
export function compressibleToolIndices(body, policy) {
  try {
    return require("./rtk/whitelist.js").collectCompressibleToolIndices(body, policy);
  } catch {
    return [];
  }
}

/**
 * Inspect assistant tool_calls for malformed arguments; optionally repair in place.
 * @returns {{ repaired: number, broken: number, warnings: string[] }}
 */
export function inspectToolCalls(body, repair) {
  const out = { repaired: 0, broken: 0, warnings: [] };
  try {
    const items = Array.isArray(body.messages) ? body.messages
      : (Array.isArray(body.input) ? body.input : null);
    if (!items) return out;

    for (const msg of items) {
      if (!msg || typeof msg !== "object") continue;
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls
        : (Array.isArray(msg.output) ? msg.output : null);
      if (!calls) continue;
      for (const tc of calls) {
        if (!tc?.function || typeof tc.function.arguments !== "string") continue;
        const parsed = repairToolArguments(tc.function.arguments);
        if (parsed.ok) {
          if (parsed.repaired && repair.rescue) {
            try { tc.function.arguments = JSON.stringify(parsed.value); out.repaired++; } catch { }
          } else if (parsed.repaired) {
            out.warnings.push(`repairable:${tc.function.name || "?"}`);
            out.broken++;
          }
        } else {
          out.broken++;
          if (shouldRetryToolCall(tc, { repairsLeft: repair.retries ?? 1, retryableModels: repair.retryableModels ?? [] })) {
            out.warnings.push(`retry:${tc.function.name || "?"}`);
          }
        }
      }
    }
  } catch {
    return out;
  }
  return out;
}

// Barrel re-exports for direct import use.
export { estimateBodyTokens, tokenDelta } from "./rtk/tokenMeter.js";
export { shouldCompressTool, collectCompressibleToolIndices } from "./rtk/whitelist.js";
export { guardedInjectCaveman, guardedInjectPonytail, isEndUserFacing } from "./transform/index.js";
export { repairToolArguments, shouldRetryToolCall } from "./toolcall/repair.js";
export { rankByCacheWarm, pickCacheWarmModel } from "./cache/awareRouting.js";
export { createSemanticCache } from "./cache/semantic.js";
export { createIdempotencyStore } from "./idempotency/index.js";
export { classifyComplexity, pickRouteTier } from "./routing/complexity.js";
