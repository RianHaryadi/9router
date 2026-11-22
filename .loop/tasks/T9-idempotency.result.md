# T9 — Idempotency module (worker-t5-test / w1A:p3)

STATUS: done

FILES CHANGED:
- src/custom/idempotency/index.js (NEW)
- tests/unit/idempotency.test.js (NEW)

SUMMARY:
Skill loaded (langkah wajib): `test-driven-development` via hermes-brain `hermes_skill_get(name="test-driven-development")` — TDD (RED→GREEN) applied: 23 test cases ditulis duluan, test gagal atas module missing (RED), kemudian implementasi minimal di src/custom/idempotency/index.js, test lulus semua (GREEN), eslint bersih.
- In-memory LRU+TTL idempotency store: createIdempotencyStore({ maxEntries, ttlMs, now }) membentuk claim/complete/get/seq/invalidate/clear/stats.
- claim(): first claim → in-progress seq=1; same digest replay → completed+value (no re-execution); different digest → conflict/expectedDigest.
- complete(): return false if key missing, digest mismatch, or already-completed (no resurrection/overwrite).
- seq(): monotonik per key (1,2,3…).
- TTL lazy expiry on access (in-progress only), LRU eviction at maxEntries, stats { size, completed, inProgress, evictions, conflicts }.
- Multi-process locking dinyatakan OUT OF SCOPE di header comment.

NOTES:
- Sesuai dispatch: wiring ke request pipeline (chat.js/chatCore.js) DIJANGKAN setelah ini oleh orchestrator — file ini tidak menyentuh src/sse/**, open-sse/**, src/custom/pipeline.js, budget/**, cache/**, app/**.
- Tidak ada DB; semua in-process di RAM.


EVIDENCE (perintah + output):
```
cd /home/kennyh/Documents/9router && npx eslint src/custom/idempotency/index.js tests/unit/idempotency.test.js
```
```
ESLint: No issues found
ESLINT_EXIT=0
```
```
cd /home/kennyh/Documents/9router/tests && PATH=/home/kennyh/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH npx vitest run unit/idempotency.test.js --reporter=verbose
```
```
RUN  v4.1.12 /home/kennyh/Documents/9router/tests
 ✓ unit/idempotency.test.js > src/custom/... claim — first attempt > returns in-progress with seq=1 on first claim
 ✓ unit/idempotency.test.js > src/custom/... claim — in-progress (same digest, not completed) > returns in-progress again with seq=2
 ✓ unit/idempotency.test.js > src/custom/... complete > marks in-progress entry completed; get returns completed+value
 ✓ ... > complete > complete on missing key returns false
 ✓ ... > complete > complete with wrong digest returns false (no overwrite)
 ✓ ... > complete > complete on already-completed key returns true (idempotent no-op)
 ✓ ... > claim — replay after complete (same digest) > returns completed with original value, NOT re-executed
 ✓ ... > claim — replay after complete (DIFFERENT digest) > returns conflict with expectedDigest
 ✓ ... > claim — replay after complete (DIFFERENT digest) > conflict does NOT overwrite the stored value
 ✓ ... > seq — monotonic per key > increments per claim attempt for same key
 ✓ ... > seq — monotonic per key > different keys have independent seq
 ✓ ... > seq — monotonic per key > seq for missing key returns 0
 ✓ ... > get — missing key > returns status=missing
 ✓ ... > invalidate > removes the entry; subsequent claim is fresh (seq resets to 1)
 ✓ ... > invalidate > invalidate on missing key is a no-op (no throw)
 ✓ ... > clear > removes all entries
 ✓ ... > stats > reports size, completed, inProgress, evictions, conflicts
 ✓ ... > stats > counts conflicts
 ✓ ... > TTL expiry (lazy, via injected now) > expired entry behaves as missing on access
 ✓ ... > TTL expiry (lazy, via injected now) > TTL does not apply to completed entries
 ✓ ... > LRU eviction at maxEntries > evicts least-recently-used entry when over maxEntries
 ✓ ... > LRU eviction at maxEntries > access bumps LRU position (get counts as access)
 ✓ unit/idempotency.test.js > src/custom/idempotency > createIdempotencyStore — defaults > returns object with claim/complete/get/seq/invalidate/clear/stats
  Test Files  1 passed (1)
        Tests   23 passed (23)
```

VERDICT: RED → GREEN → lint bersih. Semua 23 test lulus.
Do not commit. Do not stage.
