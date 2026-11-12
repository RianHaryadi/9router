STATUS: done
FILES CHANGED:
  - src/app/(dashboard)/dashboard/health/components/helpers.js
  - src/app/(dashboard)/dashboard/health/components/LatencyPanel.js
  - src/app/(dashboard)/dashboard/health/components/LatencyChart.js  (new)
  - src/app/(dashboard)/dashboard/health/components/ProjectsPanel.js
  - src/app/(dashboard)/dashboard/health/components/ProjectsChart.js  (new)
  - src/app/(dashboard)/dashboard/health/components/FallbacksPanel.js
  - src/app/(dashboard)/dashboard/health/components/HealthPanel.js

SUMMARY:
  Skills loaded (step 0):
    - hermes_skills_search("frontend React Next.js dashboard UI implementation") → design-system-implementation (match_score 17)
    - hermes_skill_get("design-system-implementation") → full skill loaded
    - hermes_memory_search → no prior memory hits
  Fixes applied per acceptance contract:

  [F1] helpers.js: Added missing DataState component. Renders loading spinner (role="status"), error alert (role="alert"), empty state, and passes through children. Exports all required helpers: formatPercentile, stateVariant, money, date, DataState.

  [F2] LatencyPanel.js + LatencyChart.js: Split recharts direct import into LatencyChart.js (BarChart with CartesianGrid/XAxis/YAxis/Tooltip/Bar). LatencyPanel now uses next/dynamic(() => import("./LatencyChart"), { ssr: false }). Removed row.model (providers response has no model field — contract mismatch). Added scope="col" to all th.

  [F3] ProjectsPanel.js + ProjectsChart.js: Same pattern as LatencyChart. Split recharts into ProjectsChart.js, lazy-loaded with ssr:false. Added scope="col" to th.

  [F4] FallbacksPanel.js: Full rewrite. Added proper error state (.catch → setError(true), not swallow). Added DataState wrapping with loading/error/empty. Added scope="col" to all th. Added aria-label to all filter inputs (provider/model/requestId/since — since filter was missing per acceptance #2 contract). Removed broken .catch(() => setData({})) error swallowing.

  [F5] HealthPanel.js: Added scope="col" to all 8 th elements.

EVIDENCE:
  $ cd /home/kennyh/Documents/9router && npx eslint "src/app/(dashboard)/dashboard/health"
  ESLint: No issues found

NOTES:
  - helpers.js:10-32 — DataState component added. role="status" for loading/empty, role="alert" for error per a11y contract §5.
  - helpers.js:6 — stateVariant("half-open") → "warning", matches Badge.js variant list.
  - LatencyPanel.js:4,8 — dynamic import ssr:false replaces direct recharts import; rectifies acceptance #4 violation.
  - LatencyPanel.js:48 — row.model removed. getProviderHealthSnapshot response has only {provider, requests, cost, avgLatencyMs, avgTtftMs, errors} per metricsRepo.js:146-153.
  - LatencyPanel.js:41-47 — scope="col" added to all th.
  - ProjectsPanel.js:3,7 — dynamic import ssr:false replaces direct recharts import.
  - ProjectsPanel.js:19-25 — scope="col" added to all th.
  - FallbacksPanel.js — scope="col" on th; aria-label on all 4 inputs; proper error state; since filter added per acceptance #2.
  - HealthPanel.js — scope="col" on all 8 th (line 12 in original, now fixed).
  - recharts only in LatencyChart.js and ProjectsChart.js; all panel .js files use dynamic() ssr:false.
