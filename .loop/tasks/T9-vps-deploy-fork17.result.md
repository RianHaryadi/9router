SKILLS LOADED: `remote-host-access-management` (Hermes Brain, v1.0.0) — Rules 0/1/2/3/6 (host classification, `IdentitiesOnly`, alias verify, capacity) + Production container deployment section (build/push/pull/recreate as separate gates; Coolify stored-compose source of truth via Eloquent + `instant_remote_write_file`; `--no-deps --pull never` recreate; sibling ID comparison; mandatory post-recreate patch; rollback discipline) + `references/coolify-service-deploy.md` (read the image pin out of ALL THREE compose copies; Eloquent update with `substr_count` assertions; authenticated smoke without leaking the credential; minified-bundle marker verification; live-DB count deltas are traffic, not corruption).

STATUS: **done** — fork.17 deployed live on vps-kantor, all gates passed, no rollback.

---

TARGET

| Item | Value |
|---|---|
| SSH alias | `vps-kantor` → `72.61.141.230:22`, user `root`, key `~/.ssh/id_ed25519_growvia` |
| Identity (real connect) | `hostname=srv1648533`, `whoami=root` ✓ |
| Service UUID | `dwdbsvhv321uo2u42bzbnpsn` (Coolify `services.id=27`) |
| Container | `9router-dwdbsvhv321uo2u42bzbnpsn` (only) |
| Workdir | `/data/coolify/services/dwdbsvhv321uo2u42bzbnpsn/` |

WHY fork.17

`GET /api/keys` only returned raw key values to a LOCAL request, so the owner opening the dashboard at `9router.aidonext.com` saw every key masked with the eye and copy buttons disabled. Two security bugs were found and fixed at the same time:

1. `GET /api/keys/[id]` returned the RAW key value to any caller — a teammate holding the "Endpoint & Keys" area could read every key value one by one.
2. `GET /api/keys` returned raw values to a member session even from the host.

BEFORE

- Container `7f8416bf539f` — image `teamdevfotre/9router:0.5.119-fork.16`, ImageID `sha256:f50d38ec…`, Up 5 hours.
- Sibling `headroom-dwdbsvhv321uo2u42bzbnpsn` = ID `9bf20abd3bdc`, Up 9 days (healthy).
- Running container count: **46** (before and after — no collateral).
- Capacity: disk `/` 96G, 35G avail; mem 7.8Gi total / 3.2Gi available; swap 6.0Gi; 2 vCPU. 46 containers — shared production box, untouched beyond scope.
- DB live baseline: `schemaVersion=12`, `backupSchemaVersion=12`, `appVersion=0.5.119-fork.16`, `quick_check=ok`, live sha256 `0cd6134599ea33bb…`.
- Counts BEFORE: apiKeys 8, providerConnections 33, combos 7, teamMembers 2, promptTemplates 0, usageDaily 26, proxyPools 0, usageHistory 45605, fallbackEvents 3073, totalRequestsLifetime 45605.

COMMIT / IMAGE

- Commit `7594813efbd82b42847280cf08156514bc393e44` "fix(keys): the owner may reveal a key value remotely, a teammate never can" (parent `de6f3337`). Version bumped to `0.5.119-fork.17` in `package.json` + `cli/package.json`.
- Also in that commit: `.loop` added to `.dockerignore` (the fork.16 publish had orchestration files inside the build context; the published image was still clean, but the context no longer carries them).
- `docker buildx build --platform linux/amd64 --build-arg APP_VERSION=0.5.119-fork.17 -t teamdevfotre/9router:0.5.119-fork.17 .` → exit 0.
- Index digest `sha256:e86c37e912643069a7cf2adf1e28b7acc2de74380265b09141f3f20b3730e07d`; amd64 manifest `sha256:bdc84a6363…`; config `sha256:4fbe65f520…`; attestation `sha256:13aef08c15…`.
- `docker push` → digest `sha256:e86c37e9…` (matches the build output exactly).
- Registry read-back: `docker buildx imagetools inspect` → `Digest: sha256:e86c37e9…`, `Platform: linux/amd64`, attestation manifest present.
- `docker pull` on the VPS → `Digest: sha256:e86c37e9…`, `RepoDigests=[teamdevfotre/9router@sha256:e86c37e9…]`, `Arch=amd64`, version label `0.5.119-fork.17`.

