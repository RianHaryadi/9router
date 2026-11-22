# AGENT.md — Aturan Kerja Fork 9Router

> Fork dari [`decolua/9router`](https://github.com/decolua/9router) (MIT).
> Dokumen ini **gabungan** dari `CLAUDE.md` (panduan upstream), `open-sse/AGENTS.md` (konvensi engine),
> dan `ROADMAP.md` (aturan tambahan fork ini).
>
> **Baca sebelum mengubah kode.** Kalau ada konflik antara dokumen ini dan `CLAUDE.md` upstream,
> dokumen ini yang berlaku untuk fork (`RianHaryadi/9router`).

---

## 1. Identitas Repo

| Item | Nilai |
|---|---|
| Upstream | `decolua/9router` (remote `upstream`) |
| Fork | `RianHaryadi/9router` (remote `origin`) |
| Lisensi | MIT — **copyright notice asli wajib utuh** |
| Stack | JavaScript ESM (bukan TypeScript), Next.js 16 App Router, React 19 |
| Alias path | `@/*` → `src/*` (`jsconfig.json`) |
| Port runtime | 20128 (dashboard di `/dashboard`, API di `/v1`) |
| Data dir | `DATA_DIR` env, else `~/.9router/` (`src/lib/db/paths.js`) |
| DB | SQLite lewat `src/lib/db/` — adapter chain `bun:sqlite` → `better-sqlite3` → `node:sqlite` → `sql.js` |

---

## 2. Aturan Kerja Fork (WAJIB)

### 2.1 Struktur kode

1. **Semua kode baru → `src/custom/`.** Tidak ada kode fitur baru di `src/` atau `open-sse/` selain
   file upstream.
2. **File upstream hanya boleh diubah di titik hook kecil.** Kalau perubahan menyentuh > ~20 baris
   di file upstream, pindahkan logikanya ke `src/custom/` dan upstream cukup memanggilnya.
3. **Jangan edit komponen UI upstream.** Tampilan diubah lewat layer override (CSS variables,
   theme file, wrapper component), bukan edit komponen aslinya.
4. **Jangan hapus fitur yang ada.** Hanya tambah atau opt-out lewat config.
5. **Jangan sentuh** `.github/workflows/sync-upstream.yml` dan `LICENSE`.

### 2.2 Branching & commit

1. **Satu fitur per branch**: `feat/<nama>`. Contoh: `feat/transform-pipeline`, `feat/toolcall-repair`.
2. **Jangan commit langsung ke `master`.** `master` = hasil merge upstream yang bersih.
3. Sync upstream lewat branch terpisah `sync/upstream-YYYYMMDD` → PR → review → merge.
   **Jangan pernah** pilih "Discard commits" di tombol Sync fork GitHub.
4. Merge upstream rutin dan kecil (mingguan), jangan numpuk berbulan-bulan.
5. Commit style: Conventional Commits — `feat(...)`, `fix(...)`, `docs(...)`.
6. `git config --global rerere.enabled true` (conflict resolution reuse).

### 2.3 Before shipping

- [ ] `npx eslint .` bersih untuk file yang diubah
- [ ] `cd tests && npx vitest run` — tidak ada regresi baru vs baseline
- [ ] `npm run build` sukses
- [ ] Ringkas file yang diubah (path + alasan singkat)
- [ ] Tidak ada secret di kode, dokumen, atau log
- [ ] Review keamanan (auth, penyimpanan kredensial, manipulasi header, SSRF) — **sebelum** logika fungsional

---

## 3. Keamanan (WAJIB)

- **Cloud Sync**: matikan / nonaktifkan. Sync konfigurasi ke cloud 9router tidak dipakai di fork ini.
- **Env sensitif**: `JWT_SECRET` (session cookie), `INITIAL_PASSWORD` (default upstream `123456` — **wajib di-override**), `API_KEY_SECRET`, `MACHINE_ID_SALT`. Lihat `.env.example`.
- **Deploy wajib**: `REQUIRE_API_KEY=true`, `JWT_SECRET` random panjang, `INITIAL_PASSWORD` kuat.
- **Jangan hardcode secret** di kode, dokumen, `.loop/state.md`, atau output tool.
- **`X-Forwarded-For`**: `custom-server.js` menurunkan IP asli dari socket TCP dan hanya mempercayai
  header forwarding dari reverse proxy loopback. **Jangan ubah perilaku ini** saat menyentuh
  kode request/IP/rate-limit.
- **Review PR**: keamanan adalah prioritas utama — audit autentikasi, penyimpanan token,
  manipulasi header, dan risiko SSRF sebelum logika fungsional. Sertakan catatan keamanan
  eksplisit di setiap review.
- Kalau fitur dijual: pertimbangkan risiko ToS provider untuk fitur OAuth subscription
  (matikan atau beri disclaimer).

---

## 4. Arsitektur: batas `src/` vs `open-sse/`

```
src/app/**        Next.js App Router — dashboard + API kompatibilitas (/v1/*, /api/*)
src/sse/**        "glue" sisi aplikasi — entry handler, auth, credential, error mapping
src/lib/db/**     persistensi SQLite (schema, repos, adapter, migrasi)
src/lib/**        utilitas, oauth, network, mcp, tunnel, modelCatalog
src/store/**      zustand store UI
src/mitm/**       reverse-proxy lokal untuk CLI desktop (bukan pipeline /v1)
src/proxy.js      Next.js middleware (anti-forgery, MiMo session, dashboardGuard)
src/custom/**     ← SEMUA kode fitur fork (tidak ada di upstream)

open-sse/**       engine provider-agnostic (bisa dipakai standalone)
  config/         semua konstanta & config — JANGAN hardcode di tempat lain
  translator/     konversi format (request/<from>-to-<to>, response/, concerns/, schema/)
  executors/      satu file per upstream non-standar; base.js = BaseExecutor
  providers/      registry + capabilities + pricing
  handlers/       core per modalitas; chatCore/ = streaming & non-streaming
  rtk/            RTK token saver (compress tool_result) + caveman + ponytail + headroom + pxpipe
  services/       model, provider, accountFallback, combo, tokenRefresh, ...
  utils/          stream, sse, sessionManager, proxyFetch, ...
```

Melewati batas ini harus disadari. `src/sse/` = sisi aplikasi; `open-sse/` = engine.

Detail lengkap jalur request: [`docs/ARCHITECTURE_MAP.md`](docs/ARCHITECTURE_MAP.md).

---

## 5. Konvensi Kode

### 5.1 umum

- **Config-driven, DRY, camelCase.** JANGAN hardcode nilai, model, atau string role/block —
  pakai `open-sse/config/` + `open-sse/translator/schema/`.
- Translator berputar melalui **OpenAI sebagai format antara**. Translator yang terdaftar pada
  pasangan persis (`claude:kiro`) jalan sebagai **direct route**, melewati double-hop lossy.
- Translator **self-register** via `register(from, to, reqFn, resFn)` sebagai import side-effect —
  file translator baru **wajib** di-import di `open-sse/translator/index.js` atau tidak akan pernah jalan.
- Pipeline RTK/system-inject **fail-open**: error → return null, body tidak diubah. **Jangan pernah lempar
  keluar dari `open-sse/rtk/`.** Pipeline custom di `src/custom/` wajib mengikuti aturan yang sama.
- Kompresi RTK bersifat **lossy** dan harus **deterministik** (tanpa random/timestamp) supaya prompt
  cache provider tidak ter-invalidate.
- Teks injeksi system prompt harus **statis & konsisten di awal system prompt** demi menjaga cache prefix.

### 5.2 Database

- `src/lib/localDb.js` = **shim backward-compat** yang re-export `src/lib/db/index.js`.
  Kode baru import dari `@/lib/db/index.js`; logika per-entitas di `src/lib/db/repos/*`.
- Skema deklaratif di `src/lib/db/schema.js`. **Naikkan `SCHEMA_VERSION` +1 setiap kali mengubah skema**
  (memicu backup pra-perubahan di `src/lib/db/migrate.js`). Kolom/tabel baru **additive** auto-sync
  lewat `syncSchemaFromTables` — file migrasi baru tidak wajib, tapi untuk perubahan destruktif
  (drop/rename/ubah tipe) **wajib** tulis migrasi di `src/lib/db/migrations/`.
- Import baru: `src/lib/db/index.js` (barrel). Jangan akses `getAdapter()` langsung di luar `src/lib/db/`.

### 5.3 Testing

- Test ada di package terpisah `tests/`. **Root `package.json` tidak punya script `test`.**
- Pola import test: **relatif** (`../../src/...`, `../../open-sse/...`) — house style di `tests/unit/`.
- Import eksplisit: `import { describe, expect, it } from "vitest";` walau `globals: true`.
- Awali file test dengan komentar blok yang menjelaskan **regresi** yang dijaga — ini konvensi universal repo.
- Test DB: pakai adapter sungguhan dengan DB temp (pola: `tests/unit/usage-api-key-attribution.test.js`).
  Mock `vi.mock("@/lib/usageDb.js", ...)` untuk assert pada penulisan usage.

---

## 6. Pitfalls Upstream yang Harus Diketahui

| Pitfall | Detail |
|---|---|
| Suite test tidak hijau di checkout bersih | ~938 pass / ~64 fail. 26 tercatat di `tests/__baseline__/known-fails.txt`. Nilai regresi dengan `tests/__baseline__/verify-no-regression.mjs`, bukan run mentah |
| `embeddings.cloud.test.js` selalu gagal | meng-import `cloud/src/handlers/embeddings.js` — folder `cloud/` tidak ada di repo ini |
| `unit/xai-oauth-service.test.js` timeout | butuh endpoint discovery xAI yang tidak ter-mock |
| `*.real.test.js` | memanggil provider sungguhan — butuh kredensial, skip |
| `registry/index.js` auto-generated | daftar import statis. **Regenerate** (jangan hand-edit) setelah menambah `registry/{id}.js`. Script: `scripts/migrate-registry.mjs` / `injectDisplayToRegistry.mjs`. `REGISTRY_TEMPLATE.js` sengaja tidak di-import |
| OpenAI bridge lossy | thinking, gambar non-base64, tool id, `is_error` — pakai direct route untuk pasangan rapuh |
| Format biner/protobuf | kiro EventStream, cursor protobuf, commandcode NDJSON tidak round-trip lewat OpenAI — ditangani di executor masing-masing |
| `open-sse/rtk/` + `headroom.js` mutate body in-place | fail-open, dan **skip** `is_error`/`status:"error"` tool result supaya trace tidak hilang |
| `rtk/registry.js` = dead code | filter registry + alias (`rg`→grep, `fd`→find) tidak di-import siapa pun |
| `docs/ARCHITECTURE.md` upstream **stale** di bagian persistence | sudah SQLite, bukan `db.json` |
| `usageHistory.status` praktis mati | INSERT selalu `entry.status \|\| "ok"` dan tidak ada pemanggil yang mengisinya |
| `appendRequestLog` = no-op | `src/lib/db/repos/usageRepo.js:782`; log request diturunkan dari `usageHistory` saat baca |

---

## 7. Feature yang SUDAH ADA di Upstream (jangan dibuat ulang)

Ringkasan lengkap + bukti file:linya di [`docs/ARCHITECTURE_MAP.md` §4](docs/ARCHITECTURE_MAP.md#4-fitur-fase-1-yang-sudah-ada-di-upstream-jangan-diduplikasi).

| Fitur | Status | Catatan |
|---|---|---|
| RTK kompresi `tool_result` | ✅ sudah ada | `open-sse/rtk/index.js:8` — whitelist per tool & token meter **belum** ada (hanya byte) |
| Caveman | ✅ sudah ada | `open-sse/rtk/caveman.js:7` — level lite/full/ultra/wenyan-* |
| Ponytail | ✅ sudah ada | `open-sse/rtk/ponytail.js:7` — level lite/full/ultra |
| Prompt cache / `cache_control` | ✅ sudah ada | `open-sse/translator/formats/claude.js:395` `anchorClaudeCache` |
| Session sticky | ✅ sudah ada | `open-sse/utils/sessionManager.js:212` |
| Cache-**aware routing** | ❌ belum | tidak ada logika pilih provider berdasarkan cache warm |
| Tool-call repair generik | ❌ belum | Kiro & DeepSeek saja, retry ke provider yang **sama** |
| Tool-call repair → model lain | ❌ belum | fallback hanya dipicu HTTP error, tool call rusak biasanya HTTP 200 |
| Kompleksitas routing | ❌ belum | — |
| Multi-user / per-key budget | ❌ belum | — |
| Semantic cache | ❌ belum | — |
| Circuit breaker generik | ✅ ada (di fork ini) | `src/sse/services/healthBreaker.js` — branch `feat/health-routing-observability` |
| Observability (fallback chain, latency/TTFT, spend per project) | ✅ ada (di fork ini) | `src/lib/db/repos/{fallbackRepo,metricsRepo}.js` |

---

## 8. Roadmap Singkat

Detail: [`ROADMAP.md`](ROADMAP.md).

| Fase | Isi |
|---|---|
| 1 | Transform pipeline (Ponytail/Caveman/RTK native), tool-call repair, cache-aware routing |
| 2 | Per-key budget, multi-user, enkripsi key provider, idempotency |
| 3 | Observability, circuit breaker, request queue, mid-stream failover |
| 4 | Complexity routing, shadow eval, regression eval, playground |
| 5 | Semantic cache, guardrails, batch routing, billing |

> Fase 1 harus dibangun di atas apa yang sudah ada upstream (§7) — bukan mengulanginya.

---

## 9. Referensi

| Dokumen | Isi |
|---|---|
| [`docs/ARCHITECTURE_MAP.md`](docs/ARCHITECTURE_MAP.md) | peta jalur request, titik hook, rencana perubahan per file |
| [`ROADMAP.md`](ROADMAP.md) | roadmap 5 fase + checklist keamanan/lisensi |
| [`CLAUDE.md`](CLAUDE.md) | panduan upstream (arsitektur, konvensi, gotcha persistence) |
| [`open-sse/AGENTS.md`](open-sse/AGENTS.md) | konvensi engine `open-sse/` |
| `docs/ARCHITECTURE.md` (upstream) | arsitektur sistem — stale di bagian persistence |
| `.env.example` | kontrak env lengkap |
