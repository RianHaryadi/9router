# ARCHITECTURE_MAP — Peta Jalur Request & Titik Hook Fork 9Router

> Fork dari [`decolua/9router`](https://github.com/decolua/9router) v0.5.112 (commit `1fe586bb`).
> Dokumen ini memetakan jalur request `/v1` dari entry sampai provider, menetapkan titik hook
> minimal untuk transform pipeline (Fase 1), dan mencatat fitur apa yang **sudah ada** di upstream.
>
> Nomor baris mengacu pada upstream `1fe586bb` (v0.5.112) + commit fork `37ea6db8`.
> Perubahan di branch lain dapat menggeser ±5 baris — selalu verifikasi dengan `grep -n`.
> Roadmap fitur: [`../ROADMAP.md`](../ROADMAP.md). Aturan kerja: [`../AGENT.md`](../AGENT.md).

---

## 1. Jalur Request `/v1` — Peta Lengkap

### 1.1 Ringkasan alur

```
Client (Claude Code / Codex / Cursor / Cline / OpenCode ...)
  │
  │  POST /v1/chat/completions  (atau /v1/messages, /v1/responses, /v1/api/chat)
  ▼
Next.js rewrite   next.config.mjs:71-99      /v1/:path*  →  /api/v1/:path*
  │
  ▼
Middleware        src/proxy.js:13            anti-forgery + MiMo session + dashboardGuard
  │                                          /v1 & /api/v1 = PUBLIC_PREFIXES (src/dashboardGuard.js:39)
  ▼
Route handler     src/app/api/v1/chat/completions/route.js:29
  │                ensureInitialized() → handleChat(request)
  ▼
HANDLER           src/sse/handlers/chat.js:98   handleChat
  │  ├─ 100-118   parse body + clientRawRequest
  │  ├─ 121-124   stripModelContextMarker (marker [1m] dll)
  │  ├─ 122       resolveSessionIdentity → sessionId   (open-sse/utils/sessionManager.js:212)
  │  ├─ 127-135   extractApiKey
  │  ├─ 138-150   AUTH: settings.requireApiKey → isValidApiKey → 401
  │  ├─ 152-155   validasi model → 400
  │  ├─ 159-161   KEY ACCESS: getKeyAccessContext → enforceKeyAccess
  │  ├─ 167-171   createRequestId + resolveProjectName        ← [fork] observability
  │  ├─ 180-183   handleBypassRequest
  │  ├─ 185       detectRequiredCapabilities
  │  ├─ 188-256   COMBO: getComboModels → strategi → handleComboChat
  │  │              open-sse/services/combo.js:360
  │  │              ├─ getRotatedModels   :231   (sticky round-robin)
  │  │              ├─ reorderByCapabilities :86
  │  │              └─ smart policy       :382-460 (systemoneRouter, session-sticky)
  │  └─ 275       handleSingleModelChat(body, modelStr, ...)
  │                 src/sse/handlers/chat.js:281
  │                 └─ while(true) loop fallback akun   :375-560
  │                     ├─ 376  getProviderCredentials   src/sse/services/auth.js:29
  │                     │        └─ filter: exclude set / modelLock / enabledModels /
  │                     │           antigravity quota / healthBreaker (fork)
  │                     ├─ 396  checkAndRefreshToken
  │                     └─ 410  handleChatCore          open-sse/handlers/chatCore.js:64
  ▼
ENGINE            open-sse/handlers/chatCore.js
  │  ├─ 132       tokenSaverEnabled (header x-9router-token-saver)
  │  ├─ 138-142   RTK PRE-translate (khusus provider cursor)
  │  ├─ 217       translateRequest  →  open-sse/translator/index.js:69
  │  ├─ 233       dedupeTools
  │  ├─ 282       RTK POST-translate (semua provider lain)
  │  ├─ 286       Headroom compress (external)
  │  ├─ 302-303   injectCaveman   → open-sse/rtk/caveman.js:7
  │  ├─ 308-309   injectPonytail  → open-sse/rtk/ponytail.js:7
  │  ├─ 314       injectCustomPrompt
  │  ├─ 320       PXPIPE
  │  ├─ 335       anchorClaudeCache (re-anchor breakpoint)
  │  └─ 396       executor.execute(...)
  ▼
EXECUTOR          open-sse/executors/base.js:100   BaseExecutor.execute
  │  ├─ 129       transformRequest(model, body, stream, credentials)  ← hook body provider
  │  ├─ 130       buildHeaders (+ providerOverrides.headers :132)
  │  ├─ 146       proxyAwareFetch  →  PROVIDER
  │  ├─ 160-166   retry in-place / fallback ke URL berikutnya
  │  └─ 168       return { response, url, headers, transformedBody }  (raw, belum diubah)
  ▼
RESPONSE          open-sse/handlers/chatCore.js
  ├─ 444-489   401/403 → executor.refreshCredentials() → execute() ulang
  ├─ 492-514   !response.ok → parseUpstreamError → createErrorResult
  └─ 516+      streaming : utils/stream.js:420 translateResponse
                non-stream : chatCore/nonStreamingHandler.js:97/297 translateNonStreamingResponse
  ▼
Client (SSE / JSON)
```

### 1.2 Entry point `/v1` — daftar route

Semua route handler chat memanggil `handleChat(request)` yang sama:

| Route | File | Catatan |
|---|---|---|
| `POST /v1/chat/completions` | `src/app/api/v1/chat/completions/route.js:29` | jalur utama |
| `POST /v1/messages` | `src/app/api/v1/messages/route.js:32` | format Claude |
| `POST /v1/responses` | `src/app/api/v1/responses/route.js:27` | format OpenAI Responses |
| `POST /v1/api/chat` | `src/app/api/v1/api/chat/route.js:24` | Ollama + `transformToOllama` |
| `GET /v1/models` | `src/app/api/v1/models/route.js` | listing model |
| `POST /v1/embeddings` | `src/app/api/v1/embeddings/route.js` | `handleEmbeddings` (`src/sse/handlers/embeddings.js:33`) |
| `POST /v1/images/generations` | `src/app/api/v1/images/generations/route.js` | `handleImageGeneration` (`src/sse/handlers/imageGeneration.js:47`) |
| `POST /v1/search` | `src/app/api/v1/search/route.js` | `handleSearch` (`src/sse/handlers/search.js:24`) |
| `POST /v1/web/fetch` | `src/app/api/v1/web/fetch/route.js` | `handleFetch` (`src/sse/handlers/fetch.js:25`) |
| `POST /v1/audio/*` | `src/app/api/v1/audio/` | TTS/STT |
| `POST /v1/videos/*` | `src/app/api/v1/videos/` | `src/sse/handlers/videoGeneration.js:112,225` |
| `POST /v1/systemone` | `src/app/api/v1/systemone/route.js` | `handleSystemone` |
| `GET /v1beta/models/*` | `src/app/api/v1beta/models/` | Gemini v1beta |

Alias lain di `next.config.mjs:71-99`: `/codex/:path*` → `/api/v1/responses`.

### 1.3 Auth — di mana & bagaimana

| Lapisan | Lokasi | Peran |
|---|---|---|
| Middleware | `src/proxy.js:13` | anti-forgery cookie, MiMo session, `dashboardGuard` |
| Bypass auth | `src/dashboardGuard.js:39` `PUBLIC_PREFIXES` | `/v1`, `/api/v1`, `/codex`, `/responses` |
| API key | `src/sse/handlers/chat.js:138-150` | `settings.requireApiKey` → `isValidApiKey` → 401 |
| Key access | `src/sse/handlers/chat.js:159-161` | `getKeyAccessContext` (`src/sse/services/keyAccess.js:70`) → `enforceKeyAccess` |
| Dashboard session | `src/lib/auth/dashboardSession.js` | terpisah, tidak terkait `/v1` |

> `/v1` **tidak** melewati auth middleware. API key diverifikasi di dalam handler.

### 1.4 Pemilihan provider / combo

| Mekanisme | Lokasi | Keterangan |
|---|---|---|
| Parse model | `open-sse/services/model.js` `parseModel` | `provider/model` → `{provider, model}` |
| Resolusi alias provider | `src/shared/constants/providers.js` `resolveProviderId` | mis. `kc` → `kilocode` |
| Combo lookup | `src/sse/handlers/chat.js:188` `getComboModels` | model tanpa `/` bisa berarti combo |
| Strategi combo | `src/sse/handlers/chat.js:188-256` | `fallback` / `round-robin` / `smart` / `fusion` |
| Rotasi member | `open-sse/services/combo.js:231` `getRotatedModels` | sticky round-robin, `comboStickyRoundRobinLimit` (default 1) |
| Smart policy | `open-sse/services/combo.js:382-460` | System One router, session-sticky (`systemoneRouter.js:170`) |
| Pemilihan akun | `src/sse/services/auth.js:29` `getProviderCredentials` | `fill-first` (default) / `round-robin` |
| Round-robin akun | `src/sse/services/auth.js:174-196` | sticky `stickyRoundRobinLimit` (default 3) |

### 1.5 Format translation

Translation **terjadi di handler (`chatCore`), bukan di executor**:

- Request: `open-sse/handlers/chatCore.js:217` → `open-sse/translator/index.js:69` `translateRequest`
  - Registry pasangan `"${from}:${to}"` → direct route; kalau tidak, pivot `source → openai → target` (`translator/index.js:102-128`)
  - Request translators: `open-sse/translator/request/{openai-to-claude,openai-to-kiro,claude-to-openai,openai-responses,openai-to-gemini,openai-to-cursor,openai-to-ollama,openai-to-vertex,openai-to-commandcode,claude-to-kiro,antigravity-to-openai,gemini-to-openai}.js`
- Response:
  - Streaming: `open-sse/utils/stream.js:420` `translateResponse`
  - Non-streaming: `open-sse/handlers/chatCore/nonStreamingHandler.js:97` & `:297` `translateNonStreamingResponse`
- Executor hanya melakukan transform **provider-spesifik** (bukan format): `open-sse/executors/base.js:79` `transformRequest` (default: body apa adanya; subclass override). Executor tertentu (cursor protobuf, kiro EventStream, codex Responses) decode sendiri di dalam executor.

### 1.6 System prompt — titik-built

| Lokasi | Isi |
|---|---|
| `open-sse/rtk/systemInject.js:11` `injectSystemPrompt(body, format, prompt)` | dispatch per format (Kiro / Claude / Gemini / instructions / messages / input), idempotent (`hasPrompt` `:75`), insert sebelum blok `cache_control` terakhir (`:226-233`) |
| `open-sse/translator/request/openai-to-claude.js:133-144` | system Claude Code statis + `cache_control {ttl:"1h"}` |
| `open-sse/translator/formats/claude.js:369` | `CACHE_CONTROL_5M` pada blok |
| `open-sse/handlers/chatCore.js:335` | `anchorClaudeCache(translatedBody)` — re-anchor setelah semua saver |

---

## 2. Titik Hook untuk Transform Pipeline (Fase 1)

### 2.1 Prinsip

> Semua kode baru → `src/custom/`. File upstream hanya boleh diubah **di titik hook kecil**.

Titik hook yang direkomendasikan: **satu file upstream** — `open-sse/handlers/chatCore.js` — di mana pipeline custom disisipkan.
Semua logika ada di `src/custom/`, dipanggil dari hook tersebut.

### 2.2 Hook yang sudah ada di upstream (dipakai ulang, jangan diduplikasi)

| Hook | Lokasi | Status |
|---|---|---|
| RTK pre-translate (cursor) | `chatCore.js:138-142` | ✅ ada |
| RTK post-translate | `chatCore.js:282` | ✅ ada |
| Headroom | `chatCore.js:286` | ✅ ada |
| Caveman inject | `chatCore.js:302-303` | ✅ ada |
| Ponytail inject | `chatCore.js:308-309` | ✅ ada |
| Custom prompt inject | `chatCore.js:314` | ✅ ada |
| PXPIPE | `chatCore.js:320` | ✅ ada |
| Cache re-anchor | `chatCore.js:335` | ✅ ada |
| `executor.transformRequest` | `open-sse/executors/base.js:79` | ✅ ada (body transform per provider) |

### 2.3 Titik sisip yang direkomendasikan

**Titik A — pipeline custom (recommended, 1 file upstream)**

Bentuk upstream: `open-sse/handlers/chatCore.js` baris 282–320 adalah blok saver yang berurutan.
Tambahkan **satu** pemanggilan pipeline custom di dalam blok itu, tepat **setelah** RTK/Headroom (kompresi content)
dan **sebelum** `injectCaveman`/`injectPonytail` (supaya injeksi system prompt berada di posisi stabil
relatif terhadap cache breakpoint).

```
chatCore.js:282   rtkStats      = compressMessages(...)          // upstream
chatCore.js:286   headroomStats = compressWithHeadroom(...)       // upstream
   >>> HOOK: customPipeline.apply({ body: translatedBody, format, provider, model, ... })
chatCore.js:302   injectCaveman(...)                           // upstream
chatCore.js:308   injectPonytail(...)                          // upstream
chatCore.js:335   anchorClaudeCache(...)                       // upstream
```

Isi file baru (semua di `src/custom/`):

| File | Tanggung jawab |
|---|---|
| `src/custom/index.js` | barrel export |
| `src/custom/pipeline/index.js` | orkestrasi urutan tahap,_fail-open_ |
| `src/custom/pipeline/context.js` | bangun konteks (provider, model, format, key info, project, session) |
| `src/custom/pipeline/toggle.js` | resolusi toggle per key/combo/provider dari settings |
| `src/custom/rtk/whitelist.js` | whitelist tool + aturan per-tool (baru; RTK upstream content-based) |
| `src/custom/rtk/tokenMeter.js` | hitung token sebelum/sesudah (RTK upstream hanya hitung **byte**) |
| `src/custom/transform/caveman.js` | wrapper Caveman native + level policy |
| `src/custom/transform/ponytail.js` | wrapper Ponytail native + level policy |
| `src/custom/transform/promptInjector.js` | injeksi system prompt statis, konsistensi cache |
| `src/custom/toolcall/repair.js` | tool-call repair generik + retry model lain |
| `src/custom/cache/awareRouting.js` | cache-aware routing (sticky session, `cache_control`) |

**Titik B — pemilihan akun (per-key policy)**

`src/sse/services/auth.js:87-103` (filter `availableConnections`) — untuk menyaring akun berdasarkan
kunci API / health. Ini sudah disentuh di branch `feat/health-routing-observability` (health breaker).

**Titik C — pemilihan member combo**

`open-sse/services/combo.js:471` (loop member) — untuk_complexity routing_ dan tool-call repair retry.

**Titik D — body transform provider**

`open-sse/executors/base.js:129` `transformRequest` — hanya bila butuh transform khusus provider.
Lebih baik dihindari: executor adalah milik upstream dan sering berubah.

### 2.4 Aturan yang wajib dijaga di hook

1. **Fail-open** — pipeline custom tidak boleh melempar error keluar. Kegagalan satu tahap → tahap lain tetap jalan, body tidak diubah. (Mengikuti konvensi `open-sse/rtk/` dan `open-sse/AGENTS.md`.)
2. **Deterministik** — kompresi RTK custom harus deterministik (tanpa random, tanpa timestamp) supaya prompt cache provider tidak ter-invalidate.
3. **Teks injeksi statis** — Ponytail/Caveman/custom prompt harus string konstan yang sama tiap turn, disisipkan di posisi yang sama (awal system prompt), supaya cache prefix valid.
4. **Jangan sentuh `is_error`** — hasil tool yang error tidak boleh dikompresi (RTK upstream sudah melakukan ini di `rtk/index.js:67` & `:103`; pertahankan).
5. **Provider `cursor`** — RTK harus jalan **sebelum** translate untuk provider ini (`chatCore.js:138`), karena translator cursor menulis ulang `tool_result` jadi user text. Kalau custom RTK menyisipkan tahap baru, perhatikan urutan ini.
6. **Cache re-anchor tetap terakhir** — `anchorClaudeCache` (`chatCore.js:335`) harus tetap dijalankan **setelah** semua tahap yang mengubah body, kalau tidak, breakpoint bisa menunjuk blok yang salah.

---

## 3. Rencana Perubahan per File (Fase 1)

> **STATUS: RENCANA.** Dokumen ini hanya pemetaan — belum ada kode fitur yang ditulis.

### 3.1 File upstream yang akan disentuh (sengaja, seminimal mungkin)

| File | Perubahan | Alasan | Estimasi |
|---|---|---|---|
| `open-sse/handlers/chatCore.js` | +1 import, +1 baris pemanggilan pipeline custom (blok 282–320) | titik hook tunggal untuk semua tahap transform | ~3 baris |
| `src/sse/handlers/chat.js` | teruskan `apiKey`/context ke `handleChatCore` bila belum ada | pipeline butuh identitas key untuk toggle | ~5 baris |
| `open-sse/services/combo.js` | +callback `onFallback` / `onToolCallInvalid` | tool-call repair retry ke model lain, log chain | ~10 baris |

> Kalau `chatCore.js` ternyata sudah menerima `apiKey` (memang sudah — `chatCore.js:396` meneruskan `apiKey`), maka `chat.js` **tidak perlu** disentuh untuk toggle per key; cukup baca key dari `apiKey` di dalam pipeline.

### 3.2 File baru di `src/custom/` (seluruh logika fitur)

```
src/custom/
├── index.js                      # barrel
├── pipeline/
│   ├── index.js                  # applyPipeline(ctx) — orchestrator, fail-open
│   ├── context.js                # normalisasi context (provider/model/format/key/project/session)
│   └── toggle.js                 # resolusi on/off per key/combo/provider
├── rtk/
│   ├── whitelist.js              # whitelist tool + aturan per-tool
│   ├── filterRouter.js           # pilih filter berdasarkan tool + whitelist
│   └── tokenMeter.js             # estimasi token before/after (upstream hanya byte)
├── transform/
│   ├── caveman.js                # wrapper native + level policy (default off)
│   ├── ponytail.js               # wrapper native + level policy
│   └── promptInjector.js         # sisip statis di awal system prompt
├── toolcall/
│   ├── repair.js                 # repair JSON tool call rusak
│   └── retryToModel.js           # retry ke member combo lain saat tool call invalid
└── cache/
    └── awareRouting.js           # sticky session + auto cache_control
```

### 3.3 Test yang perlu ditulis (semua di `tests/unit/`)

| Test file | Cakupan |
|---|---|
| `custom-pipeline-order.test.js` | urutan tahap pipeline benar; tahap gagal tidak menghentikan tahap lain |
| `custom-rtk-whitelist.test.js` | tool di luar whitelist tidak dikompresi |
| `custom-token-meter.test.js` | token before/after terhitung dan masuk log |
| `custom-prompt-inject.test.js` | injeksi statis, idempoten, posisi stabil |
| `custom-toolcall-repair.test.js` | repair JSON rusak; fallback ke model lain |
| `custom-cache-aware.test.js` | sticky session + `cache_control` |

Pola test mengikuti repo: `import { describe, expect, it } from "vitest"`, import relatif `../../src/custom/...`.

### 3.4 Dasar untuk setiap file upstream (kalau perlu meyakinkan)

| Necessitas | Sumber |
|---|---|
| Format & alur | `docs/ARCHITECTURE.md` (upstream), `open-sse/AGENTS.md` |
| Test | `tests/unit/rtk.test.js`, `tests/unit/system-inject.test.js`, `tests/unit/combo-request-scoped-fallback.test.js` |
| Chart/dashboard | `src/app/(dashboard)/dashboard/usage/components/UsageChart.js` (recharts + Tailwind v4 token) |
| DB | `src/lib/db/schema.js`, `src/lib/db/repos/*`, `src/lib/db/index.js` (barrel) |

---

## 4. Fitur Fase 1 yang SUDAH ADA di Upstream (jangan diduplikasi)

Hasil riset kode (`git diff upstream/master..HEAD -- open-sse/rtk` → kosong → identik dengan upstream).

### 4.1 RTK token saver — ✅ sudah ada

| Aspek | Status | Bukti |
|---|---|---|
| Kompresi `tool_result` | ✅ | `open-sse/rtk/index.js:8` `compressMessages` — in-place, shape OpenAI Responses / OpenAI tool / Claude tool_result / Kiro |
| Pemanggilan | ✅ | `chatCore.js:138-142` (pre-translate, provider cursor) & `chatCore.js:282` (post-translate, provider lain) |
| Fail-open | ✅ | `open-sse/rtk/applyFilter.js:3` `safeApply` — try/catch, fallback output mentah |
| Skip `is_error` | ✅ | `rtk/index.js:67` & `:103` |
| Filter per-tool | ✅ | `open-sse/rtk/filters/` — 12 filter (`gitDiff`, `gitStatus`, `gitLog`, `grep`, `find`, `ls`, `tree`, `dedupLog`, `smartTruncate`, `readNumbered`, `searchList`, `buildOutput`) |
| Deteksi | ✅ | `open-sse/rtk/autodetect.js:28` `autoDetectFilter` — **content-based**, bukan whitelist tool |
| Log penghematan | ⚠️ **bytes, bukan token** | `rtk/index.js:149` `formatRtkLog` → `[RTK] saved ${saved}B / ${bytesBefore}B (${pct}%)` — `stats.bytesBefore` / `bytesAfter` (`rtk/index.js:121-145`) |
| Header opt-out | ✅ | `chatCore.js:132` `x-9router-token-saver: off` |

**Yang BELUM ada → peluang fitur kita:**
- **Whitelist tool** — RTK upstream memampulkan tool_result apa pun yang bentuknya cocok. Roadmap Butuh "whitelist per tool".
- **Pengukuran token** — hanya byte. Roadmap Butuh "log token sebelum/sesudah".
- **Toggle per key/combo** — sekarang global (`settings.rtkEnabled`), bukan per key.
- `open-sse/rtk/registry.js` (filter registry + alias `rg`→grep, `fd`→find) **dead code** — tidak di-import siapa pun.

### 4.2 Caveman — ✅ sudah ada

| Aspek | Status | Bukti |
|---|---|---|
| Implementasi | ✅ | `open-sse/rtk/caveman.js:7` `injectCaveman(body, format, level)` → `systemInject.js:11` |
| Level | ✅ | `open-sse/rtk/cavemanPrompts.js` — `lite`, `full`, `ultra`, `wenyan-lite`, `wenyan`, `wenyan-ultra` |
| Toggle | ✅ | `settings.cavemanEnabled` (default **false**), `settings.cavemanLevel` (default `full`) — `src/lib/db/repos/settingsRepo.js:57-58` |
| Call site | ✅ | `chatCore.js:302-303` |
| UI | ✅ | `src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js` → `PATCH /api/settings` |
| Test | ✅ | `tests/unit/caveman-prompts.test.js`, `tests/unit/system-inject.test.js` |

### 4.3 Ponytail — ✅ sudah ada

| Aspek | Status | Bukti |
|---|---|---|
| Implementasi | ✅ | `open-sse/rtk/ponytail.js:7` `injectPonytail(body, format, level)` |
| Level | ✅ | `open-sse/rtk/ponytailPrompt.js` — `lite`, `full`, `ultra` |
| Toggle | ✅ | `settings.ponytailEnabled` (default **false**), `settings.ponytailLevel` — `settingsRepo.js:59-60` |
| Call site | ✅ | `chatCore.js:308-309` |
| Test | ✅ | `tests/unit/system-inject.test.js` (import `injectPonytail` + `PONYTAIL_PROMPTS`) |

> Roadmap menyebut "Ponytail (minimal code), Caveman (lite/full/ultra), RTK versi sendiri" — **hampir semuanya sudah ada**. Yang belum: kontrol gabungan Caveman+Ponytail (rekomendasi: Caveman lite kalau keduanya nyala), guard "jangan terapkan ke output end-user", dan toggle per key/combo.

### 4.4 Tool-call repair — ⚠️ ada tapi parsial & per-provider

| Mekanisme | Lokasi | Cakupan |
|---|---|---|
| Kiro integrity gate + repair retry | `open-sse/executors/kiro.js:35-39` (`REPAIR_INSTRUCTIONS`), `:121-131` `appendRepairInstruction`, `:359` `attachIntegrityGate`, `:425` `runIntegrityRecovery` | 1x retry ke **provider yang sama**; toggle per-koneksi + env `KIRO_TOOL_CALL_REPAIR` |
| DeepSeek Web repair | `open-sse/executors/deepseek-web.js:1006-1041` | 1x retry dengan **sesi baru** |
| Loose JSON salvage | `open-sse/translator/webTools.js:252-258` `parseLooseJsonObject` / `normalizeLooseJson`; `open-sse/translator/deepseekWebTools.js:330` `salvageLeadingJsonObject` | parse/salvage argumen |
| Sanitasi (bukan repair) | `open-sse/translator/concerns/toolCall.js:26` `ensureToolCallIds`, `:123` `fixMissingToolResponses`; `open-sse/translator/concerns/kiroConversation.js:261` `reconcileToolPair` | cegah HTTP 400 |

**Yang BELUM ada → peluang fitur kita:**
- Repair **generik lintas provider** (bukan Kiro/DeepSeek专属).
- **Retry ke model lain** saat tool call invalid — saat ini fallback hanya dipicu HTTP error (`chat.js:475-560`), sedangkan tool call rusak biasanya muncul sebagai HTTP 200 → tidak memicu fallback.
- Deteksi tool call invalid di provider selain Kiro/DeepSeek.

### 4.5 Cache-aware routing — ⚠️ parsing (bukan routing)

| Aspek | Status | Bukti |
|---|---|---|
| `cache_control` Claude | ✅ | `open-sse/translator/request/openai-to-claude.js:108,139,181`; `open-sse/translator/formats/claude.js:369` |
| Anchor / re-anchor | ✅ | `open-sse/translator/formats/claude.js:395` `anchorClaudeCache`; dipanggil `chatCore.js:335` |
| Sanitasi budget breakpoint | ✅ | `open-sse/translator/formats/claude.js:60-110` |
| Prompt cache key (OpenAI) | ✅ | `open-sse/executors/codex.js:474-476`; `open-sse/executors/opencode.js:179` |
| Session identity | ✅ | `open-sse/utils/sessionManager.js:212` `resolveSessionIdentity` — prioritas: client session id → hash assistant text → workspaceId → per-connection |
| Session-sticky combo | ✅ | `open-sse/services/systemoneRouter.js:170` `getStickyComboModel` (TTL 2 jam) |
| Account sticky | ✅ | `src/sse/services/auth.js:174-196` (`stickyRoundRobinLimit` default 3) |
| **Routing "pilih provider karena cache-nya warm"** | ❌ **belum ada** | tidak ada logika pemilihan provider berdasarkan state cache |

**Yang BELUM ada → peluang fitur kita:**
- Cache-aware routing eksplisit (pilih akun/provider yang cache prefix-nya warm).
- Auto-inject `cache_control` untuk provider non-Claude yang mendukungnya.
- Indikator cache-hit di observability.

### 4.6 Ringkasan

| Fitur Fase 1 | Status upstream | Effort di fork |
|---|---|---|
| RTK kompresi tool_result | ✅ ada | whitelist per tool + token meter |
| Caveman | ✅ ada | guard output end-user + toggle per key |
| Ponytail | ✅ ada | guard + toggle per key |
| Tool-call repair | ⚠️ per-provider | generic + retry ke model lain |
| Cache-aware routing | ⚠️ parsing saja | logika routing + indikator |

---

## 5. Extension Point yang Tersedia

| Mekanisme | Lokasi | Layak? |
|---|---|---|
| **Translator registry** | `open-sse/translator/index.js:22` `register(from, to, reqFn, resFn)` | ✅ extension point paling bersih — file baru + 1 import di `translator/index.js` |
| **Provider registry** | `open-sse/providers/registry/{id}.js` + `registry/index.js` | ⚠️ butuh 2 file; `registry/index.js` generate dari `scripts/migrate-registry.mjs` |
| **Executor map** | `open-sse/executors/index.js:39` | subclass `BaseExecutor` + 1 entri map |
| **Provider nodes (dashboard)** | `src/app/api/provider-nodes/route.js` | ✅ tambah provider OpenAI-compatible **tanpa edit kode** |
| **Provider header override** | `settings.providerOverrides[provider].headers` → `chat.js:432` → `base.js:132` | ✅ user bisa tambah header tanpa edit kode |
| **Plugin/middleware framework** | — | ❌ tidak ada |
| `src/custom/` | — | ❌ **belum ada** (harus dibuat) |
| `src/proxy.js` | `src/proxy.js:13` | ❌ middleware HTTP/auth — bukan hook body `/v1` |
| `src/mitm/` | `src/mitm/server.js` | ❌ reverse-proxy untuk CLI desktop — bukan pipeline `/v1` |
| `custom-server.js` | root, 139 baris | ❌ bukan plugin system (IP stamping, h2c, token refresh) |

---

## 6. Database & Observability (konteks untuk Fase 2–3)

Fork ini sudah punya (branch `feat/health-routing-observability`, commit `37ea6db8`):

| Komponen | Lokasi |
|---|---|
| Schema v3 | `src/lib/db/schema.js` — `usageHistory` + `latencyMs`/`ttftMs`/`projectName`/`fallbackCount`; tabel baru `fallbackEvents` |
| Repo | `src/lib/db/repos/fallbackRepo.js`, `src/lib/db/repos/metricsRepo.js` |
| Circuit breaker | `src/sse/services/healthBreaker.js` — closed/open/half-open per `connectionId\|model` + `provider\|model` |
| Wiring breaker | `src/sse/services/auth.js` (skip akun breaker-open, anti-deadlock), `src/sse/handlers/chat.js` (success/failure) |
| Fallback chain | `src/sse/handlers/chat.js`, `open-sse/services/combo.js` → `fallbackEvents` |
| Project attribution | `src/sse/services/requestContext.js` — header `x-9router-project`, fallback ke nama API key, default `unassigned` |
| API | `GET /api/health/breaker`, `/api/usage/fallbacks`, `/api/usage/latency`, `/api/usage/projects` |

> `meta`/`tokens` di `usageHistory` masih JSON. `projectName` sudah kolom nyata (bisa di-query SQL).

---

## 7. Perintah Verifikasi

```bash
# dependency
npm install && (cd tests && npm install)

# lint  (tidak ada script lint di root — jalankan manual)
npx eslint .

# test   (package terpisah di tests/)
cd tests && npx vitest run                    # semua
cd tests && npx vitest run unit/<file>.test.js

# build
npm run build
```

> **Catatan:** suite upstream **tidak hijau** di checkout bersih (~938 pass / ~64 fail). 26 failure
> sudah dikatalogkan di `tests/__baseline__/known-fails.txt`. Regresi dinilai dengan
> `tests/__baseline__/verify-no-regression.mjs`, bukan dari run mentah. `tests/unit/embeddings.cloud.test.js`
> selalu gagal (`cloud/` tidak ada di repo ini) dan `unit/xai-oauth-service.test.js` timeout 5s.
> Test `*.real.test.js` butuh kredensial — skip.

---

## 8. Checklist Keamanan (WAJIB per perubahan)

- [ ] Cloud Sync tetap **nonaktif** di config deploy.
- [ ] `REQUIRE_API_KEY=true`, `JWT_SECRET` random panjang, `INITIAL_PASSWORD` kuat.
- [ ] Tidak ada secret yang di-hardcode atau ditulis ke dokumen.
- [ ] Copyright notice + lisensi MIT asli utuh.
- [ ] Tidak menyentuh `.github/workflows/sync-upstream.yml` dan `LICENSE`.
- [ ] Header `X-Forwarded-For` tetap tidak dipercaya kecuali dari loopback reverse proxy
      (perilaku `custom-server.js` — jangan diubah).
- [ ] Review keamanan (auth, penyimpanan kredensial, manipulasi header, SSRF) **sebelum** logika fungsional.
- [ ] Satu fitur per branch `feat/<nama>`; tidak commit langsung ke `master`.

---

## 9. Referensi

| Dokumen | Isi |
|---|---|
| [`../ROADMAP.md`](../ROADMAP.md) | roadmap fitur 5 fase |
| [`../AGENT.md`](../AGENT.md) | aturan kerja repo fork |
| [`../CLAUDE.md`](../CLAUDE.md) | panduan upstream (arsitektur, konvensi, gotcha) |
| [`../open-sse/AGENTS.md`](../open-sse/AGENTS.md) | konvensi engine `open-sse/` |
| `docs/ARCHITECTURE.md` (upstream) | arsitektur sistem — **stale** di bagian persistence (sudah SQLite) |
