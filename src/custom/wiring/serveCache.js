/**
 * src/custom/wiring/serveCache.js
 *
 * Request-path wiring for the semantic cache + idempotency store.
 *
 * On request: check idempotency + semantic cache BEFORE upstream dispatch and
 * replay on hit. On miss: run upstream, capture the response (SSE or JSON)
 * and store it for future hits. All lookups/stores fail open — a cache
 * problem must never break a request.
 *
 * Pure ESM, zero external deps. Module-scope singleton: one cache per process.
 */

import {
  digestBody,
  captureStreamResponse,
  createResponseCache,
} from "./responseCache.js";

let cache = null;

/** Lazily-created process-wide response cache singleton. */
export function getResponseCache() {
  if (!cache) cache = createResponseCache();
  return cache;
}

/** Test-only: drop and recreate the singleton. */
export function __resetForTests() {
  cache = null;
  return getResponseCache();
}

/**
 * Idempotency lookup for an incoming request.
 * @returns null | { type: 'replay', value } | { type: 'in-progress', seq }
 *          | { type: 'conflict', expectedDigest }
 */
export function lookupIdempotency({ idempotencyKey, body }) {
  if (!idempotencyKey) return null;
  const claimed = getResponseCache().claimIdempotency(idempotencyKey, digestBody(body));
  if (claimed.status === "completed") return { type: "replay", value: claimed.value };
  if (claimed.status === "in-progress") return { type: "in-progress", seq: claimed.seq };
  if (claimed.status === "conflict") return { type: "conflict", expectedDigest: claimed.expectedDigest };
  return null;
}

/**
 * Semantic cache lookup for a chat-completions-style body.
 * A stored entry scoped to a different model is treated as a miss.
 * @returns null | { type: 'replay', value: { value, headers, status, model } }
 */
export function lookupSemantic({ body, model }) {
  const hit = getResponseCache().getSemantic(body);
  if (!hit) return null;
  if (hit && hit.model !== undefined && model !== undefined && hit.model !== model) {
    return null; // model-scoped entry for a different model — miss
  }
  return { type: "replay", value: hit };
}

/** Store a completed response under the idempotency key. No key → no-op. */
export function storeIdempotency({ idempotencyKey, body, bodyText, headers, status }) {
  if (!idempotencyKey) return;
  getResponseCache().completeIdempotency(idempotencyKey, digestBody(body), {
    bodyText,
    headers,
    status,
  });
}

/**
 * Store a response in the semantic cache.
 * Skips error statuses (>= 400) and empty bodies — never poison the cache.
 */
export function storeSemantic({ body, model, bodyText, headers, status }) {
  if (status !== undefined && status >= 400) return;
  if (bodyText === undefined || bodyText === null || bodyText === "") return;
  getResponseCache().setSemantic(body, bodyText, { headers, status, model });
}

/**
 * Capture a live (streaming or plain) Response, mirror it into the caches,
 * and return the client-facing Response.
 */
export function captureAndStore({ response, body, idempotencyKey, model }) {
  return captureStreamResponse(response, (text, { status, headers }) => {
    storeSemantic({ body, model, bodyText: text, headers, status });
    storeIdempotency({ idempotencyKey, body, bodyText: text, headers, status });
  });
}

/**
 * Gate: should this request be served through the cache layer?
 * Only POSTs on a chat-completions path qualify.
 */
export function shouldServeCache({ method, path }) {
  if (!method || typeof method !== "string") return false;
  if (method.toUpperCase() !== "POST") return false;
  return typeof path === "string" && path.includes("/chat/completions");
}

const serveCache = {
  getResponseCache,
  __resetForTests,
  lookupIdempotency,
  lookupSemantic,
  storeIdempotency,
  storeSemantic,
  captureAndStore,
  shouldServeCache,
};

export default serveCache;
