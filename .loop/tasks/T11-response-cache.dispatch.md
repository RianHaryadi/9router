# T11 — Response Cache & Replayer Module (worker-cache)

Repo: /home/kennyh/Documents/9router
Branch: feat/transform-pipeline
Pane: worker-cache (w1A:p2, opencode)

## Goal
Build `src/custom/wiring/responseCache.js` and unit test `tests/unit/response-cache.test.js`.
This module bridges `src/custom/cache/semantic.js` and `src/custom/idempotency/index.js` with Web standard `Response` and `ReadableStream` capture/replay mechanics.

## Files Owned (ONLY edit/create these)
- `src/custom/wiring/responseCache.js` (NEW)
- `tests/unit/response-cache.test.js` (NEW)
- `.loop/tasks/T11-response-cache.result.md` (NEW)

## Files Forbidden (DO NOT TOUCH)
- `open-sse/**`
- `src/sse/**`
- `src/lib/**`
- `src/app/**`
- Any existing test or custom module files

## Specifications for `src/custom/wiring/responseCache.js`
Must be pure ESM, zero external npm dependencies (use Node/Web standard `crypto`, `ReadableStream`, `TextDecoder`, `Response`).

1. Imports:
   - `createSemanticCache`, `fingerprint` from `../cache/semantic.js`
   - `createIdempotencyStore` from `../idempotency/index.js`
   - `crypto` from `node:crypto`

2. Helper: `digestBody(body)`
   - Computes sha256 hex digest of `fingerprint(body)` or stable JSON stringify.

3. Helper: `captureStreamResponse(response, onCaptured)`
   - Takes a `Response` object.
   - If `response?.body && typeof response.body.tee === 'function'`:
     - Calls `const [clientStream, cacheStream] = response.body.tee();`
     - Asynchronously reads `cacheStream` using `getReader()` and `TextDecoder`, accumulating text.
     - When stream finishes, calls `onCaptured(accumulatedText, { status: response.status, headers: Object.fromEntries(response.headers.entries()) })`.
     - Wraps stream reading in try/catch to fail open (never throw).
     - Returns `new Response(clientStream, { status: response.status, statusText: response.statusText, headers: response.headers })`.
   - Else (non-streaming or no tee):
     - Try `response.clone().text().then(text => onCaptured(text, { status: response.status, headers: Object.fromEntries(response.headers.entries()) })).catch(() => {})`.
     - Return `response`.
   - Entire function must fail open (if anything throws, return original `response`).

4. Helper: `replayResponse({ bodyText, status = 200, headers = {}, cacheType = 'semantic' })`
   - Returns `new Response(bodyText, { status, headers: { ...headers, 'x-9router-cache': cacheType } })`.

5. Factory: `createResponseCache({ semanticOpts, idempotencyOpts } = {})`
   - Initializes `semanticCache = createSemanticCache(semanticOpts)`
   - Initializes `idempotencyStore = createIdempotencyStore(idempotencyOpts)`
   - Returns object with methods:
     - `getSemantic(body)` -> returns cached entry { value, headers, status } or null
     - `setSemantic(body, value, { headers, status, ttlMs, model } = {})` -> stores in semantic cache
     - `claimIdempotency(key, digest, opts)` -> calls idempotencyStore.claim(key, digest, opts)
     - `completeIdempotency(key, digest, { bodyText, headers, status })` -> calls idempotencyStore.complete
     - `getIdempotency(key)` -> calls idempotencyStore.get(key)
     - `stats()` -> { semantic: semanticCache.stats(), idempotency: idempotencyStore.stats() }
     - `clear()` -> clears both stores

## Verification Requirements
- Test-driven: Write `tests/unit/response-cache.test.js` first.
- Run tests:
  ```bash
  export PATH="/home/kennyh/.local/share/fnm/node-versions/v22.23.4/installation/bin:$PATH"
  cd /home/kennyh/Documents/9router/tests && npx vitest run unit/response-cache.test.js
  ```
- Run linter:
  ```bash
  cd /home/kennyh/Documents/9router && npx eslint src/custom/wiring/responseCache.js
  ```
- Output `.loop/tasks/T11-response-cache.result.md`:
  Format:
  ```markdown
  STATUS: done
  FILES CHANGED:
    - src/custom/wiring/responseCache.js
    - tests/unit/response-cache.test.js
  SUMMARY:
    ...
  EVIDENCE:
    ...
  NOTES:
    ...
  ```
