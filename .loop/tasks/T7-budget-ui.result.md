STATUS: done
FILES CHANGED:
  - src/lib/db/repos/apiKeysRepo.js
  - src/app/api/keys/[id]/route.js
  - src/app/api/keys/[id]/reset-budget/route.js  (new)
  - src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js

SUMMARY:
  Wired the existing per-key monthly budget backend (Fase 2) into the API + dashboard.

  [1] updateApiKey persists budget fields:
      - UPDATE expanded: budgetLimitCents, budgetPeriod, budgetStartedAt, budgetSpentCents.
      - budgetLimitCents: undefined -> keep current; null literal -> stays NULL (unlimited); finite number kept.
      - Client cannot write budgetSpentCents/budgetStartedAt directly (server-owned). budgetSpentCents preserved from row.
      - unlimited->finite transition seeds budgetStartedAt = now if NULL.
      - budgetPeriod coerced to 'monthly'.

  [2] PUT /api/keys/[id]:
      - Accepts budgetLimitCents + budgetPeriod alongside isActive/access.
      - budgetLimitCents: integer >= 0 or null; negative/non-integer -> 400.
      - budgetPeriod: only 'monthly' (or undefined) -> else 400.
      - Returns updated { key }.

  [3] New POST /api/keys/[id]/reset-budget:
      - New repo method resetApiKeyBudgetById(id) (resets spend=0, startedAt=now, keyed by id).
      - Route verifies key exists, resets, returns { key }.

  [4] Dashboard EndpointPageClient.js (client .js):
      - Per listed key, shows monthly budget: limit (Unlimited or $ limit), spent, remaining, used % + thin progress bar.
      - Editor: USD dollar input + "Unlimited" checkbox -> converts USD->cents on save; PUT budgetLimitCents+budgetPeriod 'monthly'.
      - "Reset spend" button (shown when spent>0) -> POST reset-budget.
      - Existing create/delete/edit/toggle/access UI untouched; budget render added inside each key row.

  Budget semantics preserved (from dispatch): NULL=unlimited, 0=disabled, period hardcoded 'monthly'.

EVIDENCE:
  eslint (allowed files):
    $ cd /home/kennyh/Documents/9router && npx eslint src/lib/db/repos/apiKeysRepo.js "src/app/api/keys/[id]/route.js" src/app/api/keys/route.js "src/app/api/keys/[id]/reset-budget/route.js" "src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js"
    ESLint: 5 errors, 2 warnings in 1 files (EndpointPageClient.js)
    -> All 7 at pre-existing lines (86,103-105,115,123,777), verified IDENTICAL in committed HEAD via git stash. Zero new issues from this change.

  build:
    $ PATH=/home/kennyh/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH npm run build
    build exit: 0  (produced route table; postbuild standalone-assets copied)

  sanity (dev server :20127):
    $ curl -s -m 5 http://localhost:20127/api/keys
    {"error":"Unauthorized"}   (route live + session-gated; budget fields confirmed via rowToKey mapping in getApiKeys)

NOTES:
  - Did not modify src/lib/localDb.js or src/lib/db/index.js (out of allowed scope). The new reset-budget route imports resetApiKeyBudgetById directly from src/lib/db/repos/apiKeysRepo.js.
  - GET /api/keys already returns budget fields via rowToKey (budgetLimitCents, budgetPeriod, budgetStartedAt, budgetSpentCents) — no route.js shape change needed; client computes dollars.
  - The 7 eslint findings are pre-existing and outside this task's scope (dispatch forbids touching unrelated code); left as-is, verified not introduced by this change.
