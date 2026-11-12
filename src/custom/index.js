/**
 * src/custom — modular custom layers for the 9router fork.
 *
 * Roadmap keeps custom features HERE (not in upstream files) and touches the
 * core with a single hook. `pipeline.js` is that hook. This barrel re-exports
 * the surface so callers (and tests) import from a stable path.
 */
export { runCustomPipeline, requiresEndUserGuard } from "./pipeline.js";

// Re-export the primitives for direct composition.
export { estimateTokens, estimateBodyTokens, tokenDelta, collectBodyText } from "./rtk/tokenMeter.js";
export { normalizePolicy, shouldCompressTool, collectCompressibleToolIndices } from "./rtk/whitelist.js";
export { guardedInjectCaveman, guardedInjectPonytail, isEndUserFacing } from "./transform/index.js";
export { repairToolArguments, shouldRetryToolCall, autoCloseJson } from "./toolcall/repair.js";
export { rankByCacheWarm, pickCacheWarmModel } from "./cache/awareRouting.js";
export { createInjectionScanner, scanToolResults } from "./guard/injectionFirewall.js";
export { createToolResultStore, applyToolResultStore } from "./toolcall/resultStore.js";
export { detectRole, pickRoleModel, applyRoleRouting } from "./routing/roleAware.js";
export { createCascadeVerifier, createCascadeRunner, canCascade } from "./routing/cascade.js";
export { createLoopGuard, hashToolCall } from "./guard/loopGuard.js";
export { createPolicyEngine } from "./policy/engine.js";
export { createQuotaScheduler, sortAccountsByReset, calculateRemainingPct } from "./budget/quotaScheduler.js";
export { createCostTracker, parseTaskId, parseProject } from "./budget/costAttribution.js";
