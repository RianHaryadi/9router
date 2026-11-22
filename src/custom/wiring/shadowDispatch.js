/**
 * shadowDispatch.js — wire the shadow router to the request path.
 *
 * The shadow engine (src/custom/routing/shadow.js) only DECIDES. This module
 * performs the actual side-by-side dispatch: after the primary answer is
 * ready, a copy of the same request is sent to the shadow target and the two
 * answers are compared.
 *
 * The dispatcher is INJECTED, not imported, so this module never depends on
 * the chat handler and cannot create an import cycle. The caller passes a
 * function with the same shape as handleChat.
 *
 * The shadow dispatch is fully fire-and-forget: it runs AFTER the primary
 * response has been handed to the client, it never delays the user, and any
 * failure inside it is swallowed (a shadow must never break production).
 */

import { createShadowRouter, compareResponses } from "../routing/shadow.js";

let router = null;
let routerConfigKey = null;
const records = [];
const MAX_RECORDS = 200;

/**
 * Build the router from the current settings.
 *
 * The router is rebuilt whenever the CONFIG changes. Caching it forever meant
 * that turning shadow routing on, changing the ratio or editing the targets
 * had no effect until the process restarted — the first request happened to
 * build the router and every later request reused it with the stale config.
 */
function routerFor(config) {
  const key = JSON.stringify({
    enabled: !!config?.enabled,
    ratio: Number(config?.ratio) || 0,
    targets: Array.isArray(config?.targets) ? config.targets : [],
  });
  if (!router || routerConfigKey !== key) {
    router = createShadowRouter({ config });
    routerConfigKey = key;
  }
  return router;
}

/** Drop the cached router (used when settings change and in tests). */
export function resetShadowRouter() {
  router = null;
  routerConfigKey = null;
  records.length = 0;
}

/**
 * Dispatch a shadow copy of a request and record the comparison.
 *
 * @param {object} opts
 * @param {string} opts.requestId   sampling key (deterministic)
 * @param {object} opts.modelInfo   { provider, model } of the primary
 * @param {object} opts.body        the primary request body (already parsed)
 * @param {object} opts.config      { enabled, ratio, targets }
 * @param {function} opts.dispatch  (body, meta) => Promise<Response> — the
 *   caller's chat dispatcher, must NOT include the primary answer
 * @param {string} [opts.primaryText] the primary answer text, when known
 * @returns {Promise<null>} always resolves to null — shadow work never
 *   surfaces an error to the caller
 */
export async function dispatchShadow({ requestId, modelInfo, body, config, dispatch, primaryText = "" }) {
  try {
    if (!config?.enabled) return null;
    if (typeof dispatch !== "function") return null;
    const r = routerFor(config);
    const plan = r.plan({ requestId, modelInfo });
    if (!plan?.shadow) return null;

    const shadowBody = {
      ...body,
      model: plan.shadow.model.includes("/")
        ? plan.shadow.model
        : `${plan.shadow.provider}/${plan.shadow.model}`,
      stream: false,
    };

    const startedAt = Date.now();
    let shadowText = "";
    let error = null;
    try {
      const response = await dispatch(shadowBody, { shadow: true, plan });
      const text = await response.text();
      shadowText = extractText(text);
      if (!response.ok) error = `HTTP ${response.status}`;
    } catch (e) {
      error = e?.message || String(e);
    }

    const comparison = { requestId, primary: modelInfo ? { provider: modelInfo.provider, model: modelInfo.model } : null, shadow: plan.shadow, primaryText, shadowText, latencyMs: Date.now() - startedAt, error, at: startedAt };
    r.record(comparison);
    records.push(comparison);
    if (records.length > MAX_RECORDS) records.shift();
    return null;
  } catch {
    // fail-open: shadowing must never affect the primary request
    return null;
  }
}

/** Pull the assistant text out of a chat-completion JSON body. */
function extractText(raw) {
  try {
    const data = JSON.parse(raw);
    return data?.choices?.[0]?.message?.content
      ?? data?.choices?.[0]?.text
      ?? data?.output_text
      ?? data?.text
      ?? "";
  } catch {
    return "";
  }
}

/**
 * Recent shadow dispatches, newest first. Used by the dashboard to show what
 * shadowing has been doing.
 *
 * @param {number} [limit=50]
 * @returns {object[]}
 */
export function recentShadowDispatches(limit = 50) {
  return records.slice(-limit).reverse();
}

/**
 * Aggregated shadow statistics.
 *
 * Computed from the module-level records, NOT from the router: the router is
 * rebuilt whenever the settings change, and its own store would start empty
 * at that point. The module-level records survive the rebuild.
 *
 * @returns {{ total: number, compared: number, matched: number, errors: number,
 *            matchRate: number, byTarget: Record<string, number> }}
 */
export function shadowStats() {
  try {
    const byTarget = {};
    let compared = 0;
    let matched = 0;
    let errors = 0;
    for (const entry of records) {
      if (entry?.primaryText && entry?.shadowText) {
        compared++;
        const result = compareResponses(entry.primaryText, entry.shadowText);
        if (result.matched) matched++;
      }
      if (entry?.error) errors++;
      const shadow = entry?.shadow;
      if (shadow && typeof shadow.provider === "string" && typeof shadow.model === "string") {
        const key = `${shadow.provider}/${shadow.model}`;
        byTarget[key] = (byTarget[key] ?? 0) + 1;
      }
    }
    return {
      total: records.length,
      compared,
      matched,
      errors,
      matchRate: compared > 0 ? matched / compared : 0,
      byTarget,
    };
  } catch {
    return { total: 0, compared: 0, matched: 0, errors: 0, matchRate: 0, byTarget: {} };
  }
}
