/**
 * src/custom/wiring/responseCache.js
 *
 * Bridges the semantic cache + idempotency store with Web-standard
 * Response/ReadableStream capture and replay.
 *
 * Pure ESM, zero external deps (node:crypto + Web Response/ReadableStream/TextDecoder).
 *
 * Contract: every code path fails open — a caching failure must never break
 * the request. If capture or storage throws, the original Response is
 * returned untouched.
 */

import { createHash } from "node:crypto";
import { createSemanticCache, fingerprint } from "../cache/semantic.js";
import { createIdempotencyStore } from "../idempotency/index.js";

/**
 * SHA-256 hex digest of a request body.
 * String bodies are hashed directly; objects are hashed via a stable
 * (sorted-key) JSON serialization so key order cannot vary the digest.
 */
export function digestBody(body) {
  let payload;
  if (body == null) payload = "";
  else if (typeof body === "string") payload = body;
  else payload = stableStringify(body);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/**
 * Split a Response's body so the client receives the live stream while a
 * mirror is read to completion for caching.
 *
 * - Streaming (response.body with .tee): tee it, accumulate the cache copy
 *   with a TextDecoder, then invoke onCaptured(fullText, { status, headers }).
 *   The client-side Response is returned immediately.
 * - Non-streaming (no readable body): clone + text() asynchronously.
 *
 * Never throws: any failure returns the original response.
 */
export function captureStreamResponse(response, onCaptured) {
  try {
    if (!response) return response;

    const status = response.status;
    const statusText = response.statusText;
    const headers = Object.fromEntries(response.headers.entries());

    const body = response.body;
    if (body && typeof body.tee === "function") {
      const [clientStream, cacheStream] = body.tee();
      readAndCapture(cacheStream, (text) => {
        try {
          onCaptured(text, { status, headers });
        } catch {
          // fail open: capture callback errors must not break the client stream
        }
      });
      return new Response(clientStream, { status, statusText, headers });
    }

    // Non-streaming: consume a clone without touching the client copy.
    try {
      response
        .clone()
        .text()
        .then((text) => {
          try {
            onCaptured(text, { status, headers });
          } catch {
            // fail open
          }
        })
        .catch(() => {});
    } catch {
      // clone/text unavailable — skip capture
    }
    return response;
  } catch {
    // Fail open: return the original untouched.
    return response;
  }
}

function readAndCapture(stream, onDone) {
  const decoder = new TextDecoder();
  let text = "";
  const reader = stream.getReader();
  const pump = () =>
    reader.read().then(
      ({ done, value }) => {
        if (done) {
          text += decoder.decode(); // flush
          onDone(text);
          return;
        }
        text += decoder.decode(value, { stream: true });
        return pump();
      },
      () => {
        // Fail open: client already got its copy; drop the partial capture.
      }
    );
  pump();
}

/**
 * Rebuild a Response from captured text + metadata, tagging it with the
 * cache source via the x-9router-cache header.
 */
export function replayResponse({ bodyText, status = 200, headers = {}, cacheType = "semantic" }) {
  return new Response(bodyText, {
    status,
    headers: { ...headers, "x-9router-cache": cacheType },
  });
}

/**
 * Create a response-cache facade over the semantic cache and idempotency store.
 *
 * @param {object} [opts]
 * @param {object} [opts.semanticOpts]    options for createSemanticCache
 * @param {object} [opts.idempotencyOpts] options for createIdempotencyStore
 * @returns {{
 *   getSemantic: (body: object|string) => {value, headers, status} | null,
 *   setSemantic: (body: object|string, value: any, meta?: {headers, status, ttlMs, model}) => void,
 *   claimIdempotency: (key: string, digest: string, opts?: object) => object,
 *   completeIdempotency: (key: string, digest: string, result: {bodyText, headers, status}) => boolean,
 *   getIdempotency: (key: string) => object,
 *   stats: () => {semantic: object, idempotency: object},
 *   clear: () => void,
 * }}
 */
export function createResponseCache({ semanticOpts, idempotencyOpts } = {}) {
  const semanticCache = createSemanticCache(semanticOpts);
  const idempotencyStore = createIdempotencyStore(idempotencyOpts);

  return {
    getSemantic(body) {
      return semanticCache.get(fingerprint(body));
    },
    setSemantic(body, value, { headers, status, ttlMs, model } = {}) {
      semanticCache.set(fingerprint(body), { value, headers, status, ttlMs, model });
    },
    claimIdempotency(key, digest, opts) {
      return idempotencyStore.claim(key, digest, opts);
    },
    completeIdempotency(key, digest, { bodyText, headers, status }) {
      return idempotencyStore.complete(key, digest, { bodyText, headers, status });
    },
    getIdempotency(key) {
      return idempotencyStore.get(key);
    },
    stats() {
      return {
        semantic: semanticCache.stats(),
        idempotency: idempotencyStore.stats(),
      };
    },
    clear() {
      semanticCache.clear();
      idempotencyStore.clear();
    },
  };
}

const wiring = {
  digestBody,
  captureStreamResponse,
  replayResponse,
  createResponseCache,
};

export default wiring;
