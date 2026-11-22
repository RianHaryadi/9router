# T7 — Dashboard UI: per-key monthly budget (worker-t5-ui)

Repo: /home/kennyh/Documents/9router
Branch: feat/transform-pipeline (HEAD 1b6e70a8 — Fase 2 budget committed)
Pane: worker-t5-ui (opencode, idle)

## Situation (Fase 2 already shipped, backend budget enforcement LIVE)

A per-key MONTHLY budget gate + attribution was implemented and committed in 1b6e70a8.
Backend already works end-to-end. It is just not reachable from the dashboard yet —
there is NO UI to set or view a key's budget. Your job: wire the existing columns/methods
into the API + dashboard, so an admin can set/see a key's monthly limit.

### Already in place (DO NOT re-implement)
- Schema (src/lib/db/schema.js, SCHEMA_VERSION=4): apiKeys columns
  budgetLimitCents INTEGER DEFAULT NULL, budgetPeriod TEXT DEFAULT 'monthly',
  budgetStartedAt TEXT, budgetSpentCents INTEGER DEFAULT 0. All additive, auto-synced.
- src/lib/db/repos/apiKeysRepo.js:
  - rowToKey() already maps: budgetLimitCents (null=unlimited), budgetPeriod ('monthly'),
    budgetStartedAt, budgetSpentCents.
  - getApiKeyBudget(key) — read-only budget row for a presented key.
  - applyBudgetSpend(key, costCents, opts) — atomic UPDATE budgetSpentCents += cost.
  - resetBudgetSpend(key, startedAt) — sets Spent=0 and StartedAt=new ISO.
- Gate: src/sse/handlers/chat.js — pre-flight 402 when spent >= limit (cost=0), one-time
  30-day rollover reset, 80% warn. Fail-open.
- Attribution: src/lib/db/repos/usageRepo.js saveRequestUsage() — after insert, when the row
  has an apiKey and cost>0, calls applyBudgetSpend(key, round(cost*100)).

### Budget semantics (match this exactly)
- budgetLimitCents NULL  = unlimited (gate skips).
- budgetLimitCents 0     = key disabled immediately (spend 0 >= limit 0).
- Gate denies when spent + cost >= limit. Actual cost attributed AFTER response, so the
  counter lags by up to one request. UI should show Spent/Remaining from the DB row.
- Period is 'monthly' only right now; keep the column but the UI may hardcode 'monthly'.

## What to build

### 1. updateApiKey must persist budget fields
In src/lib/db/repos/apiKeysRepo.js, updateApiKey(id, data) currently does a fixed-column
UPDATE (key,name,machineId,isActive,accessRestricted,accessAllow). Extend the UPDATE to also
write: budgetLimitCents, budgetPeriod, budgetStartedAt, budgetSpentCents. Values come from the
merged row (data may override). On write:
- budgetLimitCents: coerce undefined->current; null literal must stay NULL (unlimited).
- When budgetLimitCents transitions from NULL (unlimited) to a finite number, initialize
  budgetStartedAt (if NULL) to now; keep budgetSpentCents as-is.
- Do NOT let the client set budgetSpentCents directly during normal edits (bump only via
  usageRepo attribution); to preserve the "reset" action, allow resetBudgetSpend separately via
  API (below). Simpler contract: updateApiKey accepts budgetLimitCents + budgetPeriod only, and
  ignores budgetSpentCents/budgetStartedAt writes from the client. If you need a "reset spend"
  dashboard button, add a dedicated repo call resetBudgetSpend (already exists) wired to a small
  endpoint action — see #3.

### 2. PUT /api/keys/[id] (src/app/api/keys/[id]/route.js)
Accept `budgetLimitCents` and `budgetPeriod` in body alongside isActive/access:
- budgetLimitCents: accept number>=0 OR null (= unlimited). Reject negative with 400.
- budgetPeriod: accept only 'monthly' (or undefined); else 400.
- Pass through to updateApiKey. Return updated key as { key }.
Keep existing isActive/access behavior untouched.

### 3. Dashboard UI — src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js
This is the page that lists API keys (creates via POST /api/keys, edits via PUT /api/keys/[id],
deletes DELETE). Extend the key management UI:
- For each listed key show (when the API response carries them): budget limit (formatted),
  spent, remaining, used % with a thin progress bar.
- Allow editing the monthly limit per key: an input (integer USD dollars or cents — pick ONE and
  label clearly; recommend an input in dollars with a "unlimited" checkbox, converting USD->cents
  on submit) + a save action that PUTs budgetLimitCents + budgetPeriod 'monthly'.
- A "Reset spend" action that calls resetBudgetSpend via a small endpoint (add POST
  /api/keys/[id]/reset-budget if not present) so admins can zero the counter mid-month.
- Keep existing create/delete/edit UI working; do not regress it.

NOTE the page is a Client component in plain .js (repo forbids .jsx). Use the existing style,
Tailwind classes, and data-fetch patterns already in the file. Read the whole file first.

### 4. GET /api/keys — confirm it returns budget fields
src/app/api/keys/route.js list should already include budget from rowToKey; verify and if the
client needs a normalized shape (e.g. budgetLimitDollars) expose what's convenient but preserve
raw cents too.

## Constraints
- ONLY touch: src/lib/db/repos/apiKeysRepo.js, src/app/api/keys/[id]/route.js,
  src/app/api/keys/route.js (only if a shape tweak is needed), src/app/api/keys/[id]/reset-budget/route.js (new),
  src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js.
- .js ONLY, never .jsx. ESM. Match existing style/conventions in each file.
- Never log or render the raw API key secret — use the existing masked form the page already shows.
- Do NOT touch: src/custom/**, chat.js, usageRepo.js, schema.js (already correct), tests/,
  open-sse/**, .loop/**. The gate + attribution are DONE; don't change their behavior.
- Do not commit. Do not stage. Just leave the working tree with your edits.
- Validate budgetLimitCents at the trust boundary (API route), not just the UI.

## Verify (run, capture real output)
- cd /home/kennyh/Documents/9router && npx eslint src/lib/db/repos/apiKeysRepo.js src/app/api/keys/[id]/route.js src/app/api/keys/route.js "src/app/api/keys/[id]/reset-budget/route.js" src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js
- cd /home/kennyh/Documents/9router && PATH=/home/kennyh/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH npm run build
- If the dev server is up at :20127, sanity-check GET /api/keys (curl) returns budget fields.

## Report (write .loop/tasks/T7-budget-ui.result.md)
  STATUS: done
  FILES CHANGED: <list>
  SUMMARY: <UI/API contract: how a limit is set, how reset works, edge cases>
  EVIDENCE: <exact eslint + build output, curl sample>
  NOTES: <anything blocked/assumed>
