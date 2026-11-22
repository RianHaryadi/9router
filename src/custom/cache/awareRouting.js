/**
 * awareRouting.js — pick a provider/model from a combo that is most likely to
 * have a warm provider cache, without any upstream-side cache API.
 *
 * Premise: prompt caching (Anthropic/OpenAI) is keyed on an exact prefix of
 * the conversation. Sticking to the SAME model (and same provider) across the
 * turns of a session keeps that prefix cacheable, so the biggest win is
 * session stickiness to the model already in use. That is what System One's
 * sticky store does for the "smart" combo strategy; this module generalises it
 * to a pure scoring function usable in ANY strategy/flow.
 *
 * Score higher = more cache-friendly. A model scores higher when:
 *   - it equals the model used on the last turn of this session (+3)
 *   - it shares the provider with the last-used model (+1)
 *   - it is marked cachePreferred in config (+1)
 * Tie-break is stable by original order, so rotating combos are not disturbed
 * unless a cache-friendly candidate exists.
 *
 * Pure + fail-open. Never throws.
 */

/**
 * Rank a model list by cache-friendliness.
 * @param {string[]} models - candidate model ids (e.g. combo members)
 * @param {object} ctx - { lastModel, lastProvider, cachePreferred }
 *   lastModel/lastProvider describe the session's previous turn.
 *   cachePreferred is a Set of model ids flagged in config.
 * @returns {string[]} models reordered, cache-friendliest first
 */
export function rankByCacheWarm(models, ctx = {}) {
  if (!Array.isArray(models) || models.length <= 1) return [...(models || [])];
  const { lastModel, lastProvider, cachePreferred } = ctx;

  const modelProvider = (id) => {
    if (typeof id !== "string") return null;
    const slash = id.indexOf("/");
    return slash > 0 ? id.slice(0, slash) : null;
  };

  const scored = models.map((m, idx) => {
    let score = 0;
    if (typeof m === "string" && m === lastModel) score += 3;
    if (typeof m === "string" && lastProvider && modelProvider(m) === lastProvider) score += 1;
    if (cachePreferred instanceof Set && cachePreferred.has(m)) score += 1;
    return { m, score, idx };
  });

  scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
  return scored.map((s) => s.m);
}

/**
 * Convenience: pick exactly ONE model from a combo for cache-warm prefer.
 * Returns the first after ranking; falls back to the first original candidate.
 */
export function pickCacheWarmModel(models, ctx = {}) {
  if (!Array.isArray(models) || models.length === 0) return null;
  return rankByCacheWarm(models, ctx)[0];
}
