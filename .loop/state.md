# 9Router Overpower — loop state

Goal: Jadikan fork 9router jadi versi "overpower" yang production-ready — repo bersih & hijau, sync ke upstream v0.5.119, punya error-taxonomy (taksonomi error) + health-matrix supaya provider yang sehat tidak dibakar reputasinya, dan siap deploy ke VPS.

Max iterations per task: 3
Mode: subagent (HERDR_ENV tidak aktif — fallback)
Status: running

Repo: /home/kennyh/Documents/9router
origin=RianHaryadi/9router, upstream=decolua/9router
Branch kerja: sync/upstream-20261112 (merge upstream v0.5.119 done)

## Tasks

- [x] T1 — Hygiene & safety | DONE 6316a88d. DOCKERHUB_IMAGE=rianharyadi/9router; sync-upstream.yml dibuat; path PROMPT-LANJUTAN diperbaiki. Reviewer PASS.
- [x] T2 — WIP reconcile | DONE 791cde2 (19 file, +4210). 12 fail -> 77/77. Semua perbaikan sisi implementasi. Reviewer PASS.
- [x] T3 — Merge upstream v0.5.119 | DONE 498984dc (merge). 0 regresi fork (verified independen: fork post-merge 48 fail == upstream-only 48 fail, set identik 2 arah). Reviewer PASS.
- [x] T4 — Error taxonomy (Layer 1) | DONE f13b4e47. src/custom/guard/errorTaxonomy.js (481 baris) + wiring healthBreaker. 39 test baru. Reviewer TIDAK JALAN (limit) -> orchestrator verifikasi independen: 12 klasifikasi payload produksi benar 0 fail, breaker behavior benar. Lihat T4b.
- [x] T4b — Wire taxonomy ke jalur modelLock_ DB | DONE 35502805 (orchestrator kerjakan sendiri; subagent kena free limit). markAccountUnavailable() pakai classifyError: ignore→no lock; queue+wait-progressing→fallback tanpa lock (INI perbaikan inti, 5 akun qoder sehat tak saling kunci); queue+exclude→30m. Durasi 401/402/404/429 tetap upstream (taksonomi hanya tentukan blast radius). 11 test baru. 0 regresi (48==48).
- [x] T5 — Health matrix (Layer 2) | DONE 7486d46f. src/custom/guard/healthMatrix.js (buildMatrix/pickBestAccount/preflight/summaryByProvider) + GET /api/health/matrix + tab "Matrix" di dashboard. 15 test. 0 regresi. Orchestrator kerjakan (subagent limit).
- [x] T6 — Cache serve hardening | DONE 51bda2c9 (FU2 closed). Error response tak di-cache; claim di-RELEASE (bukan complete) -> retry next_allowed, bukan 409. 7 test baru. 0 regresi.
- [x] T7 — Final verify + tag | DONE dc5e1378 + tag v0.5.119-fork.1 (push ke origin: branch sync/upstream-20261112 + tag). FINAL: 5106 test, 48 fail, 0 regresi fork (== upstream-only 48). Build exit 0. Eslint: 44 file baru fork BERSIH; 5 error+2 warning di EndpointPageClient.js proven PRE-EXISTING di upstream/master (worktree bersih). Temuan BUG UPSTREAM: v0.5.119 punya root pkg=0.5.116 & cli pkg=0.5.119 -> version-check workflow akan reject tag itu (sebabnya DockerHub latest masih 0.5.116). Fix: align ke 0.5.119-fork.1. Workflow docker-publish in_progress.
- [ ] T8 — Deploy ke VPS | needs-approval: image GHCR + Coolify update + backup DB + schema v3->v4

## WAJIB DIBACA UNTUK T4b (temuan investigasi orchestrator)
Ada DUA mekanisme lock di 9router:
1. `healthBreaker` (RAM, fork) — sudah di-wire T4 via classifyError.
2. `modelLock_*` (DB, upstream) — di src/sse/services/auth.js markAccountUnavailable() -> checkFallbackError() -> buildModelLockUpdate().

Yang MUNGKIN membakar 5 akun qoder di produksi adalah #2: log produksi `locked modelLock_mmodel for 30s [503]`使用的是 format dari #2 (auth.js:303), BUKAN dari breaker. checkFallbackError() (open-sse/services/accountFallback.js:29) tidak punya rule untuk 10605 -> jatuh default `{shouldFallback:true, cooldownMs: TRANSIENT_COOLDOWN_MS(30s)}` -> tulis modelLock_ per akun.

T4b harus: pakai classifyError (single source of truth) untuk memutuskan apakah error ini layak mengunci akun di DB, dan dengan scope apa.

## Constraints (semua worker)
- Working dir WAJIB /home/kennyh/Documents/9router
- Jangan sentuh: .loop/state.md, LICENSE, src/lib/db/schema.js, .github/workflows/docker-publish.yml (kecuali DOCKERHUB_IMAGE), .loop/tasks/*.md
- Jangan deploy, jangan migrasi DB production, jangan push (kecuali T7)
- Logika bisnis di src/custom/; upstream disentuh minimal
- Test harus jalan nyata (bukan klaim)

## Log
- T1 iter1: worker -> reviewer PASS (6316a88d). Publish DockerHub hanya utk repo upstream; fork pakai GHCR.
- T2 iter1: worker -> reviewer PASS (791cde2). 12 fail -> 77/77, perbaikan di sisi implementasi.
- T3 iter1: worker -> reviewer PASS (498984dc). Orchestrator verifikasi independen full-suite 2 arah vs upstream-only: 0 regresi fork.
- T4 iter1: worker selesai (f13b4e47). Reviewer GAGAL (free usage limit) -> orchestrator jalankan verifikasi independen: 12/12 klasifikasi payload produksi OK, model-scope key lintas akun OK, needsHuman OK, ignore OK. TAPI ditemukan gap: jalur modelLock_ DB belum di-wire -> T4b.
- T4b iter1: subagent GAGAL (free usage limit) -> orchestrator kerjakan sendiri. Temuan saat investigasi: checkFallbackError() (upstream) tak punya rule 10605 -> jatuh default -> tulis modelLock_ per akun. 5 akun qoder sehat saling mengunci. Test awal salah ekspektasi (418 = requestScoped upstream) -> dikoreksi. 1 regresi baru (github-monthly-usage-lock: override cooldown 402 bentrok kontrak upstream) -> diperbaiki dgn prinsip "taksonomi menambah rule yg tak ada di upstream, tak menimpa yg sudah benar". Final: 0 regresi, build exit 0, eslint bersih.

## Baseline test (setelah T3, sebelum T4)
Fork post-merge: 5034 test, 48 fail. Upstream-only v0.5.119: 4712 test, 48 fail. Set identik 2 arah.
Kriteria regresi T4b-T7: fail set fork SETELAH task N == fail set fork SEBELUM task N, dan 0 fail baru vs upstream-only.

## Follow-up (non-blocking)
- FU1: golden-url-header 7 gagal pre-existing (snapshot versi 0.5.104 vs package 0.5.112; header UUID codebuddy non-deterministik). Fix terpisah.
- FU3: jalankan vitest dari folder tests/ (alias @/ hanya di tests/vitest.config.js).
- FU4 (dari T3): 19 test upstream strictProxy butuh network nyata -> gagal di sandbox. Bukan regresi fork.
