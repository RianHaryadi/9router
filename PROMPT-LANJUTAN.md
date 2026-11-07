# PROMPT LANJUTAN — Fork 9Router (RianHaryadi)

Copy-paste isi blok "PROMPT" di bawah ke sesi OpenCode baru. Isinya self-contained: konteks, state, kontrak, acceptance criteria, dan perintah verifikasi — sesi baru tidak butuh akses chat history.

---

## PROMPT

```
Lanjutkan pengerjaan fork 9Router di repo /home/kennyh/9router.

## 0. Baca dulu (WAJIB, sebelum eksekusi apa pun)

- /home/kennyh/9router/AGENT.md                 — aturan kerja fork (WAJIB dipatuhi)
- /home/kennyh/9router/ROADMAP.md               — roadmap 5 fase
- /home/kennyh/9router/docs/ARCHITECTURE_MAP.md — peta jalur request + titik hook + rencana per file
- /home/kennyh/9router/.loop/state.md           — state loop, keputusan desain, log iterasi
- /home/kennyh/9router/CLAUDE.md + open-sse/AGENTS.md — panduan upstream

AGENT.md adalah gabungan CLAUDE.md upstream + open-sse/AGENTS.md + aturan tambahan fork.
Kalau ada konflik, AGENT.md yang berlaku.

## 1. Konteks

Fork dari decolua/9router (MIT). Endpoint OpenAI-compatible di /v1. Stack: JavaScript ESM,
Next.js 16 App Router, React 19. Alias path @/* -> src/*.

Remote:
  origin   = github.com/RianHaryadi/9router   (fork)
  upstream = github.com/decolua/9router       (sumber sync)

Rules sync upstream (ROADMAP.md §3):
- Merge upstream ke branch sync/upstream-YYYYMMDD lalu PR. Jangan pernah pilih "Discard commits".
- Merge rutin & kecil (mingguan).
- Kalau upstream ngubah .github/workflows/, push dari GITHUB_TOKEN ditolak: pakai PAT scope workflow.
- Jangan sentuh .github/workflows/sync-upstream.yml dan LICENSE.

## 2. State saat ini

master = 1fe586bb (v0.5.112 upstream, bersih, BELUM ada commit fork di atasnya).

Branch feat/health-routing-observability (commit 7165dfa8) — SUDAH SELESAI & terverifikasi:
  37ea6db8  schema DB v3 (usageHistory + latencyMs/ttftMs/projectName/fallbackCount,
             tabel fallbackEvents), fallbackRepo.js, metricsRepo.js,
             healthBreaker.js (circuit breaker closed/open/half-open per connectionId|model
             dan provider|model), wiring auth.js (skip breaker-open, anti-deadlock) + chat.js
  59e5530b  fallback chain log (chat.js rotasi akun + combo.js rotasi member lewat callback
             onFallback, tanpa import DB), requestId + project attribution
             (header x-9router-project -> nama API key -> "unassigned"),
             latency/TTFT asli ke usageHistory, 4 API route
  09359384  fix regresi test key-access-migration (baca SCHEMA_VERSION dari schema)
  7165dfa8  update .loop/state.md

Branch feat/architecture-map (commit 82312242) — SUDAH SELESAI:
  ROADMAP.md, AGENT.md, docs/ARCHITECTURE_MAP.md

Verifikasi terakhir (baseline empiris, bukan asumsi):
  - Full suite fork           : 4306 pass / 27 fail
  - Baseline upstream (1fe586bb): 4241 pass / 27 fail
  - Himpunan failure IDENTIK -> 0 regresi baru
  - npm run build exit 0; eslint bersih untuk semua file yang diubah
  - E2E ke DB temp: latencyMs/ttftMs/projectName/fallbackCount benar tersimpan,
    entry lama (tanpa kolom baru) tetap jalan, INSERT 16 kolom = 16 placeholder

PENTING: suite upstream memang tidak hijau (27 fail pre-existing, terkatalog di
tests/__baseline__/known-fails.txt). Nilai regresi dengan membandingkan himpunan failure
TERHADAP baseline upstream, BUKAN dari run mentah. "Semua test hijau" bukan kriteria valid.

## 3. TUGAS Sesi ini: T5 — Dashboard UI "Health & Spend"

Buat halaman dashboard baru:
  src/app/(dashboard)/dashboard/health/page.js
  src/app/(dashboard)/dashboard/health/components/

4 tab, URL-driven seperti halaman usage (?tab=...):

  Tab "Health"    -> GET /api/health/breaker
                     Tampilkan: state per connection|model (closed/open/half-open),
                     consecutiveFailures, blockedUntil, cooldownMs, lastError, lastStatus,
                     avgLatencyMs. Tabel + badge warna per state.

  Tab "Latency"   -> GET /api/usage/latency
                     Tampilkan: p50/p90/p95/p99 + min/max/avg untuk latencyMs DAN ttftMs,
                     plus tabel per provider (requests, cost, avgLatency, avgTtft, errors).
                     Chart persentil (recharts).

  Tab "Projects"  -> GET /api/usage/projects
                     Tampilkan: spend per projectName (cost, requests, promptTokens,
                     completionTokens). Bar chart + tabel.

  Tab "Fallbacks" -> GET /api/usage/fallbacks
                     Tampilkan: chain fallback (timestamp, requestId, provider/model,
                     fromProvider/fromModel, status, reason, cooldownMs, latencyMs),
                     plus summary.byProvider dan summary.byReason.
                     Filter: provider / model / requestId / since (ISO), limit (max 500).

4 API route SUDAH ADA dan terverifikasi:
  GET /api/health/breaker  -> { ok, snapshot, blocked, timestamp }
  GET /api/usage/fallbacks -> { ok, events[], total,
                                summary{ total, byProvider, byReason, recent } }
                              query: limit(1-500, default 100), offset, provider, model,
                              requestId, since(ISO), summary
  GET /api/usage/latency   -> { ok, count,
                                latencyMs{p50,p90,p95,p99,min,max,avg}, ttftMs{...}, providers[] }
                              query: provider, model, since(ISO), limit(1-10000, default 1000)
  GET /api/usage/projects  -> { ok, projects[{project,cost,promptTokens,
                                completionTokens,requests}], total{cost,requests} }
                              query: since(ISO)

Pola UI yang HARUS diikuti (copy, jangan improv):
  - src/app/(dashboard)/dashboard/usage/components/UsageChart.js       (recharts + Tailwind v4)
  - src/app/(dashboard)/dashboard/usage/components/ProviderBarChart.js
  - src/app/(dashboard)/dashboard/usage/page.js                       (tab URL-driven ?tab=...)
  - src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js (filter/refresh)
  - src/shared/components/UsageStats.js:17-22   (lazy-load chart via next/dynamic, ssr:false)
  - src/shared/components/Card.js, Badge.js, SegmentedControl.js
  Tailwind token: bg-bg, text-text-muted, border-border, bg-primary, text-success, text-error.
  Warna chart: #6366f1, #14b8a6, #f59e0b.

Nav:
  - src/shared/components/Sidebar.js — navItems array, tambahkan 1 item setelah
    { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" }.
    (mis. label "Health & Spend", icon "monitor_heart" / "health_and_safety").
    Ini satu-satunya file upstream yang boleh disentuh. JANGAN edit komponen UI upstream lain.

## 4. Batasan keras

- Kode baru HANYA di src/app/(dashboard)/dashboard/health/** (dan src/app/api/health/**
  hanya kalau benar-benar perlu route tambahan). Logika bisnis taruh di src/custom/.
- File upstream yang boleh disentuh: HANYA src/shared/components/Sidebar.js (1 baris nav item).
- Jangan sentuh: .github/workflows/sync-upstream.yml, LICENSE, src/lib/db/schema.js
  (sudah final v3), src/lib/db/repos/*, src/sse/services/healthBreaker.js,
  src/sse/services/requestContext.js, open-sse/handlers/chatCore/*, open-sse/services/combo.js,
  src/sse/handlers/chat.js, src/lib/db/repos/usageRepo.js.
- Satu fitur per branch: feat/health-dashboard. JANGAN commit langsung ke master.
- Jangan aktifkan Cloud Sync. Jangan hardcode secret. Jangan jalankan deploy/migrasi production.
- Jangan hapus fitur yang ada.

## 5. Test

Buat tests/unit/health-dashboard.test.js:
  - Importability: page & komponen bisa di-import tanpa error.
  - API contract: GET ke 4 route di atas (handler asli, bukan mock) -> ok:true dan field
    wajib ada. Pattern dari tests/unit/observability-api-routes.test.js.
  - Helper pure (mis. formatter persentil, pemetaan state->warna badge) -> unit test.
    Import relatif ke path dengan kurung siku: ../../src/app/(dashboard)/dashboard/health/components/...
    (path ini butuh quoting di import).
  - Test tidak boleh bergantung data nyata di DB.

## 6. Verifikasi WAJIB (jalankan, ambil output nyata, laporkan)

  cd /home/kennyh/9router && npx eslint "src/app/(dashboard)/dashboard/health" src/shared/components/Sidebar.js
  cd /home/kennyh/9router/tests && npx vitest run unit/health-dashboard.test.js
  cd /home/kennyh/9router && npm run build          # WAJIB exit 0
  cd /home/kennyh/9router/tests && npx vitest run --reporter=json --outputFile=/tmp/full.json

  Lalu bandingkan himpunan failure dgn baseline upstream (target: 0 failure baru).
  Baseline ada di /tmp/opencode/upstream-failed.txt (27 fail). Kalau tidak ada, regenerate:
    git worktree add /tmp/opencode/9router-upstream 1fe586bb
    ln -s /home/kennyh/9router/tests/node_modules /tmp/opencode/9router-upstream/tests/node_modules
    ln -s /home/kennyh/9router/node_modules /tmp/opencode/9router-upstream/node_modules
    cd /tmp/opencode/9router-upstream/tests && npx vitest run --reporter=json \
      --outputFile=/tmp/opencode/upstream-suite.json
  Worktree itu HANYA untuk baseline. JANGAN commit di sana.

Kalau ada failure baru: fix sampai bersih. Kalau tidak selesai dalam 3 iterasi, laporkan + berhenti.
Jangan diamkan sebagai PASS tanpa bukti.

## 7. Setelah selesai

1. git checkout -b feat/health-dashboard feat/health-routing-observability
2. git add file relevan && git commit -m "feat(fork): dashboard Health & Spend (breaker, latency p95, spend per project, fallback chain)"
3. Update .loop/state.md: tandai T5 [x] + catat evidence (jumlah test, hasil build, status regresi).
   Commit itu juga.
4. JANGAN merge ke master, JANGAN push (user yang push).
5. Ringkas ke user: file yang diubah, deskripsi isi tiap tab, hasil verifikasi nyata.

## 8. Constraint runtime

- Node deps sudah ter-install (root + tests). Kalau tests/node_modules hilang:
  cd tests && npm install --legacy-peer-deps
- Kalau subagent (worker/reviewer) kena "Free usage limit reached": JANGAN diamkan sebagai PASS.
  Verifikasi manual dengan perintah nyata dan laporkan output-nya.
- Maksimal 25 panggilan subagent per sesi.
- Kalau build gagal karena file yang SEDANG diubah worker lain, laporkan output persisnya.

## 9. Setelah T5 selesai (hanya kalau ada waktu & user minta)

Roadmap Fase 1 berikutnya (ARCHITECTURE_MAP.md §3 & §4):
  - src/custom/rtk/whitelist.js       — whitelist tool per RTK (upstream masih content-based)
  - src/custom/rtk/tokenMeter.js       — hitung TOKEN sebelum/sesudah (upstream cuma hitung BYTE)
  - src/custom/transform/*             — wrapper Caveman/Ponytail + guard "jangan kena output end-user"
  - src/custom/toolcall/repair.js      — tool-call repair generik + retry ke model lain
  - src/custom/cache/awareRouting.js   — pilih provider berdasarkan cache warm
  Titik hook: open-sse/handlers/chatCore.js blok 282-320, 1 baris pemanggilan pipeline.
  Semua logika di src/custom/, upstream disentuh minimal.

Jangan mulai Fase 1 tanpa konfirmasi user dulu.
```

---

## Catatan

Prompt ini sengaja self-contained. Bagian yang paling krusial adalah **baseline regresi ikut disertakan** — suite upstream memang merah 27 test, jadi "semua test hijau" bukan kriteria valid di repo ini, dan sesi baru bisa salah menyimpulkan regresi (atau salah mengabaikannya).

Kalau mau lanjut ke Fase 1 (transform pipeline di `src/custom/`) setelah T5, bilang saja — gue buatkan prompt terpisah untuk itu, karena kontraknya beda: bukan UI, tapi hook pipeline.
