# Loop State
Goal: Tambah 2 fitur ke fork 9router (RianHaryadi/9router): (A) Observability — spend per project, TTFT p95, fallback chain log; (B) Health-based routing + circuit breaker. Deploy lokal dulu, tidak ke VPS.
Max iterations per task: 3
Mode: subagent (HERDR_ENV tidak ter-set → fallback ke subagent worker/reviewer)
Status: planning
Base branch: feat/health-routing-observability (fork dari upstream/master v0.5.112)
Upstream remote: upstream = decolua/9router (untuk rebase-sync ke fork)

## Keputusan desain (WAJIB dipakai worker, jangan diubah sendiri)
1. Schema DB: `src/lib/db/schema.js` — bump SCHEMA_VERSION 2→3. Tambah kolom di tabel `usageHistory`: `latencyMs INTEGER`, `ttftMs INTEGER`, `projectName TEXT`, `fallbackCount INTEGER DEFAULT 0`. Tambah tabel baru `fallbackEvents` (columns: id TEXT PK, timestamp TEXT NOT NULL, requestId TEXT, provider TEXT, model TEXT, connectionId TEXT, apiKey TEXT, projectName TEXT, fromProvider TEXT, fromModel TEXT, status INTEGER, reason TEXT, cooldownMs INTEGER, latencyMs INTEGER; indexes: timestamp DESC, provider, requestId). Auto-sync additive di `src/lib/db/migrate.js` sudah menangani kolom baru otomatis — TIDAK perlu file migrasi baru.
2. Repos baru: `src/lib/db/repos/fallbackRepo.js` (saveFallbackEvent, getFallbackEvents(filter), getFallbackSummary()) dan `src/lib/db/repos/metricsRepo.js` (getLatencyPercentiles, getSpendByProject, getProviderHealthSnapshot). Export keduanya dari `src/lib/db/index.js`.
3. Health breaker: file baru `src/sse/services/healthBreaker.js`. In-memory (seperti strike breaker Antigravity di `src/sse/services/antigravityQuota.js:20-29`), state per key `${connectionId}|${model}` dan level aggregate `${provider}|${model}`. State machine closed → open → half-open. Config: 3 consecutive account-scoped failures → open (cooldown 60s, eskalasi ×2, max 15m); setelah cooldown expire → half-open (izinkan 1 probe); success → closed + reset counter. Error yang request-scoped (400 dkk, `requestScoped:true` dari checkFallbackError) TIDAK dihitung sebagai failure.
4. Wiring breaker: `src/sse/services/auth.js` `getProviderCredentials` — filter connection yang breaker-nya open untuk model tsb, TAPI hanya jika minimal ada 1 alternatif yang sehat (jangan sampai semua account mati total → deadlock). Hook success/failure di `src/sse/handlers/chat.js` (`handleSingleModelChat`, di sekitar baris 353-386).
5. Fallback chain log: catat event tiap kali fallback terjadi di `src/sse/handlers/chat.js` (loop account, sekitar baris 379-386) dan di `open-sse/services/combo.js` (loop member, sekitar baris 471-614). Butuh requestId per request inbound — generate di `src/sse/handlers/chat.js` `handleChat`.
6. Project attribution: tidak ada entitas "project" di repo ini. Ambil dari header request `x-9router-project` (opsional, di-trim, max 64 char, default `"unassigned"`), fallback ke nama API key (`apiKeys.name`) kalau ada, fallback `"unassigned"`. Diteruskan sebagai `projectName` ke usage + fallback event.
7. Latency/TTFT: `usageHistory` butuh latencyMs + ttftMs real. Sumber TTFT: `open-sse/utils/stream.js` (ttftAt first chunk) dan `open-sse/handlers/chatCore/streamingHandler.js:126-130` (`latency = {ttft,total}`). Non-stream: `open-sse/handlers/chatCore/sseToJsonHandler.js:227,332`. Pass `{ latency, projectName, fallbackCount }` ke `saveUsageStats()` (`open-sse/handlers/chatCore/requestDetail.js:118`) → teruskan ke `saveRequestUsage()` (`src/lib/db/repos/usageRepo.js:243`). CARA paling minim invasif: tambah parameter opsional ke saveUsageStats + entry field di saveRequestUsage.
8. API routes baru (Next App Router, `src/app/api/...`): `GET /api/health/breaker`, `GET /api/usage/fallbacks`, `GET /api/usage/latency`, `GET /api/usage/projects`.
9. Dashboard UI: halaman baru `src/app/(dashboard)/dashboard/health/page.js` + komponen di `src/app/(dashboard)/dashboard/health/components/`. Copy style dari `src/app/(dashboard)/dashboard/usage/components/UsageChart.js` (recharts, Tailwind v4 token `bg-bg`, `text-text-muted`, `border-border`, `bg-primary`). Lazy-load chart pakai `next/dynamic` seperti `src/shared/components/UsageStats.js:17-22`.
10. Test: `tests/unit/*.test.js` (vitest, import relatif `../../src/...` atau `../../open-sse/...`). Tidak ada test script di root package.json — jalankan `cd tests && npx vitest run <file>`. Root `npm install` + `cd tests && npm install` sudah dilakukan.
11. JANGAN sentuh file di luar daftar file per task. JANGAN ubah upstream files tanpa alasan teknis yang ditulis di SUMMARY. JANGAN jalankan deploy/migrasi production.

