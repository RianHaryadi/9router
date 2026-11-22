# W9 Final Review — API Keys card + grouped sidebar

SKILLS LOADED: Hermes `requesting-code-review` (v2.1.1) via `hermes-brain_hermes_skill_get`, plus linked reference `references/read-only-diff-review.md` (read-only diff review procedure followed: map diff → verify claims → run gates → hygiene scan → claim sampling with file:line → verdict artifact).

VERDICT: PASS

REVIEWED BRANCH/TREE: `sync/upstream-20261112`, uncommitted Wave 9/9b changes only. Read-only; no source files touched.

## EVIDENCE

### Commands run (cwd `/home/kennyh/Documents/9router` unless noted)

1. `git status --short && git diff --stat` — modified source files exactly match scope: `EndpointPageClient.js`, `Sidebar.js`, `api-key-visibility-guidance.test.js` (+ `.loop/` scratch/state, expected). No unrelated source edits.
2. Full per-file diff read for all three scoped files (see claim table below).
3. `npx eslint "src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js" src/shared/components/Sidebar.js tests/unit/api-key-visibility-guidance.test.js`
   → 5 errors + 2 warnings, all in EndpointPageClient: `react-hooks/immutability` ×3 (lines 145, 146, 157), `react-hooks/set-state-in-effect` ×2 (lines 128, 871), `exhaustive-deps` ×2 warnings (lines 147, 165). Sidebar.js and test file: 0 issues.
   → Pre-existing confirmation: `git show HEAD:"src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js" | eslint --stdin --stdin-filename …` reproduces the identical 5 errors + 2 warnings at HEAD-only line numbers (86, 103, 104, 115, 829). **Baseline identical; the diff introduces 0 new lint issues.**
4. From `tests/`: `PATH=/home/kennyh/.hermes/tools/node-26.12.1-linux-x64/bin:$PATH npx vitest run unit/api-key-visibility-guidance.test.js` → **Test Files 1 passed (1), Tests 8 passed (8)**, 122ms.
5. `node .loop/scratch/c-keys-check.mjs` → all 5 PASS lines (fixed mask shape for len 12/20/40/120, server-mask normalization, disabled-actions+note, single date helper, structural checks).
6. `git diff --check -- <3 scoped files>` → exit 0, no whitespace errors.
7. Secret scan on added lines (`^+` grep for `api_key|secret|password|token|passwd\s*=\s*['"]…['"]`, `sk-[a-zA-Z0-9]{20,}`, private-key markers) → no matches.

### Requirement verification (claim → file:line)

