# W9 Fix Cross-Review — Sidebar dead nav + Toggle title

SKILLS LOADED: Hermes `requesting-code-review` (v2.1.1) via `hermes-brain_hermes_skill_get`; procedure per linked reference `references/read-only-diff-review.md` (gates run independently, claim sampling with file:line, verdict artifact). Adversarial source-contract-test guidance from `references/static-source-contract-tests.md` applied to item 3.

VERDICT: PASS

## EVIDENCE

### Fix 1 — Sidebar dead `navItems` removed (`src/shared/components/Sidebar.js`)

- `grep -n "navItems" src/shared/components/Sidebar.js` → 0 matches (was line 51). HEAD had 3 occurrences; diff shows the flat-array declaration + `flatMap` line removed, nothing else.
- No route/group/filter regression: `NAV_GROUPS` (10 hrefs, Workspace→Monitor→Tools), per-group member filter with empty-group pruning, System owner-only block all present (verified in prior review; unchanged by this fix — diff vs HEAD is the same 67+/40− grouping change, now without the dead line).
- `node .loop/scratch/b-sidebar-check.mjs` → `PASS: 10 items, order Workspace → Monitor → Tools, member filter keeps /dashboard/usage only, no empty group.`
- Cross-check of consumers: grep over src/ + tests/ finds no remaining `navItems` reference — removal is safe.

### Fix 2 — `src/shared/components/Toggle.js` title forwarding

- Diff vs HEAD is exactly 2 added lines:
  - `Toggle.js:12` — `title,` in the destructure (optional, no default needed).
  - `Toggle.js:36` — `title={title}` on the real `<button>` (`:33`), which carries `role="switch"` (`:35`) and `aria-checked`. Confirmed this is the FIRST and interactive button in the component, not the decorative thumb `<span>`.
- No other change: styling, `sizes`, `handleClick`, `disabled` untouched.
- `title` undefined when callers omit it → React omits the attribute → pre-existing behavior unchanged. `EndpointPageClient.js:1206` already passes `title={key.isActive ? "Pause key" : "Resume key"}` — now effective. Falsy-string safety: React drops empty-string titles; callers here never pass one.

### Fix 3 — `tests/unit/toggle-title.test.js` (new, 18 lines)

Non-vacuous: YES.
- Structural extraction, not whole-file substring: props pulled from the destructure regex (`/export default function Toggle\(\{([^}]*)\}\)/`, test line 11) and `title={title}` asserted INSIDE the extracted first `<button …>` opening tag (lines 14-16), which is the switch button. A token parked in a comment or in the thumb span would not satisfy line 16, because the first `<button` match is the switch button.
- RED/GREEN evidence credible: independent verification — `git show HEAD:src/shared/components/Toggle.js` contains neither `title,` in the destructure nor `title={title}`, and the test file is new/untracked, so the recorded RED ("expected [ 'checked = false', 'onChange', … ] to include 'title'") is consistent with the actual pre-fix source. GREEN re-run by me (below). Implementer's stated mutation check (removing `title={title}` → test fails) matches the assertion's sensitivity: line 16 directly tests that exact token inside the button tag.
- Remaining ceiling (stated by implementer, agreed): it does not render React; a real-DOM test is blocked by the repo's node-environment vitest config + no JSX transform. Acceptable for a 2-line prop-forward change.

### Fix 4 — `.loop/scratch/b-sidebar-check.mjs` boundary update

- Diff-scope claim verified by reading the file: only the end-boundary changed (`src.indexOf("\nconst debugItems =", start)`, line 9) since the old bound (`const navItems`) no longer exists. All original assertions intact and re-verified live: group order, 10 unique hrefs, per-group item lists, member-filter simulation (only Monitor//dashboard/usage survives), render-structure matches, and `doesNotMatch(/visibleNavItems/)`.

### GATES (all run fresh in this review)

1. `npx eslint src/shared/components/Sidebar.js src/shared/components/Toggle.js tests/unit/toggle-title.test.js` → **ESLint: No issues found** (exit 0).
2. From `tests/`: `PATH=/home/kennyh/.hermes/tools/node-26.12.1-linux-x64/bin:$PATH npx vitest run unit/toggle-title.test.js unit/api-key-visibility-guidance.test.js` → **Test Files 2 passed (2), Tests 9 passed (9)** (1 toggle-title + 8 visibility-guidance), 139ms.
3. `node .loop/scratch/b-sidebar-check.mjs` → **PASS** (single line above), exit 0.
4. `git diff --check -- src/shared/components/Sidebar.js src/shared/components/Toggle.js` → exit 0, no whitespace errors (test file untracked, covered by reading it: clean).

### Hygiene / security

- No secrets in added lines (both fixes are UI plumbing; added lines contain only `title,` and `title={title}`).
- No unrelated source edits: Toggle diff = 2 lines; Sidebar delta since last review = removal of 1 dead line only. `.loop/state.md` + `.loop/scratch` churn expected.
- No auth/IP/header code touched. No git operations performed (read-only honored).

### Implementer result docs

- `.loop/tasks/W9-fix-sidebar-dead-nav.result.md` — claims match verified reality (grep counts, gate outputs).
- `.loop/tasks/W9-fix-toggle-title.result.md` — claims match verified reality, including the honest test-framework ceiling and the RED/GREEN/mutation transcript.

## ISSUES

none

## COVERAGE LIMITS

- No real-browser render test of the toggle tooltip (framework ceiling as stated; structural test + mutation evidence accepted instead).
- Sidebar visual regression (heading styling) not re-screenshotted; covered by unchanged classNames + passing structural check only.
- Full vitest suite / `npm run build` not run — out of the brief's gate list; prior review's build evidence stands, and these fixes touch no import graph beyond what lint+scoped tests cover.
- Mutation check of `toggle-title.test.js` re-performed only by reasoning over the assertion structure, not by re-executing the implementer's edit-restore cycle (source is read-only for this review).
