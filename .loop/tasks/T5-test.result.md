# T5 test — audit & fix (worker-t5-test / w1A:p3)

STATUS: done

FILES CHANGED:
- tests/unit/health-dashboard.test.js (rewritten/expanded)

SUMMARY:
Load skill via MCP hermes-brain (langkah 0): `hermes_skills_search(query "vitest unit testing api contract mock", category "software-development")` → return 0 skill yang cocok (tidak ada skill hermes yang match; pakai pola umum + pola dari `tests/unit/observability-api-routes.test.js`). `hermes_memory_search(query "9router vitest contract test stats memory")` → 2 hit-context (MEMORY.md / USER.md), tidak ada skill spesifik; user prefer bahasa Indonesia. Skill yang di-load: tidak ada hermes-skill yang cocok (dilaporkan sebagai temuan).

Audit kontrak (PROMPT-LANJUTAN.md §5) terhadap `health-dashboard.test.js` (commit 6d30d7b3). Temuan yang diperbaiki:
1. Helper pure `formatPercentile`: sebelumnya hanya uji valid number + null. Ditambah coverage NaN, undefined, dan string numerik ("987.6" → "988 ms").
2. Helper pure `stateVariant`: sebelumnya hanya closed/half-open/open. Ditambah kasus default selain 3 state (flapping/""/null → "error"), plus case per-state dipisah jadi test tersendiri.
3. API contract `latencyMs`/`ttftMs`: sebelumnya hanya `toBeTypeOf("object")`. Ditambah cek tiap key wajib (p50, p90, p95, p99, min, max, avg) via `toHaveProperty`.
4. API contract `projects`: sebelumnya cuma isArray. Ditambah cek `total.cost` & `total.requests` number, verifikasi empty-set → total 0/0, dan per-row field (project/cost/requests/promptTokens/completionTokens).
5. API contract `fallbacks`: sebelumnya cuma `summary` object. Ditambah cek `summary.byProvider`, `byReason`, `recent`; plus kasus 400 untuk `since` non-ISO dan junk limit/offset.
6. Determinisme tanpa data nyata: route DB-backed dipanggil dengan `since=2099-01-01T00:00:00.000Z` (+`limit=1`) untuk memaksa empty set. Hal ini penting.

NOTES:
- Perilaku handler thd DB: KETIGA route usage (latency, projects, fallbacks) memanggil `getAdapter()` (src/lib/db/driver.js) yang membuka file DB nyata `~/.9router/db/data.sqlite` (via node:sqlite / better-sqlite3, terlihat di stdout: `[DB] Driver: better-sqlite3 | file: /home/kennyh/.9router/db/data.sqlite`). Jadi handler TIDAK murni tanpa DB.
- Workaround determinisme: route usage dipanggil dengan `since` di tahun 2099 (masa depan) + `limit=1`. Karena semua repo (metricsRepo/fallbackRepo) memfilter `timestamp >= since` / `latencyMs > 0`, ini menjamin hasil kosong (empty set) sehingga shape stabil dan assertion tidak bergantung isi DB nyata. `GET /api/health/breaker` murni in-memory (tidak sentuh DB).
- Tidak ada DB yang di-mock/dibungkus — butuh empty-query, dan itu cukup karena repos menelan error adapter dan return default kosong (catch → defaults), sehingga meski DB kosong pun respons shape tetap stabil. Tidak perlu bungkus.
- Route dilarang sentuh (src/**) — hanya test file yang diubah.

EVIDENCE (command persis + output nyata):
```
cd /home/kennyh/Documents/9router/tests && npx vitest run unit/health-dashboard.test.js --reporter=verbose
```
Output (14 test, semua pass):
```
 RUN  v4.1.12 /home/kennyh/Documents/9router/tests
[DB] Driver: better-sqlite3 | file: /home/kennyh/.9router/db/data.sqlite
 ✓ unit/health-dashboard.test.js > health dashboard — pure helpers > formatPercentile — valid number
 ✓ ... > formatPercentile — null / undefined
 ✓ ... > formatPercentile — NaN
 ✓ ... > formatPercentile — string numeric
 ✓ ... > stateVariant — closed → success
 ✓ ... > stateVariant — half-open → warning
 ✓ ... > stateVariant — open → error
 ✓ ... > stateVariant — unknown state → error default
 ✓ unit/health-dashboard.test.js > GET /api/health/breaker — handler, no DB deps > returns ok + snapshot with required fields
 ✓ unit/health-dashboard.test.js > GET /api/usage/latency — handler, DB-backed > returns ok + latencyMs/ttftMs with required percentile keys + providers array
 ✓ unit/health-dashboard.test.js > GET /api/usage/projects — handler, DB-backed > returns ok + projects array + total with cost & requests numbers
 ✓ unit/health-dashboard.test.js > GET /api/usage/fallbacks — handler, DB-backed > returns ok + events array + summary with byProvider / byReason / recent
 ✓ unit/health-dashboard.test.js > GET /api/usage/fallbacks — handler, DB-backed > rejects a non-ISO since with 400
 ✓ unit/health-dashboard.test.js > GET /api/usage/fallbacks — handler, DB-backed > survives junk limit/offset without throwing
```
(Command yang pasti jalan: command di atas; tidak perlu `--pool=forks` — rolldown tidak error `styleText` di node ini.)

Tidak ada commit. Tidak ada file di luar OWN list yang disentuh.
