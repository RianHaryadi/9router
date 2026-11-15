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
import { createSimilarityIndex } from "../cache/similarity.js";

let cache = null;
// Near-duplicate index: serves a body that is ~the same as a cached one.
let similarityIndex = null;

/** Lazily-created process-wide response cache singleton. */
export function getResponseCache() {
  if (!cache) cache = createResponseCache();
  return cache;
}

/** Lazily-created process-wide similarity index singleton. */
export function getSimilarityIndex() {
  if (!similarityIndex) similarityIndex = createSimilarityIndex();
  return similarityIndex;
}

/** Test-only: drop and recreate the singletons. */
export function __resetForTests() {
  cache = null;
  similarityIndex = null;
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
 * Similarity cache lookup for a chat-completions-style body.
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

/**
 * Near-duplicate lookup: serve a cached answer for a body that is *almost*
 * the same as a stored one (token-overlap >= threshold).
 *
 * Opt-in: the caller must pass `enabled`, because a near-duplicate answer is
 * not identical to what the provider would say today. Model-scoped exactly
 * like the exact-match cache — a different model never borrows an answer.
 *
 * @returns null | { type: 'replay', value: { value, headers, status, model }, score }
 */
export function lookupSimilarity({ body, model, enabled = false, threshold = 0.85 }) {
  if (!enabled) return null;
  try {
    const hit = getSimilarityIndex().find(body);
    if (!hit) return null;
    const stored = hit.entry;
    if (!stored) return null;
    if (stored.model !== undefined && model !== undefined && stored.model !== model) return null;
    return {
      type: "replay",
      value: { value: stored.value, headers: stored.headers, status: stored.status, model: stored.model },
      score: hit.score,
    };
  } catch {
    return null; // fail-open: a cache problem never breaks a request
  }
}

/**
 * Store a response under BOTH the exact-match and the similarity index.
 * The similarity entry mirrors the exact one so a near-duplicate request can
 * be answered with the same cached body.
 */
export function storeSimilarity({ body, model, bodyText, headers, status, enabled = false }) {
  if (!enabled) return;
  if (status !== undefined && status >= 400) return;
  if (bodyText === undefined || bodyText === null || bodyText === "") return;
  try {
    getSimilarityIndex().add(body, { value: bodyText, headers, status, model });
  } catch {
    // fail-open
  }
}

/**
 * Store a completed response under the idempotency key. No key → no-op.
 *
 * An error response is never stored. Replaying a stored 500 would make a
 * transient upstream failure permanent for the whole TTL of the key, and the
 * client would keep receiving the same error even after the provider
 * recovered. The semantic cache already skips >= 400 for the same reason.
 *
 * The claim is *released* rather than left half-finished: an in-progress
 * entry makes every later retry with the same key look like a concurrent
 * request and get rejected with 409.
 */
export function storeIdempotency({ idempotencyKey, body, bodyText, headers, status }) {
  if (!idempotencyKey) return;
  const digest = digestBody(body);
  const failed = (status !== undefined && status !== null && status >= 400)
    || bodyText === undefined || bodyText === null || bodyText === "";
  if (failed) {
    getResponseCache().releaseIdempotency(idempotencyKey, digest);
    return;
  }
  getResponseCache().completeIdempotency(idempotencyKey, digest, {
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
export function captureAndStore({ response, body, idempotencyKey, model, similarityEnabled = false }) {
  return captureStreamResponse(response, (text, { status, headers }) => {
    storeSemantic({ body, model, bodyText: text, headers, status });
    storeSimilarity({ body, model, bodyText: text, headers, status, enabled: similarityEnabled });
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
  getSimilarityIndex,
  __resetForTests,
  lookupIdempotency,
  lookupSemantic,
  lookupSimilarity,
  storeIdempotency,
  storeSemantic,
  storeSimilarity,
  captureAndStore,
  shouldServeCache,
};

export default serveCache;
