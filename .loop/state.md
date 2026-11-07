# 9Router transform-pipeline — loop state

Branch: feat/transform-pipeline

## Committed (chronological)
- 114ed847  Fase 1  custom pipeline modules (self) — tokenMeter, whitelist, transform guards, toolcall repair, cache-aware routing + 1 chatCore hook
- 1b6e70a8  Fase 2  per-key monthly budget backend (self) — schema v4, apiKeysRepo, gate+attribution in chat.js/usageRepo, 16 tests
- 62a1efdc  T7  budget dashboard UI (worker-t5-ui) — updateApiKey persist, PUT /api/keys/[id], reset-budget route, EndpointPageClient
- 5f645033  T8/T9  semantic cache + idempotency MODULES (worker fan-out) — 43 tests, pure storage/lookup layers, no wiring
- 2bdeae30  T10  complexity classifier (worker-t5-ui) + pipeline wiring + fork-schema stale-test fix (v3->v4) — 20 tests

## Verification baseline (as of 2bdeae30)
- Own modules: 132/132 unit suites green (fork-schema v4, custom-pipeline, budget, idempotency, semantic, complexity, T5 health-dashboard)
- Full suite: remaining failures are all documented known-fails (golden-url-header,
  combo-credit-fallback, headroom-responses, oauth-cursor, translator-normalization,
  security-audit, etc.) — confirmed pre-existing at HEAD via git stash. No new regressions.
- eslint clean on all touched custom files; build exit 0.

## Roadmap status
DONE (modules + tests, wired where safe):
  - per-key monthly budget (backend + dashboard)
  - complexity routing classifier (wired into pipeline as diagnostic; pickRouteTier ready)
  - semantic cache module (fingerprint + LRU/TTL store) — READY, not yet wired to serve
  - idempotency module (claim/complete/seq/conflict) — READY, not yet wired to serve

OPEN (needs request-path seam work, higher risk, deferred):
  - serve semantic cache: capture upstream SSE, serialize, replay on cache hit
    (complex: must match client wire format + stream semantics)
  - idempotency serve: capture completed SSE, replay on same-key same-digest retry
  - RTK/Caveman/Ponytail native wiring into request path (modules exist, integration pending)

## Orchestration notes
- worker panes: worker-t5-ui (w1A:p2), worker-t5-test (w1A:p3)
- dispatch via `herdr pane run <pane_id> <text>`; poll `herdr agent wait --timeout`
- worker result artifacts in .loop/tasks/T*.result.md; dispatch files deleted after wave