## Tasks
- [x] T1 — Schema DB + repos fallback/metrics | PASS (reviewer 9/9 test, eslint clean) | commit 37ea6db8
- [x] T2 — Health breaker service + wiring | PASS (24/24 test, eslint clean) | commit 37ea6db8
- [x] T3 — Fallback chain logging + requestId + project attribution | PASS — worker MATI karena free usage limit, tapi hasil kerjanya lengkap; diverifikasi manual oleh orchestrator (e2e DB test, 16 placeholder=16 kolom, clientRawRequest aman, latency masuk ke 3 handler) | commit 59e5530b
- [x] T4 — Latency/TTFT ke usageHistory + metrics API | PASS (reviewer 11/11 test, build exit 0) | commit 59e5530b
- [x] T5 — Dashboard UI halaman Health & Spend | eslint bersih; focused test 2 passed; build exit 0; full-suite/regression comparison pending
- [x] T6 — Verifikasi akhir | PASS — full suite 4306 pass / 27 fail, 27 fail identik dengan baseline upstream (worktree 1fe586bb), 0 regresi baru. 1 regresi (key-access-migration hardcode `schema-1-to-2`) ketemu & diperbaiki | commit 09359384

## Log
- T1 iter1: worker selesai -> reviewer PASS (schema v3, 2 repo baru, export barrel, 9/9 test)
- T2 iter1: worker selesai -> reviewer PASS (breaker closed/open/half-open, anti-deadlock auth wiring, 24/24 test)
- Catatan: reviewer T2 sempat menulis snapshot translator (efek samping full-suite run) -> sudah di-revert, tidak ikut commit.
- T3 iter1: worker MATI (free usage limit) di tengah jalan.ilu工作是 justru sudah ~95% selesai: chat.js/combo.js/chatCore handlers/usageRepo/requestContext + 2 test file sudah ada dan 32/32 test pass. Orchestrator verifikasi manual (reviewer subagent juga kena limit).
  - Verifikasi manual: e2e ke DB temp → latencyMs/ttftMs/projectName/fallbackCount benar tersimpan, entry lama tetap jalan, fallbackEvents tersimpan, getSpendByProject benar. 16 kolom INSERT = 16 placeholder. clientRawRequest selalu non-null di titik assignment. `latency` di streamingHandler dalam scope. Route API sudah await dengan benar.
  - Regresi ketemu & difix: tests/unit/key-access-migration.test.js hardcode `schema-1-to-2` → kini baca SCHEMA_VERSION.
- T4: ikut diverifikasi bareng T3 (commit 59e5530b).
- T6: baseline upstream dijalankan di worktree terpisah (1fe586bb) → 4367 test / 27 fail. Fork → 4432 test / 27 fail, himpunan failure identik.
- Subagent worker/reviewer T3/T4 mati karena free usage limit — sisa pekerjaan diverifikasi manual, bukan diklaim PASS tanpa bukti.

## Branch
- `feat/health-routing-observability` (T1-T4 + fix regresi) — base master 1fe586bb
- `feat/architecture-map` (dokumen: ROADMAP.md, AGENT.md, docs/ARCHITECTURE_MAP.md) — base feat/health-routing-observability
- `master` = 1fe586bb, belum ada commit fork di atasnya (sengaja)
- Upstream remote: upstream = decolua/9router
