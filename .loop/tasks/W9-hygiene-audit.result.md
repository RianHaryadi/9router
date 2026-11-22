SKILLS LOADED: requesting-code-review (plus its references/read-only-diff-review.md; followed READ-ONLY procedure)

STATUS: done

KEEP PRODUCT:
- `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js` — Wave 9 + 9b API-key card redesign, masked-flag correctness fix, fixed 8-bullet mask, per-credential bordered card, one right rail, deduped budget, aligned rate inputs, unambiguous dates. Required product diff.
- `src/shared/components/Sidebar.js` — Wave 9 grouped sidebar navigation (WORKSPACE / MONITOR / TOOLS / SYSTEM). Required product diff, owned by worker B.
- `tests/unit/api-key-visibility-guidance.test.js` — 1-line source-contract update pinning the new `keyMaskView(key.key, keysMasked, visibleKeys.has(key.id))` helper; without it the committed source fails this existing test. This is the only test file that must ship with the product diff.

KEEP RECORDS:
- `.loop/state.md` — Wave 9 / 9b / 10 orchestration record + verification summary + active-auto-loop note. Commit with loop evidence, or leave uncommitted only if lead prefers state out of history (it is already tracked and the W9 sections are the only delta).
- `.loop/tasks/A-keys-ui.result.md` — worker A result (masking correctness + readability).
- `.loop/tasks/B-sidebar-groups.result.md` — worker B result (sidebar grouping).
- `.loop/tasks/C-keys-card.result.md` — worker C result (card redesign, browser numbers, screenshot path).
- Not present yet but referenced by `.loop/state.md`: `.loop/tasks/W9-final-review.review.md` and `.loop/tasks/T8-deploy-readiness.result.md` do NOT exist on disk at audit time. Do not commit phantom paths; either wait for those workers or state in the record that they were not produced.

DISCARD/RESTORE:
- `.loop/scratch/dev.log` — RESTORE from HEAD. Tracked dev-server log; HEAD has 2719 lines, worktree only 175. Truncated/replaced during local dev, not a product change. Recommended (NOT executed): `git checkout HEAD -- .loop/scratch/dev.log`. Also add `.loop/scratch/` to `.gitignore` in a follow-up so future logs are never tracked; current `.gitignore` only has `.scratch/` (line 104), which does NOT cover `.loop/scratch`.
- `.loop/scratch/cj.txt` — DISCARD, never commit. Netscape cookie jar containing a live `auth_token` session cookie [REDACTED]. Secret-bearing local auth artifact.
- `.loop/scratch/c-keys-browser.mjs` — DISCARD from commit. Browser probe contains a hardcoded local dev password [REDACTED] and reads the auth cookie [REDACTED]. Retain locally only if lead wants a rerunnable probe; scrub credentials first.
- `.loop/scratch/a-keys-check.mjs`, `.loop/scratch/b-sidebar-check.mjs`, `.loop/scratch/c-keys-check.mjs` — DISCARD from commit. Source-text self-checks with fixed example `sk-…` strings [REDACTED] and no framework; they are worker evidence, not part of the committed suite.
- `.loop/scratch/a-keys-build.log`, `.loop/scratch/b-sidebar-build.log`, `.loop/scratch/c-keys-build.log` — DISCARD. Build output logs.
- `.loop/scratch/c-keys-card.png`, `.loop/scratch/keys-card.png` — DISCARD. Screenshots referenced as evidence in result artifacts; keep on disk, not in git.
- `.loop/scratch/audit-status.txt` — DISCARD. Temporary audit status dump produced by another worker.
- `.loop/scratch/ghcr-tags.json` — DISCARD. Registry tag list from an unrelated deploy-readiness task; non-secret but ephemeral.
- `.loop/scratch/watch_wave10.py` — DISCARD. Orchestrator polling helper, ephemeral.
- `.loop/tasks/C-keys-card.dispatch.md`, `.loop/tasks/T8-deploy-readiness.dispatch.md`, `.loop/tasks/W9-final-review.dispatch.md`, `.loop/tasks/W9-hygiene-audit.dispatch.md` — DISCARD. Task dispatch prompts/instructions, not results; no release value.
- `.loop/tasks/W9-hygiene-audit.result.md` — this artifact; leave uncommitted until lead decides, or commit with loop evidence if desired.

SECRET SCAN: PASS (for proposed product + record commit set); FAIL for the untracked scratch set if `git add -A` were used.

