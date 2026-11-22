STATUS: done
FILES CHANGED:
  - src/custom/wiring/serveCache.js  (new)
  - tests/unit/serve-cache.test.js  (new)
  - .loop/tasks/T12-serve-cache.result.md  (new)

SUMMARY:
  Request-path wiring for the semantic cache + idempotency store, as a
  module-scope singleton facade over the T11 responseCache helpers.

  Exports:
    - getResponseCache(): lazily-created process-wide createResponseCache().
    - __resetForTests(): drops + recreates the singleton (test isolation).
    - lookupIdempotency({ idempotencyKey, body }):
        no key → null.
        claim → { type: 'replay', value } | { type: 'in-progress', seq }
              | { type: 'conflict', expectedDigest }.
    - lookupSemantic({ body, model }):
        hit → { type: 'replay', value } ; entry scoped to a different model
        (case-sensitive) → miss (null).
    - storeIdempotency({ idempotencyKey, body, bodyText, headers, status }):
        no key → no-op; else completeIdempotency(key, digestBody(body), {...}).
    - storeSemantic({ body, model, bodyText, headers, status }):
        skips status >= 400 and empty bodyText (never poison the cache);
        else setSemantic(body, bodyText, { headers, status, model }).
    - captureAndStore({ response, body, idempotencyKey, model }):
        captureStreamResponse(response, (text, meta) => { storeSemantic;
        storeIdempotency; }) — client-facing Response returned immediately.
    - shouldServeCache({ method, path }):
        true iff POST (case-insensitive) + path includes '/chat/completions'.

EVIDENCE:
  eslint:
    $ cd /home/kennyh/Documents/9router && npx eslint src/custom/wiring/serveCache.js tests/unit/serve-cache.test.js
    ESLint: No issues found

  vitest (new tests, real run):
    $ cd /home/kennyh/Documents/9router/tests && npx vitest run unit/serve-cache.test.js
    Test Files  1 passed (1)
    Tests  28 passed (28)

  Regression (sibling suites untouched, all green):
    $ cd /home/kennyh/Documents/9router/tests && npx vitest run unit/response-cache.test.js unit/semantic-cache.test.js unit/idempotency.test.js
    Test Files  3 passed (3)
    Tests  69 passed (69)

  Coverage: singleton + reset x2 · lookupIdempotency x6 (no-key null, in-progress
  seq 1/2, replay after complete, digest conflict, key-order-stable digest) ·
  storeIdempotency x3 (no-op without key, retrievable after claim, ghost-key
  no-crash) · lookupSemantic x5 (empty miss, hit replay, model-mismatch miss,
  case-sensitive compare, unscoped entry matches any model) · storeSemantic x3
  (400/401/429/500/503 all skipped, empty/undefined/null bodyText skipped, 2xx
  stored) · captureAndStore x5 (streaming client text + async semantic store,
  idempotency claim→capture→replay end-to-end via real ReadableStream,
  non-streaming JSON stored, 500 streamed but NOT cached, full miss→capture→
  replay flow) · shouldServeCache x4 (POST + chat path, case-insensitive method,
  non-chat paths, non-POST, missing inputs).

NOTES:
  - Singleton state is per-process by design (single Node process); __resetForTests
    is the only state drop and is test-only.
  - lookupIdempotency CLAIMS the key on every call (in-progress bumps seq). The
    pipeline must treat 'in-progress' as "someone else is already running this"
    and either wait, drop, or surface a 409-style conflict — that decision is the
    orchestrator's, not this module's.
  - captureAndStore stores asynchronously; callers that need the store to be
    populated before the next request must await the stream drain (or a short
    poll) — the client-facing Response is always returned immediately.
  - No touches to open-sse/**, src/sse/**, src/lib/**, src/app/**,
    src/custom/wiring/responseCache.js, or any existing test file.
  - Not committed, not staged.