LOCAL SMOKE (before push)

- Throwaway container on `127.0.0.1:21129` + a LAN-IP path (`192.168.1.24:21129`) to exercise the REMOTE branch (a published Docker port is a bridge peer, so even `127.0.0.1` on the host is NOT a loopback peer).
- Remote list → `masked=true`, value `sk-82261***60e6`.
- Remote `GET /api/keys/<id>` → masked, no raw value.
- Remote reveal, wrong password → 401 `{"error":"Invalid password"}`.
- Remote reveal, correct password → 200 with the raw value.
- `GET /api/health` → 200 `{"ok":true}`; runtime version `0.5.119-fork.17`.
- Container removed; temp data dir removed.

SOURCE-OF-TRUTH UPDATE

- Read the image line out of ALL THREE copies BEFORE editing — this time there was **no drift**: `docker_compose_raw` line 4, `docker_compose` line 3 and the workdir compose line 3 all already said `fork.16`.
- Update executed through Coolify's own **Eloquent model** (`App\Models\Service::find(27)`, `->save()`), then Coolify's own writer `instant_remote_write_file($service->server, $service->workdir().'/docker-compose.yml', $service->docker_compose)` synced the workdir compose **without** regenerating `.env` (`.env` mtime Nov 13, 7 lines, unchanged).
- The updater asserted exactly ONE occurrence of the old pin in each field and that the length delta equalled the tag-length delta, then read the model back.
- Readback: `raw_17=1 raw_16=0 parsed_17=1 parsed_16=0 rawlen=828 parsedlen=6875` (lengths preserved).
- Workdir compose readback: line 3 `image: 'teamdevfotre/9router:0.5.119-fork.17'`, line 90 headroom pin unchanged.
- `docker compose config --images` → `teamdevfotre/9router:0.5.119-fork.17` + `ghcr.io/headroomlabs-ai/headroom:code` ✓.
- Timestamped copy of the previous workdir compose: `docker-compose.yml.bak-before-fork17-20261122T163649Z`.
- Temporary PHP updater removed from the host `/tmp` and from inside the `coolify` container (verified gone).
- Note: the updater had to `require __DIR__.'/vendor/autoload.php'` + bootstrap `bootstrap/app.php` from `/var/www/html` — a script run from `/tmp` cannot resolve `App\Models\Service` (the Laravel app is not autoloaded outside its own root).

DEPLOY

- `docker compose up -d --no-deps --pull never 9router` (no `down`, no `--pull`, no other service) → `Recreated` / `Started`.
- New container ID `28264f6b7b81`, `Config.Image=teamdevfotre/9router:0.5.119-fork.17`, `Image=sha256:e86c37e9…` ✓, status Up.
- Mounts and ports preserved exactly (`…/data → /app/data` rw, `…/config.yaml` ro, `20128 → 20128`).

PATCH

- Mandatory idempotent patch executed: `sh /data/coolify/services/dwdbsvhv321uo2u42bzbnpsn/patch-9router-thinking.sh` → **exit 0**, "patch + restart done".
- Container ID unchanged after the patch (`28264f6b7b81`), confirming the script restarted rather than recreated the container.

DB BEFORE-AFTER

| Table | BEFORE | AFTER | Δ |
|---|---|---|---|
| apiKeys | 8 | 8 | 0 |
| providerConnections | 33 | 33 | 0 |
| combos | 7 | 7 | 0 |
| teamMembers | 2 | 2 | 0 |
| promptTemplates | 0 | 0 | 0 |
| usageDaily | 26 | 26 | 0 |
| proxyPools | 0 | 0 | 0 |
| usageHistory | 45605 | 45674 | **+69** |
| fallbackEvents | 3073 | 3073 | 0 |

- `_meta`: `schemaVersion=12` (unchanged ✓ — no migration), `backupSchemaVersion=12`, `appVersion=0.5.119-fork.16 → 0.5.119-fork.17` ✓.
- `totalRequestsLifetime` 45605 → 45674 (+69).
- `PRAGMA quick_check` → **ok** after deploy.
- **Delta explanation (not hidden):** usageHistory +69 is live production traffic — the boot log shows headroom token-delta warnings for real 169KB–582KB request bodies within the first 30s. No rows were rewritten; every configuration table is bit-identical and `schemaVersion` did not move. No DB restore was performed (correct — the app did not fail).