Redacted evidence (values never echoed):
- `.loop/scratch/cj.txt:5` — live Netscape cookie jar line, `auth_token` value [REDACTED]. DO NOT COMMIT.
- `.loop/scratch/c-keys-browser.mjs:9,12,13` — local dev password [REDACTED] in POST body; `set-cookie` header read; `auth_token` regex [REDACTED]. DO NOT COMMIT.
- `.loop/tasks/C-keys-card.dispatch.md:130` — dispatch instruction quoting `cdp('Network.setCookie', name='auth_token', value=[REDACTED] …)`. Instruction text only, not a live value; still a dispatch artifact, do not commit.
- `.loop/scratch/a-keys-check.mjs:29,33,35` — synthetic `sk-…` sample keys [REDACTED] used as assertions; not credentials.
- Product diff added lines: 0 hardcoded secrets; only prop name `apiKey={key}`, label `Tokens per minute`, aria-label. No raw token/password/cookie values.
- `git ls-files | grep -E '\.(env|pem|key|db|sqlite)$|cookie'` → only source/test files with `cookie` in their path (OAuth cookie route + cookie tests); no secret files.

COMMIT PLAN:

Option A (recommended — two slices, explicit pathspecs, no execution):

1) Product (frontend + its test):
```
git add src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js src/shared/components/Sidebar.js tests/unit/api-key-visibility-guidance.test.js
git commit -m "fix(dashboard): redesign API key credentials and group sidebar navigation" -m "Co-Authored-By: Claude Code <[REDACTED_EMAIL]>"
```

2) Loop evidence/state (only after restoring dev.log):
```
git checkout HEAD -- .loop/scratch/dev.log
git add .loop/state.md .loop/tasks/A-keys-ui.result.md .loop/tasks/B-sidebar-groups.result.md .loop/tasks/C-keys-card.result.md
git commit -m "docs(loop): record wave 9 API key redesign verification and state" -m "Co-Authored-By: Claude Code <[REDACTED_EMAIL]>"
```
Leave every other `.loop/scratch/**` file and every `*.dispatch.md` untracked. Do NOT use `git add -A`.

Option B (safer if lead wants minimal history): commit only the product slice above, leave all `.loop/**` evidence uncommitted locally, restore `dev.log`. Avoids committing orchestration state but loses the audit trail.

EVIDENCE:
- `git status --porcelain=v1 -uall`: 5 modified + 20 untracked paths (full list enumerated in sections above).
- `git diff --stat`: `.loop/scratch/dev.log | 2868 ++------------------`, `.loop/state.md | 54 +`, `EndpointPageClient.js | 436 +--`, `Sidebar.js | 107 +--`, `tests/unit/api-key-visibility-guidance.test.js | 2 +-`; 546 insertions, 2921 deletions.
- `git diff --numstat`: dev.log 162/2706, state.md 54/0, EndpointPageClient 262/174, Sidebar 67/40, test 1/1.
- `git diff --check` → exit 0 (no whitespace errors).
- dev.log: HEAD 2719 lines, worktree 175 lines; worktree content is NOT a prefix of HEAD → replaced, not appended; restore recommended.
- `.gitignore`: line 104 `.scratch/` only; `git check-ignore -v .loop/scratch/dev.log .loop/scratch/cj.txt .loop/scratch/c-keys-card.png .loop/scratch/a-keys-check.mjs` → no matches (all unignored).
- `git diff -- tests/unit/api-key-visibility-guidance.test.js`: one assertion changed from `maskKey(key.key)` ternary to `keyMaskView(key.key, keysMasked, visibleKeys.has(key.id))`; matches committed implementation.
- Product diff added lines contain 0 `fetch(` / `/api/` calls; no API rewiring (presentation + mask fix only).
- `git ls-files .loop/scratch` → `.loop/scratch/dev.log` only tracked scratch file.
- `.loop/tasks/W9-final-review.review.md` and `.loop/tasks/T8-deploy-readiness.result.md` — `ls` reports "No such file or directory" (referenced in state.md but not produced at audit time).
- Secret scan: Node scan over every dirty path, 8 pattern classes (hardcoded secret assignments, bearer, JWT, `sk-…`, cookie jar, set-cookie). Findings classified above; proposed commit set clean, scratch set contains live session cookie.

NOTES:
- READ-ONLY audit: no cleanup, restore, stage, commit, push, deploy, or process kill was performed. All commands were inspection only; the only file written is this artifact, inside `.loop/tasks/`.
- No permission dialogs appeared; all paths stayed inside the workspace.
- `verify123` is the documented local dev `INITIAL_PASSWORD` from the dispatch, not a production credential; still redacted and must not enter the commit.
- Self-check scripts are source-text contract tests; per the loaded skill's `static-source-contract-tests` guidance they are not a substitute for the committed unit test, which is why only `tests/unit/api-key-visibility-guidance.test.js` is in the product commit.
- Commit messages above are recommendations only; no commit was created, so no attribution footer was applied to history.
