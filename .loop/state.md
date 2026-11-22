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

## Wave 9 (2026-11-21) — API Keys readability + sidebar grouping

Goal (user): "tulisan api keynya kenapa begini ya benerin dong sama sidebarnya di kelompokin masing masing biar enak di lihatnya".

| task | agent | pane_id | artifact | owns |
|---|---|---|---|---|
| A-keys-ui | worker-keys-ui | w1T:p2 | `.loop/tasks/A-keys-ui.result.md` | `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js` |
| B-sidebar-groups | worker-sidebar | w1T:p3 | `.loop/tasks/B-sidebar-groups.result.md` | `src/shared/components/Sidebar.js` |

Temuan bonus (fix di A): `GET /api/keys` sudah return `masked: true` untuk sesi remote, tapi client
DROPPED flag itu -> tombol reveal/copy operate on string yang tak pernah bisa dipakai (copy `sk-xxx***yyy`).
Fix: simpan flag, satu gaya mask, reveal/copy disabled + nota bila masked.

Verifikasi orchestrator: eslint Sidebar 0 issue; EndpointPageClient 7 issue = 5 error + 2 warning
PRE-EXISTING (proven baseline sebelum edit, tak disentuh); `npm run build` exit 0; 2 self-check node
PASS; browser probe (login lokal + Origin remote) masked= True -> 8 tombol disabled + 4 nota tampil,
lokal -> 0 disabled, 0 nota; screenshot 1400x900 -> 5 grup KEY/STATUS/ACCESS/RATE LIMITS/BUDGET
terbaca, sidebar WORKSPACE/MONITOR/TOOLS/SYSTEM. Perubahan BELUM di-commit (user belum minta).

## Wave 9b (2026-11-22) — Task C: API key credential card redesign

Goal (user): tulisan api key + meterai "kok ribet" — tiap credential jadi kartu sendiri, mask fixed
length, satu right rail, budget + rate-limit rapi.

Artifact: `.loop/tasks/C-keys-card.result.md` (worker C). Orchestrator verifikasi independen:
- `npm run build` exit 0 (Next 16.4.5, 156/156 static).
- eslint owned-file = 5 error + 2 warning (PRE-EXISTING, tak disentuh); Sidebar 0 issue.
- `node .loop/scratch/c-keys-check.mjs` exit 0 (mask fixed 18 char / 8 bullet, masked-flag utuh,
  tanggal `Oct 27, 2026`, label Credential/Access/Rate limits/Budget, budget dedupe, 2 Save terpisah).
- `node .loop/scratch/c-keys-browser.mjs` exit 0: 1400x1000 & 390x844 -> 4 kartu, chip len konstan 18,
  scrollWidth == clientWidth (no overflow), kartu border 2px radius 12px, rail kanan satu (trash flush
  dgn content edge), rpm/tpm left sama (836 & 64). Screenshot `.loop/scratch/c-keys-card.png`;
  vision re-review: state "Enabled" jadi chip hijau bordered, trash selalu terlihat, tanpa duplikat Active.
- Regresi: 6 fail (cursor auto-import x5 + backupDbLite) IDENTIK dgn baseline tanpa perubahan wave 9/9b
  (0 fail baru). Test `api-key-visibility-guidance` gagal karena source string berubah -> test di-update
  ke kontrak baru `keyMaskView(key.key, keysMasked, visibleKeys.has(key.id))`.

Perubahan (Wave 9 + 9b) BELUM di-commit — final review + hygiene audit sedang berjalan via Herdr.

## Wave 10 (2026-11-22) — Herdr reconciliation + deploy-readiness audit

User memberi autonomy grant: orchestrator brain-only; pane Herdr mengerjakan audit/review/fix.

| task | pane | role | artifact |
|---|---|---|---|
| W9-final-review | `w1T:p4` | reviewer independen, read-only | `.loop/tasks/W9-final-review.review.md` |
| T8-deploy-readiness | `w1T:p3` (`worker-sidebar`) | release audit, read-only | `.loop/tasks/T8-deploy-readiness.result.md` |
| W9-hygiene-audit | `w1T:p2` (`worker-keys-ui`) | hygiene/secret/commit-scope audit, read-only | `.loop/tasks/W9-hygiene-audit.result.md` |

Setelah 3 artifact: reconcile; FAIL -> dispatch fix ke owner pane; PASS -> commit eksplisit Wave 9/9b;
T8 deployment tetap tidak dieksekusi sampai gate + approval side-effect terpisah.

auto-loop active: poll Herdr artifacts/status, lalu cross-review/fix/global gate.

Final Wave 10 status: review PASS, fixes PASS, global gate PASS (5298 total / 5193 pass / 6 baseline
failures; failure set identical to baseline, 0 regressions), build PASS, secret cleanup complete
(live auth cookie removed, dev.log restored, generated .vitest output restored). Product slice READY TO
COMMIT: EndpointPageClient.js, Sidebar.js, Toggle.js, api-key-visibility-guidance.test.js,
toggle-title.test.js. Records slice follows product commit.
Product commit created: `cf733ed7 fix(dashboard): clarify API keys and group navigation`.

T8 deploy gate: NOT READY — blockers: current fork.16 code/image unpublished, GHCR only fork.1 found,
compose still points upstream, actual schema v12 (not stale v3->v4), production backup/deploy/rollback
not executed. No production action taken.

## Baseline test (setelah T3, sebelum T4)
Fork post-merge: 5034 test, 48 fail. Upstream-only v0.5.119: 4712 test, 48 fail. Set identik 2 arah.
Kriteria regresi T4b-T7: fail set fork SETELAH task N == fail set fork SEBELUM task N, dan 0 fail baru vs upstream-only.

## Follow-up (non-blocking)
- FU1: golden-url-header 7 gagal pre-existing (snapshot versi 0.5.104 vs package 0.5.112; header UUID codebuddy non-deterministik). Fix terpisah.
- FU3: jalankan vitest dari folder tests/ (alias @/ hanya di tests/vitest.config.js).
- FU4 (dari T3): 19 test upstream strictProxy butuh network nyata -> gagal di sandbox. Bukan regresi fork.
