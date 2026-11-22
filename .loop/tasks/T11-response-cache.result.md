STATUS: done
FILES CHANGED:
  - src/custom/wiring/responseCache.js  (new)
  - tests/unit/response-cache.test.js  (new)

SUMMARY:
  Response cache & replayer wiring module bridging the semantic cache
  (src/custom/cache/semantic.js) and the idempotency store
  (src/custom/idempotency/index.js) with Web-standard Response /
  ReadableStream capture & replay. Pure ESM, zero external deps
  (node:crypto + Web Response/ReadableStream/TextDecoder).

  digestBody(body):
    - SHA-256 hex digest. String bodies hashed directly; objects hashed via a
      stable (sorted-key) JSON serialization so key order can never vary the
      digest. null/undefined → empty string.

  captureStreamResponse(response, onCaptured):
    - Streaming branch (response.body with .tee): body.tee() → [client, cache];
      cache copy pumped to completion with getReader() + TextDecoder, then
      onCaptured(fullText, { status, headers }). Returns a NEW
      Response(clientStream, { status, statusText, headers }) so the client
      gets an independent, fully-readable stream.
    - Non-streaming branch (no tee-able body): response.clone().text() async →
      onCaptured(text, { status, headers }); returns the original response.
    - Fail-open at every layer: capture callback errors, stream read errors,
      and any top-level throw all return the original Response untouched; the
      client stream is never broken by caching.

  replayResponse({ bodyText, status=200, headers={}, cacheType='semantic' }):
    - new Response(bodyText, { status, headers: { ...headers, 'x-9router-cache': cacheType } }).
      Input headers object is not mutated (spread).

  createResponseCache({ semanticOpts, idempotencyOpts }):
    - Facade over createSemanticCache + createIdempotencyStore.
    - getSemantic(body) / setSemantic(body, value, { headers, status, ttlMs, model })
      — keys via fingerprint(body); value stored verbatim.
    - claimIdempotency / completeIdempotency / getIdempotency — thin delegates;
      completeIdempotency stores { bodyText, headers, status } as the value.
    - stats() → { semantic: { size, hits, misses, evictions }, idempotency: { size, completed, inProgress, evictions, conflicts } }.
    - clear() empties both stores.

EVIDENCE:
  eslint:
    $ cd /home/kennyh/Documents/9router && npx eslint src/custom/wiring/responseCache.js tests/unit/response-cache.test.js
    ESLint: No issues found

  vitest (verbose, real run):
    $ cd /home/kennyh/Documents/9router/tests && npx vitest run unit/response-cache.test.js --reporter=verbose
    Test Files  1 passed (1)
    Tests  26 passed (26)

  Coverage: digestBody x5 (hex format, key-order stability, content divergence,
  string bodies, null/undefined) · captureStreamResponse streaming x3 (tee bytes
  identical to capture, status/header preservation, independent client reads) ·
  non-streaming x2 (clone().text() capture with original returned, string body
  stays readable) · fail-open x3 (throwing onCaptured, null/undefined input,
  stream read failure still delivers client) · replayResponse x4 (headers +
  x-9router-cache tag, defaults, custom cacheType, input-headers not mutated) ·
  createResponseCache x9 (semantic hit/miss, stats counters, idempotency
  claim→complete→replay, digest conflict, missing key, stats shape, clear,
  injectable semanticOpts ttl/now).

  Test-driven: tests written first against the specified API; captureStreamResponse
  initial implementation failed 7/26 cases — root cause: ReadableStream.getReader()
  returns a reader (not a promise) and was being chained with .then(), which broke
  the tee pump and left the client stream locked. Fixed with a proper recursive
  reader.read() pump. Subsequent run: 26 pass, 0 fail.

NOTES:
  - Node (undici) wraps string bodies in a ReadableStream, so the tee branch also
    handles plain string responses; the clone().text() branch is reached only for
    body-less Responses (e.g. status-only responses).
  - claimIdempotency passes an optional third `opts` argument through; the current
    idempotency store accepts (key, digest) only, so extra opts are ignored — kept
    for forward compatibility with a future store signature.
  - No touches to open-sse/**, src/sse/**, src/lib/**, src/app/**, or any existing
    test or custom module. Pipeline wiring (chat.js / orchestrator) is out of scope
    and deferred.
  - All tests deterministic; no network, no wall clock (injectable `now` used for
    the TTL test).
