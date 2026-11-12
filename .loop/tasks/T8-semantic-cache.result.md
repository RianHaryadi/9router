STATUS: done
FILES CHANGED:
  - src/custom/cache/semantic.js    (new)
  - tests/unit/semantic-cache.test.js  (new)

SUMMARY:
  Semantic cache module (storage/lookup layer only, no pipeline wiring):

  fingerprint(body):
    - Included keys (in body order): model, messages, temperature, max_tokens, top_p, stop,
      tools, tool_choice, response_format.
    - Excluded (cache-busters): user, stream, requestId, metadata, keys starting with `_`.
    - Values stable-serialized (objects → sorted keys; arrays → order-preserving;
      primitives → JSON.stringify) so key order and nested key order can never leak
      into the key, while message tool-call part order stays on the record.
    - Deterministic: same body modulo excluded keys → identical string.

  createSemanticCache({ maxEntries=128, ttlMs=10m, now=Date.now }) returning { get, set, touch, delete, clear, stats }:
    - get(fp) → cached value or null; expired entries are deleted (counted as miss).
    - set(fp, value) → stores { value, expiresAt, hits: 0, createdAt, lastAccess }; caller
      supplies the value verbatim (serialized SSE transcript), per streaming caveat doc.
    - touch(fp) → bumps lastAccess + hits; called by get on hit.
    - LRU eviction (fully-qualifying 'least recently used'): expiry is time-based (now()),
      ordering is a monotonic counter inside `word()` because a fake/stepping clock that
      returns repeated values must still give a total order to entries.
    - stats() → { size, hits, misses, evictions }.
    - No module-level singleton (factory creates own state); no external deps; pure ESM.

  Note: LRU tie-break bug fixed during GREEN cycle (clock-only lastAccess made consecutive
  sets collide under t==t, evicting the *newest* inserts on maxEntries runs).

EVIDENCE:
  eslint:
    $ cd /home/kennyh/Documents/9router && npx eslint src/custom/cache/semantic.js tests/unit/semantic-cache.test.js
    ESLint: No issues found

  vitest (verbose, real run):
    $ cd /home/kennyh/Documents/9router/tests && npx vitest run unit/semantic-cache.test.js --reporter=verbose
    Test Files  1 passed (1)
    Tests  20 passed (20)
    (20 tests: fingerprint x12 incl. tools/tool_choice/non-string content ordering
     + cache x8 incl. expiry, LRU, counters, delete, clear, verbatim values)

  Test-driven: write test file first →
    $ cd /home/kennyh/Documents/9router/tests && npx vitest run unit/semantic-cache.test.js
    Error: Cannot find module '../../src/custom/cache/semantic.js' imported from ...
    (RED) → then implement; subsequent run: 20 pass, 0 fail.

NOTES:
  - No testing of a live DB or system clock: all tests inject `now` or use a counter.
  - Wiring into chat.js / chatCore.js is out of scope (orchestrator does that later) — no
    touches to src/sse/**, open-sse/**, src/custom/pipeline.js, src/custom/budget/**, src/app/**.
  - test file placed in tests/unit/<name>.test.js per dispatch, not under tests/unit/budget.test.js.
