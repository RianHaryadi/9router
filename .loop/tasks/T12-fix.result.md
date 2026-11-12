STATUS: done
FILES CHANGED:
  - src/sse/handlers/chat.js
  - src/custom/pipeline.js
  - .loop/tasks/T12-fix.result.md  (new)
  - tests/translator/__snapshots__/golden-url-header.test.js.snap  (reverted to HEAD)

SUMMARY:
  Rewired the chat.js cache layer to use the serveCache facade instead of
  calling the raw responseCache singleton directly. Fixed the status
  vocabulary mismatch (raw claim `in-progress`/`conflict` vs the
  pre-existing underscore `in_progress` in the old code) and the missing
  `lookupIdempotency`/`lookupSemantic`/`captureAndStore` routing.

(a) chat.js line changes:
  - L40: replaced `import { createResponseCache, captureStreamResponse,
    replayResponse, digestBody } from "@/custom/wiring/responseCache.js"` +
    `const responseCache = createResponseCache();` with
    `import { lookupIdempotency, lookupSemantic, captureAndStore }
     from "@/custom/wiring/serveCache.js"` +
    `import { replayResponse } from "@/custom/wiring/responseCache.js"`
    (replayResponse is NOT re-exported by serveCache.js — verified, imported
     directly).
  - L208–233 (Idempotency Gate pre-flight): replaced
    `responseCache.claimIdempotency(idempotencyKey, bodyDigest)` +
    `status === "in-progress" && seq > 1` checks with
    `lookupIdempotency({ idempotencyKey, body })` returning
    `{ type: 'replay'|'in-progress'|'conflict', ... }`. Added
    `idempotencyFirstClaim` flag (seq === 1 on in-progress) for post-flight.
  - L235–251 (Semantic Cache Gate pre-flight): replaced
    `responseCache.getSemantic(body)` with
    `lookupSemantic({ body, model: modelStr })` (model-aware miss on
    different-model entry).
  - L371–395 (Post-flight): replaced the inline
    `captureStreamResponse(res, (text, meta) => {...})` block with
    `captureAndStore({ response: res, body, idempotencyKey:
    idempotencyFirstClaim ? idempotencyKey : null, model: modelStr })`.
    Dropped the trailing `return res;`.

(b) Snapshot decision:
  - Ran `cd tests && npx vitest run translator/golden-url-header.test.js`
    WITH the modified snapshot (chatgpt-web / deepseek-web golden entries):
    7 failed (cline, clinepass, codebuddy-cn, codebuddy-intl, kimi,
    minimax-code, minimax-code-global) — same 7 fail without the change.
  - Decision: REVERTED via `git checkout -- tests/translator/__snapshots__/golden-url-header.test.js.snap`.
  - Reason: the 7 failing providers are pre-existing drift unrelated to T12
    (different provider set than the golden additions). Not T12's concern.

(c) chat-cache-wiring.test.js assertions:
  - No assertion changes needed. The existing 3 tests already assert
    observable behavior (status codes, `x-9router-cache` header, upstream
    call count) which is independent of the internal vocabulary. The
    tests pass unchanged against the new wiring.

EVIDENCE:
  eslint:
    $ cd /home/kennyh/Documents/9router && npx eslint src/sse/handlers/chat.js src/custom/pipeline.js tests/unit/chat-cache-wiring.test.js
    ESLint: No issues found

  vitest (new wiring + siblings, real run):
    $ cd /home/kennyh/Documents/9router/tests && npx vitest run unit/chat-cache-wiring.test.js unit/serve-cache.test.js unit/response-cache.test.js
    Test Files  3 passed (3)
    Tests  57 passed (57)
      - chat-cache-wiring: 3 passed (idempotency replay, 422 conflict, semantic replay)
      - serve-cache: 28 passed
      - response-cache: 26 passed

  vitest (golden-url-header, reverted snapshot):
    $ cd /home/kennyh/Documents/9router/tests && npx vitest run translator/golden-url-header.test.js
    Test Files  1 failed (1)
    Tests  7 failed | 157 passed (164)
    (7 failures: cline, clinepass, codebuddy-cn, codebuddy-intl, kimi,
     minimax-code, minimax-code-global — pre-existing provider header drift,
     not caused by T12 changes)

NOTES:
  - pipeline.js: removed the duplicate barrel re-export
    `export { createResponseCache, captureStreamResponse, replayResponse,
     digestBody } from "./wiring/responseCache.js"` — chat.js imports
    serveCache.js directly; no other file imports those names from pipeline.
  - Not committed, not staged.