1. **Mask format fixed 6+8+4** — `EndpointPageClient.js:25` `MASK_BULLETS = "•".repeat(8)`; `:28-33` `maskKey`: ≤10 chars → 2 chars + 8 bullets; else `slice(0,6) + 8 bullets + slice(-4)`. Constant output length 18 verified for key lengths 12/20/40/120 by check script. Old variable-length mask (`"•".repeat(fullKey.length - 10)`) removed at old line ~810.
2. **Server-masked normalize, no unusable copy** — `:35-45` `keyMaskView` masked branch: derives prefix from `indexOf("***")` capped at 6, suffix only when length > 12, output contains no `*` (check script asserts). Reveal/copy `disabled={keyView.actionsDisabled}` (`:1240` area) so the masked string can never be revealed or copied; visible warning note `MASKED_KEY_NOTE` (`:1259` area, `:22` constant). Server side cross-checked: `src/app/api/keys/route.js:27` `masked: !local`, masking at `:13-17`; client `:295-301,310-313` plumbs `data.masked` into `keysMasked` state, including the auto-provision re-fetch path.
3. **Per-credential card** — `:1178-1183` `keys.map` → `<section>` per key; header `SectionLabel>Credential`, name `:1188`, `Created {formatKeyDate(key.createdAt)}` `:1189`; single explicit state chip `{isPaused ? "Paused" : "Enabled"}` `:1216` area (success/warning styling); toggle `:1197`; delete button always visible (`border-2 border-ink bg-bg`, no `sm:opacity-0` hover-gating — old pattern removed, check script asserts absence). No "Active" word anywhere near the state chip.
4. **Access/confirm/rate-limit/budget flows intact** — `KeyAccessControls` + `onRequestRestrict` confirm flow carried over unchanged (`:1277-1289`); RPM and TPM each have own input + own Save (`handleSaveRpm` `:1253`, `handleSaveTpm` `:1275`); budget has `$` prefix label (`:1356-1358`, `aria-hidden`), one Unlimited checkbox (`:1372-1379`), Save with saving-state label (`:1381-1387`), Reset spend only when spent > 0 (`:1388-1396`), meter + spent line rendered only when `budgetLimitCents != null` (`:1335-1352`). `handleSaveBudget` logic untouched (`:792-800`).
5. **One date helper** — `formatKeyDate` `:54-56`, single call site `:1189` (check script asserts exactly 2 occurrences of `formatKeyDate(`). Options `{month:"short",day:"numeric",year:"numeric"}` → "Oct 27, 2026". No other `toLocaleDateString`/`toLocaleString` in file.
6. **Sidebar grouping** — `Sidebar.js:20-49` `NAV_GROUPS` with Workspace (5 items), Monitor (3), Tools (2) — same 10 routes, same relative order as the old flat `navItems`. `:51` `navItems = NAV_GROUPS.flatMap(...)` keeps any other consumer semantics (currently unused — see Issues #1). `:78-86` member filtering now per-group with `.filter(g => g.items.length > 0)` — no empty groups; `AREA_FOR_NAV` logic unchanged. `:205-233` rendering: heading `<p>` per group, Link classes/active styling byte-identical to old. System section (`:236+`) still owner-only (`!isMember`), Team-page filter and debugItems untouched.
7. **Test update legitimate** — `tests/unit/api-key-visibility-guidance.test.js:20` swaps the stale render-expression substring for the new helper call `keyMaskView(key.key, keysMasked, visibleKeys.has(key.id))`; the other assertions (reveal onClick `:21`, copy onClick `:22`, modal guidance `:12-17`, 6-locale translation checks `:25-37`) unchanged. Same coverage, adapted to the new contract; nothing weakened. (Note per skill reference: raw substring assertions are comment-bypassable — pre-existing test style, INFO only.)
8. **Accessibility** — delete: `title` + `aria-label={\`Delete API key ${key.name}\`}` (`:1209-1212`); reveal/copy: `title` + `aria-label` switch to `MASKED_KEY_NOTE` when disabled (`:1243-1246`, `:1255-1258`), with `disabled:cursor-not-allowed disabled:opacity-40`; RPM/TPM inputs keep `htmlFor`-linked `<label>` + `aria-label`; budget input keeps `aria-label="Monthly budget in USD"` (`:1360`); Toggle renders `role="switch"` + `aria-checked` (`src/shared/components/Toggle.js:31-34`). Delete button is a real `<button>` (keyboard/touch OK); mobile layout uses `sm:grid-cols-2` stacking.
9. **Hygiene** — `git diff --check` clean; no secrets in added lines; only `.loop/` scratch files untracked; no binary/db files introduced.

### Security notes (per repo CLAUDE.md)

- Positive: masked-session hardening is coherent end-to-end — server sends masked keys only to remote sessions (`api/keys/route.js:26-27`), client disables reveal **and** copy for masked keys, and the normalize path never round-trips `*` into a displayed value. No new secret exposure introduced.
- No header/IP/auth code touched by this diff. No new `dangerouslySetInnerHTML`, `eval`, or fetch-target changes.

## ISSUES

1. (nit, non-blocking) `src/shared/components/Sidebar.js:51` — `navItems` is now dead: defined via `flatMap` but no remaining references in the file. Harmless; delete when convenient.
2. (INFO, pre-existing, unchanged) `Toggle` component (`src/shared/components/Toggle.js:5-11`) does not accept or forward a `title` prop, so `title={key.isActive ? "Pause key" : "Resume key"}` on the toggle (`EndpointPageClient.js:1206`) is silently dropped — no tooltip. The old code passed the same dead prop, so behavior is unchanged. Forwarding `title` in Toggle would fix it.

No security concerns, no logic errors, no regressions found.

## COVERAGE LIMITS

- `npm run build` not re-run (per brief: evidence exists; inspection found no reason — no import changes, no new deps).
- Full vitest suite not run (not in mandatory commands; only the scoped test file was required and run).
- Browser screenshots (`.loop/scratch/c-keys-browser.mjs`, `*.png`) not re-executed; relied on code inspection + `c-keys-check.mjs` instead. Live rendered/pixel behavior unverified.
- `MASKED_KEY_NOTE` warning-color contrast (`text-warning` on card) not measured.
- i18n locale JSON files not directly re-read; covered by the passing test's locale assertions.
- `copy()` from `useCopyToClipboard` assumed unchanged (not in diff).
