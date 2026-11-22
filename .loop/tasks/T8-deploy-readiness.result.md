SKILLS LOADED: git-branch-operations (branch/remote/divergence verification), requesting-code-review (read-only diff review reference). `growvia-vps-access` NOT loaded — no VPS/SSH access was applicable to this read-only audit.

STATUS: done

CURRENT STATE (exact facts):
- Branch `sync/upstream-20261112`, HEAD `51c3b469`. **2 commits ahead of** `origin/sync/upstream-20261112` (origin ref = `1ed2ec9f`, per `git ls-remote`): unpushed `64480231` (owner spend/key/budget page) and `51c3b469` (tests green on Node 22). Local `master` is behind; upstream `decolua/9router` master (`1855aa44`, v0.5.119) has **6 commits NOT in HEAD** (synthetic.new provider, synthetic key /v2/quotas validation, MiniMax lease usage, xiaomi TokenPlan catalog, custom model type fix).
- Tags: `v0.5.119-fork.1` exists, points at `dc5e1378`, is an ancestor of HEAD; **HEAD is 25 commits ahead of the tag**.
- Versions: root `package.json` = `0.5.119-fork.16`, `cli/package.json` = `0.5.119-fork.16` (aligned — the T7 mismatch is fixed).
- Registry (anonymous pull-token query, no login): `ghcr.io/rianharyadi/9router` has exactly ONE tag: `0.5.119-fork.1`. `latest` → 404. **No image exists for the current version `0.5.119-fork.16` or for any of the 25 newer commits.**
- `docker-compose.yml:3` still pins `decolua/9router:latest` (UPSTREAM image) — a compose deploy today would run upstream, not the fork.
- Working tree dirty: 5 modified, 18 untracked.
  - **Wave 9/9b source (belongs in the commit):** `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js` (+436 lines changed), `src/shared/components/Sidebar.js` (grouping), `tests/unit/api-key-visibility-guidance.test.js` (contract update).
  - **Noise, never stage:** `.loop/scratch/dev.log` (modified), all 18 untracked files are `.loop/scratch/*` (build logs, check scripts, screenshots) and `.loop/tasks/*` dispatch/result artifacts.
  - **SECURITY: `.loop/scratch/cj.txt` is a Netscape cookie jar containing a live `auth_token` JWT session cookie.** `.loop/` is NOT in `.gitignore` (git check-ignore → NOT-IGNORED) and `.loop/` files ARE historically tracked (`state.md` committed in `b2759689`). One careless `git add -A` leaks the session token into history.
- DB: `SCHEMA_VERSION = 12` (`src/lib/db/schema.js:6`); migration chain versions 1,7,8,9,10,11,12 (`src/lib/db/migrations/001..007`). Upgrade path is automatic on boot: `runMigrationOnce` (`src/lib/db/migrate.js:216`) reads stored `schemaVersion`, takes a **pre-schema backup via `backupDbLite`** to `<DATA_DIR>/db/backups/schema-<old>-to-<new>-<slug>/` (migrate.js:237-238), then applies pending migrations in one transaction each. **No automated restore** — recovery is manual file copy (`src/lib/db/backup.js:1-6`).
- `.github/workflows/docker-publish.yml`: triggered by pushing a `v*` tag; validates tag == root pkg == cli pkg (else fails); fork repo publishes **GHCR only** (`publish_dockerhub` true only for `decolua/9router`, line ~117); versions containing `-` (all fork tags) are prereleases → **do NOT promote `latest`** unless workflow_dispatch with `promote_latest: true`.
- No Coolify config/docs anywhere in repo (grep coolify → 0 hits). Deploy surface is docker-compose/Dockerfile only.
- Pending Wave-10 artifacts not yet written: `.loop/tasks/W9-final-review.review.md`, `.loop/tasks/W9-hygiene-audit.result.md` (do not exist).

OPEN ITEMS (ordered checklist):
1. Collect W9-final-review + W9-hygiene-audit verdicts; dispatch fixes for any FAIL to owner panes (state.md Wave 10 flow).
2. **Never stage cj.txt.** Delete it or add `.loop/scratch/` to `.gitignore` before any commit (see SECURITY).
3. Commit Wave 9/9b with explicit paths ONLY:
   `git add "src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js" src/shared/components/Sidebar.js tests/unit/api-key-visibility-guidance.test.js`
   then `git status --short` to confirm the staged set. No `git add -A` ever in this repo while `.loop` is unignored.
