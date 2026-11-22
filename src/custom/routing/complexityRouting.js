/**
 * complexityRouting.js — route a request to a model chosen by its complexity.
 *
 * `classifyComplexity` (src/custom/routing/complexity.js) already reduces a
 * request's content surface to { level, score, reasons } and `pickRouteTier`
 * already maps a level to a tier. Neither was ever called: the router used
 * the requested model for everything, so a one-line question and a
 * twenty-tool agent run both landed on the same (usually expensive) model.
 *
 * This module is the missing piece: it turns the classification plus a tier
 * map into a concrete model decision. It is pure, so it can be tested without
 * a database, a network or a router.
 */

import { classifyComplexity } from "./complexity.js";

/**
 * @typedef {'simple'|'medium'|'complex'} ComplexityLevel
 */

/**
 * @typedef {object} ComplexityRoutingConfig
 * @property {boolean} enabled                master switch
 * @property {Partial<Record<ComplexityLevel, string>>} tiers  level → model
 */

/**
 * Validate a tier map coming from the settings.
 *
 * A tier must name a model the router can resolve ("provider/model" or a
 * registered alias). An entry that is not a non-empty string is dropped
 * rather than rejected: one bad tier must not disable the whole feature.
 *
 * @param {any} tiers
 * @returns {Partial<Record<ComplexityLevel, string>>}
 */
export function normalizeComplexityTiers(tiers) {
  const out = {};
  if (!tiers || typeof tiers !== "object") return out;
  for (const level of ["simple", "medium", "complex"]) {
    const value = tiers[level];
    if (typeof value === "string" && value.trim()) out[level] = value.trim();
  }
  return out;
}

/**
 * Decide which model a request should use.
 *
 * The requested model is kept unless a tier explicitly names a different one
 * for the classified level. A level with no tier (or a tier naming the same
 * model) is a no-op.
 *
 * @param {object} opts
 * @param {object} opts.body              the request body
 * @param {string} opts.requestedModel    the model the client asked for
 * @param {ComplexityRoutingConfig} opts.config
 * @param {Function} [opts.classify]      injectable classifier (tests)
 * @returns {{ model: string, changed: boolean, level: ComplexityLevel,
 *             score: number, reasons: string[], reason: string }}
 */
export function resolveComplexityModel({ body, requestedModel, config, classify } = {}) {
  const fallback = {
    model: requestedModel,
    changed: false,
    level: "medium",
    score: 0.5,
    reasons: [],
    reason: "disabled",
  };

  try {
    if (!config || config.enabled !== true) return fallback;

    const tiers = normalizeComplexityTiers(config.tiers);
    if (Object.keys(tiers).length === 0) return { ...fallback, reason: "no-tiers" };

    const classifier = typeof classify === "function" ? classify : classifyComplexity;

    const result = classifier(body);
    const level = result?.level;
    if (level !== "simple" && level !== "medium" && level !== "complex") {
      return { ...fallback, reason: "unclassified" };
    }

    const tier = tiers[level];
    if (!tier) return { ...fallback, level, score: result?.score ?? 0.5, reasons: result?.reasons ?? [], reason: "no-tier" };
    if (tier === requestedModel) {
      return { ...fallback, level, score: result?.score ?? 0.5, reasons: result?.reasons ?? [], reason: "same-model" };
    }

    return {
      model: tier,
      changed: true,
      level,
      score: result?.score ?? 0.5,
      reasons: result?.reasons ?? [],
      reason: `complexity:${level}`,
    };
  } catch {
    // fail-open: a routing decision must never break the request
    return fallback;
  }
}
