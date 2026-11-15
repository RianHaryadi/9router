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

import { createShadowRouter } from "../routing/shadow.js";

let router = null;
const records = [];

/** Build the router from the current settings (cached until settings change). */
function routerFor(config) {
  if (!router) router = createShadowRouter({ config });
  return router;
}

/** Drop the cached router (used when settings change and in tests). */
export function resetShadowRouter() {
  router = null;
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

    r.record({
      requestId,
      primary: modelInfo ? { provider: modelInfo.provider, model: modelInfo.model } : null,
      shadow: plan.shadow,
      primaryText,
      shadowText,
      latencyMs: Date.now() - startedAt,
      error,
    });
    records.push({ requestId, shadow: plan.shadow, error, at: startedAt });
    if (records.length > 200) records.shift();
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
 * Recent shadow dispatches, newest last. Used by the dashboard to show what
 * shadowing has been doing.
 */
export function recentShadowDispatches(limit = 50) {
  return records.slice(-limit).reverse();
}

/** Aggregated shadow statistics from the router. */
export function shadowStats() {
  try {
    return router ? router.stats() : { total: 0, compared: 0, matched: 0, errors: 0, byTarget: {} };
  } catch {
    return { total: 0, compared: 0, matched: 0, errors: 0, byTarget: {} };
  }
}