4. Push branch: `git push origin sync/upstream-20261112` (2 local commits land).
5. Tag the release: root+cli already `0.5.119-fork.16` → `git tag v0.5.119-fork.16 && git push origin v0.5.119-fork.16` → docker-publish builds `ghcr.io/rianharyadi/9router:0.5.119-fork.16`. If `latest` is wanted on the VPS, also workflow_dispatch with `promote_latest: true`.
6. (Optional, separate sync task) Merge the 6 new upstream master commits.
7. Pre-deploy on VPS: confirm `.env` has `JWT_SECRET` and `INITIAL_PASSWORD` overridden (default `123456` must not reach production); update `docker-compose.yml` image → `ghcr.io/rianharyadi/9router:0.5.119-fork.16` (fork image, NOT `decolua/9router:latest`); note DATA_DIR volume `9router-data`.
8. Deploy: `docker compose pull && docker compose up -d`. First boot auto-migrates DB (schemaVersion → 12) and auto-creates the pre-schema backup under the volume's `db/backups/`. Capture that backup path from container logs (`[DB][migrate] pre-schema backup ...`) before proceeding.
9. Smoke checks: login to `/dashboard` (owner + a member account), `GET /api/health/matrix` 200, one `/v1/chat/completions` round-trip, sidebar shows WORKSPACE/MONITOR/TOOLS/SYSTEM groups.

DEPLOY GATE: **NOT READY.** Reasons:
- Wave 9/9b changes uncommitted; the release tag would silently exclude the key-UI/sidebar work the user asked for.
- No GHCR image exists for `0.5.119-fork.16`/HEAD (only fork.1, 25 commits old).
- `docker-compose.yml` still points at the upstream image — deploying it as-is ships the wrong product.
- Independent review artifacts (W9-final-review, W9-hygiene-audit) not yet produced; the state.md Wave-10 flow gates the commit on them.
- Live session cookie sitting in an unignored tracked-directory path (`cj.txt`) — a commit-scope accident waiting to happen.

ROLLBACK (exact steps, not executed):
1. Image: `docker compose down && docker compose up -d` with `image:` reverted to the previous working tag (e.g. `ghcr.io/rianharyadi/9router:0.5.119-fork.1`) — the volume `9router-data` is untouched.
2. DB: if the schema-12 migration corrupted state, stop the container, then manually copy the newest `db/backups/schema-<old>-to-12-*/data.sqlite` back over `<volume>/db/data.sqlite` (no automated restore path — backup.js:1-6). Start the container.
3. Git: revert the release tag is unnecessary (tags are immutable pointers); redeploy from the older image tag instead.

EVIDENCE:
- `git rev-list --left-right --count origin/sync/upstream-20261112...HEAD` → `0 2`; `git ls-remote --heads origin` → `1ed2ec9f` for this branch.
- `git log --oneline v0.5.119-fork.1..HEAD | wc -l` → 25.
- `git rev-list --count HEAD..1855aa44` (upstream master) → 6.
- `node -e "require('./package.json').version"` → `0.5.119-fork.16` (root and cli).
- GHCR anonymous: tags list → `{'tags': ['0.5.119-fork.1']}`; `GET manifests/latest` → 404; `manifests/0.5.119-fork.1` → 200.
- `SCHEMA_VERSION` src/lib/db/schema.js:6 = 12; migrations 001..007 versions 1,7,8,9,10,11,12; backup at src/lib/db/migrate.js:237-238; no-restore note src/lib/db/backup.js:1-6.
- `docker-compose.yml:3` → `image: decolua/9router:latest`.
- docker-publish.yml: pkg==tag validation lines ~88-96; `publish_dockerhub = REPOSITORY === "decolua/9router"` ~line 117; prerelease no-promote logic ~line 121.
- `.gitignore` has no `.loop` entry; `git check-ignore .loop/scratch/cj.txt` → NOT-IGNORED; cj.txt contains 1 `auth_token` JWT.
- Missing artifacts: `ls .loop/tasks/W9-final-review.review.md .loop/tasks/W9-hygiene-audit.result.md` → No such file.

NOTES:
- state.md STALE/WRONG items: (a) T8 line says "schema v3->v4" — actual schema is at version 12 with chain 1,7,8..12; there is no v3→v4 step in this codebase (schema.js:6, migrations/index.js). (b) T8 mentions "Coolify update" — zero Coolify config/docs exist in the repo; deploy surface is docker-compose only. (c) T8 mentions "image GHCR" — correct direction, but no image for the current version exists yet.
- Open roadmap items besides T8/Wave-9-commit: FU1 (golden-url-header 7 pre-existing fails), FU3, FU4 (upstream strictProxy network tests) — all non-blocking per state.md:106-109; plus the 6-commit upstream sync gap and the 2 unpushed local commits.
- Assumption: "T8 deployment" means a VPS docker-compose bring-up of the fork image; no Coolify/CI deploy target was found to audit. No production connection was made; GHCR queries used anonymous pull tokens only. Scratch files were confined to `/home/kennyh/Documents/9router/.loop/` per the permission policy.