BACKUP

- Pre-deploy backup: `/data/coolify/services/dwdbsvhv321uo2u42bzbnpsn/data/db/backups/predeploy-v0.5.119-fork.17-20261122-163409/data.sqlite` — 37,879,808 B, sha256 `e36565adcf0b91ce002e6a1b5276e64ff8b18209582755fba53fd26f2806f8cb`, `quick_check=ok`, counts apiKeys 8 / providerConnections 33 (identical to live). **Not modified, not restored.**
- Rollback images fork.16 (`sha256:f50d38ec…`) and fork.15 (`sha256:9e704d45…`) still present locally on the VPS.

SMOKE (production, remote path)

- Public, no auth: `GET http://9router.aidonext.com:20128/login` → **200**; `/api/health` → **200** `{"ok":true}`.
- Authenticated smoke (password obtained transiently **inside** the container env via `docker exec … node -e`, JSON body built with `JSON.stringify`, written to a temp file inside the container, `docker cp`d out, `curl --data-binary @file`; cookie jar via `mktemp`; password/cookie never printed):
  - `POST /api/auth/login` → **200** `{"success":true,"mustChangePassword":false,"role":"owner"}`.
  - `GET /api/keys` (through the public domain = remote path) → `masked= true`, value `sk-12d7a***03af`.
  - `GET /api/keys/<id>` (remote) → masked value, no raw value ✓ (the old leak is closed).
  - `POST /api/keys/<id>/reveal` with a wrong password → **401** `{"error":"Invalid password"}`.
  - `POST /api/keys/<id>/reveal` with the correct dashboard password → **200** with the raw value (redacted in this artifact).
- Deployed-bundle markers (minified build, so the COMPILED form is checked):
  - `Reveal API Key` present in `/app/.next/static/chunks/1884-96c9a6d087ce0879.js` and `/app/.next/server/chunks/556.js`.
  - `Key values are never shown to a teammate` present in the same two chunks.
  - `{"x-9r-password":t}` present in the client bundle (the reveal call).
  - Route directory `/app/.next/server/app/api/keys/[id]/reveal/route.js` present.
- Boot log clean: `▲ Next.js 16.4.6 ✓ Ready`, `[DB] Driver: better-sqlite3 | file: /app/data/db/data.sqlite`. Error-pattern count over the deploy window → **0** (no migration lines, no error loop, no fatal/unhandled). Only benign warnings: MODULE_TYPELESS_PACKAGE_JSON notice (pre-existing) and the headroom token-delta telemetry (pre-existing, non-fatal).
- Runtime version inside the container: `require('/app/package.json').version` → **0.5.119-fork.17** ✓.

SIBLING INVARIANTS

| Container | ID BEFORE | ID AFTER | Status |
|---|---|---|---|
| `headroom-dwdbsvhv321uo2u42bzbnpsn` | `9bf20abd3bdc` | `9bf20abd3bdc` | Up 9 days (healthy) — **unchanged** |
| `9router-dwdbsvhv321uo2u42bzbnpsn` | `7f8416bf539f` | `28264f6b7b81` | Up, fork.17 (intended change) |

- Total running containers 46 → 46. No sibling container was recreated, restarted, or removed. No compose `down`. No prune, no package install, no firewall change, no secret read/print, no data content edited.

ROLLBACK STATUS

- **Not needed and not triggered.** No digest mismatch, no unhealthy service, no auth-smoke failure, no DB quick_check failure, no missing mount, no sibling restart, no patch failure.

GIT

- Branch `sync/upstream-20261112` and tag `v0.5.119-fork.17` pushed to `origin` (RianHaryadi/9router). Remote branch head = `7594813efbd82b42847280cf08156514bc393e44`.

NOTES

- Only the 9router service was touched. `headroom` sibling, the other 44 containers, Coolify itself, postgres/redis and the host OS were not modified.
- The published image tag is Docker Hub `teamdevfotre/9router` — the registry production actually uses. GHCR was not used.
- Port 20128 serves plain HTTP by design of the current deployment (pre-existing; unchanged).
