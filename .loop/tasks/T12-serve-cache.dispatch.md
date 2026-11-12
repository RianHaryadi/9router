# T12 — Wire semantic cache + idempotency into the request path (worker-cache)

Repo: /home/kennyh/Documents/9router
Branch: feat/transform-pipeline
Pane: worker-cache (w1A:p2, opencode)

## Goal
Serve the semantic cache and idempotency store on the OpenAI-compatible chat path:
- On request: check cache/idempotency BEFORE upstream dispatch; replay cached response on hit.
- On miss: run upstream, capture the SSE/JSON response, store it, stream to client.

## Files Owned (ONLY edit/create these)
- `src/custom/wiring/serveCache.js` (NEW) — all logic lives here
- `tests/unit/serve-cache.test.js` (NEW)
- `.loop/tasks/T12-serve-cache.result.md` (NEW)

## Files Forbidden (DO NOT TOUCH)
- `open-sse/**`
- `src/sse/**`
- `src/lib/**`
- `src/app/**`
- `src/custom/wiring/responseCache.js`
- Any existing test file

## Background (already landed — do not modify)
- `src/custom/wiring/responseCache.js` exports: `digestBody`, `captureStreamResponse(response, onCaptured)`, `replayResponse({bodyText,status,headers,cacheType})`, `createResponseCache({semanticOpts,idempotencyOpts})`.
- `createResponseCache()` facade methods: `getSemantic(body)`, `setSemantic(body,value,{headers,status,ttlMs,model})`, `claimIdempotency(key,digest)`, `completeIdempotency(key,digest,{bodyText,headers,status})`, `getIdempotency(key)`, `stats()`, `clear()`.
- Module-scope singleton is OK in serveCache.js (one cache per process).

## Specifications for `src/custom/wiring/serveCache.js`

Export a module-level singleton plus pure helpers:

1. `getResponseCache()` — lazily-created singleton `createResponseCache()` (module scope). Accept an internal `__resetForTests()` that drops and recreates it.

2. `lookupIdempotency({ idempotencyKey, body })`:
   - If no `idempotencyKey`, return null.
   - `digest = digestBody(body)`; `claimed = cache.claimIdempotency(idempotencyKey, digest)`.
   - `status === 'completed'` → return `{ type: 'replay', value: claimed.value }`.
   - `status === 'in-progress'` → return `{ type: 'in-progress', seq: claimed.seq }`.
   - `status === 'conflict'` → return `{ type: 'conflict', expectedDigest: claimed.expectedDigest }`.

3. `lookupSemantic({ body, model })`:
   - `hit = cache.getSemantic(body)`; if hit has a `model` and it differs from the requested model (case-sensitive), treat as miss.
   - Return `{ type: 'replay', value: hit }` on hit, else null.

4. `storeIdempotency({ idempotencyKey, body, bodyText, headers, status })`:
   - No key → no-op. Else `completeIdempotency(idempotencyKey, digestBody(body), { bodyText, headers, status })`.

5. `storeSemantic({ body, model, bodyText, headers, status })`:
   - `cache.setSemantic(body, bodyText, { headers, status, model })`.
   - Skip storing when `status` >= 400 or when bodyText is empty.

6. `captureAndStore({ response, body, idempotencyKey, model })`:
   - Wraps `captureStreamResponse(response, (text, meta) => { storeSemantic(...); storeIdempotency(...); })` and returns the client-facing Response.

7. Optional but recommended: `shouldServeCache({ method, path })` — false unless POST + path includes `/chat/completions`. Keep it simple.

## Tests (`tests/unit/serve-cache.test.js`)
- Use injected clocks/fakes only, no DB.
- Test lookup replay/in-progress/conflict flows, semantic hit + model-mismatch miss, store skip on status>=400 and empty bodyText, captureAndStore end-to-end via a real ReadableStream Response (pattern: tests/unit/response-cache.test.js).
- Call `__resetForTests()` in beforeEach so singleton state does not leak between tests.

## Verification Requirements
```bash
cd /home/kennyh/Documents/9router && npx eslint src/custom/wiring/serveCache.js tests/unit/serve-cache.test.js
cd /home/kennyh/Documents/9router/tests && npx vitest run unit/serve-cache.test.js
cd /home/kennyh/Documents/9router/tests && npx vitest run unit/response-cache.test.js unit/semantic-cache.test.js unit/idempotency.test.js
```

## Result artifact
Write `.loop/tasks/T12-serve-cache.result.md`:
```
STATUS: done
FILES CHANGED:
  - ...
SUMMARY:
  ...
EVIDENCE:
  ...
NOTES:
  ...
```

Do NOT commit. Do NOT stage. Report the artifact when done.
