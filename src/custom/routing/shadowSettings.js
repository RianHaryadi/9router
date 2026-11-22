/**
 * shadowSettings.js — validation for the shadow-routing settings.
 *
 * The shadow settings are written straight into the settings row, so their
 * shape has to be checked at the trust boundary: a ratio of 5 or a target
 * without a model would reach the router and be silently misread.
 *
 * Pure functions, so they can be tested without a database.
 */

/**
 * @typedef {{ provider: string, model: string, weight: number }} ShadowTarget
 */

/**
 * Normalize one shadow target.
 *
 * @param {any} target
 * @returns {{ ok: true, value: ShadowTarget } | { ok: false, error: string }}
 */
export function normalizeShadowTarget(target) {
  const provider = typeof target?.provider === "string" ? target.provider.trim() : "";
  const model = typeof target?.model === "string" ? target.model.trim() : "";
  if (!provider || !model) {
    return { ok: false, error: "each shadowRoutingTargets entry needs a provider and a model" };
  }
  const rawWeight = Number(target?.weight);
  const weight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 1;
  return { ok: true, value: { provider, model, weight } };
}

/**
 * Normalize the shadow-routing settings of a PATCH body.
 *
 * Only the keys present in the body are validated; the others are left
 * untouched so a partial update works.
 *
 * @param {object} body the PATCH body (mutated in place on success)
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function normalizeShadowSettings(body) {
  if (!body || typeof body !== "object") return { ok: true };

  if (Object.prototype.hasOwnProperty.call(body, "shadowRoutingRatio")) {
    const ratio = Number(body.shadowRoutingRatio);
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      return { ok: false, error: "shadowRoutingRatio must be a number between 0 and 1" };
    }
    body.shadowRoutingRatio = ratio;
  }

  if (Object.prototype.hasOwnProperty.call(body, "shadowRoutingTargets")) {
    if (!Array.isArray(body.shadowRoutingTargets)) {
      return { ok: false, error: "shadowRoutingTargets must be an array" };
    }
    const targets = [];
    for (const target of body.shadowRoutingTargets) {
      const result = normalizeShadowTarget(target);
      if (!result.ok) return result;
      targets.push(result.value);
    }
    body.shadowRoutingTargets = targets;
  }

  return { ok: true };
}
