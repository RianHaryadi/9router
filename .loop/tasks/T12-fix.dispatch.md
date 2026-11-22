# T12-FIX — Fix chat.js cache wiring bugs + orphaned files (worker-cache)

Repo: /home/kennyh/Documents/9router
Branch: feat/transform-pipeline
Pane: worker-cache (w1A:p2)

## Context
Your T12 work landed: `src/custom/wiring/serveCache.js` (28 tests green) and
`tests/unit/serve-cache.test.js`. The review found that the WIRING in
`src/sse/handlers/chat.js` does NOT use `serveCache.js` — it calls the raw
`responseCache` facade directly and the status-vocabulary does not match the
idempotency store contract. Fix the wiring to use `serveCache.js`.

## ID -> file:line map (current working tree)
1. `src/sse/handlers/chat.js:41` — `import { createResponseCache, captureStreamResponse, replayResponse, digestBody } from "@/custom/wiring/responseCache.js";`
2. `src/sse/handlers/chat.js:43` — `const responseCache = createResponseCache();`
3. `src/sse/handlers/chat.js` — "Idempotency Gate (pre-flight)" block: uses `idempotencyClaim.entry?.result` and `status === "in_progress"` (underscore)
4. `src/sse/handlers/chat.js` — "Semantic Cache Gate (pre-flight)" block: calls `responseCache.getSemantic(body)` directly
5. `src/sse/handlers/chat.js` — post-flight `if (res && res.status >= 200 ...)` block: checks `idempotencyClaim?.status === "new"`
6. `src/custom/pipeline.js` — last line: `export { createResponseCache, captureStreamResponse, replayResponse, digestBody } from "./wiring/responseCache.js";` (duplicate barrel export)
7. `tests/translator/__snapshots__/golden-url-header.test.js.snap` — modified (chatgpt-web / deepseek-web golden entries added)

## Files Owned (ONLY edit these)
- `src/sse/handlers/chat.js`
- `src/custom/pipeline.js` (only to remove line 6 above)
- `tests/unit/chat-cache-wiring.test.js` (update assertions if needed)
- `tests/translator/__snapshots__/golden-url-header.test.js.snap`
- `.loop/tasks/T12-fix.result.md` (NEW)

## Files Forbidden
- `src/custom/wiring/serveCache.js` (correct as-is — do NOT modify)
- `src/custom/wiring/responseCache.js`
- `tests/unit/serve-cache.test.js`
- Any other file

## Required changes in chat.js
1. Replace the `@/custom/wiring/responseCache.js` import + `const responseCache = createResponseCache();` with a single import of the serveCache facade:
   ```js
   import {
     getResponseCache,
     lookupIdempotency,
     lookupSemantic,
     captureAndStore,
     replayResponse,
   } from "@/custom/wiring/serveCache.js";
   ```
   (replayResponse IS re-exported by serveCache? Check first: if not, import it directly from `@/custom/wiring/responseCache.js` instead — do not modify serveCache.js.)

2. Rewrite the pre-flight idempotency gate to use `lookupIdempotency`:
   ```js
   const idempotencyResult = lookupIdempotency({ idempotencyKey, body });
   if (idempotencyResult?.type === "replay") {
     const cached = idempotencyResult.value;
     return replayResponse({
       bodyText: cached.bodyText,
       status: cached.status || 200,
       headers: cached.headers || {},
       cacheType: "idempotency",
     });
   }
   if (idempotencyResult?.type === "in-progress") {
     return errorResponse(409, "concurrent request in progress with this idempotency key");
   }
   if (idempotencyResult?.type === "conflict") {
     return errorResponse(422, "idempotency key reused with different request payload");
   }
   ```
   Store `const idempotencyFirstClaim = idempotencyResult?.type === "in-progress" && idempotencyResult.seq === 1;`
   for the post-flight gate (first claim for this request).

3. Rewrite the pre-flight semantic gate to use `lookupSemantic({ body, model: modelStr })`
   and replay `idempotencyResult-style` hit via `replayResponse({ bodyText: hit.value.value, status: hit.value.status, headers: hit.value.headers, cacheType: "semantic" })`
   (lookupSemantic returns `{ type: 'replay', value: { value, headers, status, model } }` — read serveCache.js to confirm the exact shape before writing the assertion).

4. Post-flight: replace the whole `if (res && res.status >= 200 ...) { ... captureStreamResponse(res, (capturedText, meta) => {...}) }` block with:
   ```js
   if (res) {
     return captureAndStore({
       response: res,
       body,
       idempotencyKey: idempotencyFirstClaim ? idempotencyKey : null,
       model: modelStr,
     });
   }
   ```
   (captureAndStore already gates semantic store on status<400 + non-empty text; the idempotency store must NOT run for the 2nd/3rd claim of the same key — hence `idempotencyFirstClaim ? idempotencyKey : null`.)
   Drop the final `return res;` (captureAndStore returns the client-facing response).

5. `src/custom/pipeline.js` — delete the duplicate re-export line 6 (serveCache.js is imported directly by chat.js; no need to route through the pipeline barrel).

## Snapshot decision
Run `cd tests && npx vitest run translator/golden-url-header.test.js` WITH the current snapshot file in place.
- If all pass: keep the snapshot change and note "kept: golden snapshot update for new providers".
- If still 7 fail: `git checkout -- tests/translator/__snapshots__/golden-url-header.test.js.snap` and note "reverted: pre-existing snapshot drift, not T12's concern".
Either way, record the command + output in the artifact.

## Verification
```bash
cd /home/kennyh/Documents/9router && npx eslint src/sse/handlers/chat.js src/custom/pipeline.js tests/unit/chat-cache-wiring.test.js
cd /home/kennyh/Documents/9router/tests && npx vitest run unit/chat-cache-wiring.test.js unit/serve-cache.test.js unit/response-cache.test.js
cd /home/kennyh/Documents/9router/tests && npx vitest run translator/golden-url-header.test.js
```
`chat-cache-wiring.test.js` must assert the NEW status vocabulary (replay / in-progress / conflict via lookupIdempotency). If existing assertions reference `.entry?.result` or `"in_progress"`, update them.

## Artifact
Write `.loop/tasks/T12-fix.result.md` in the standard
`STATUS / FILES CHANGED / SUMMARY / EVIDENCE / NOTES` format.
NOTES must name: (a) exact chat.js line changes, (b) snapshot decision + evidence,
(c) which assertions in chat-cache-wiring.test.js changed and why.

Do NOT commit. Do NOT stage.
