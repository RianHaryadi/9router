SKILLS LOADED: design-system-implementation

STATUS: done

FILES CHANGED:
- `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`
- `.loop/scratch/c-keys-check.mjs` (self-check, extended)
- `.loop/scratch/c-keys-browser.mjs` (browser probe, extended)
- `.loop/scratch/c-keys-build.log` (build log)
- `.loop/scratch/c-keys-card.png` (screenshot)

SUMMARY:
Each API credential now renders as its own bordered card (`rounded-xl border-2 border-ink bg-surface-2 p-4`),
one card per key, instead of five flat stacked groups sharing one hairline list.
The mask is FIXED length: `first 6 + 8 bullets + last 4` (18 chars total) for every key, so a 40-char key
and a 12-char key render the same chip width; the server-masked form (`sk-12d7a***03af`) is normalised
to the SAME bullet style — one mask style only. The real secret stays hidden and the chip keeps `select-all`.
Header: `CREDENTIAL` label, key name, `Created Oct 27, 2026` (one helper, `KEY_DATE_OPTIONS =
{month:'short',day:'numeric',year:'numeric'}`), and ONE right rail holding the status toggle,
an explicit `Enabled`/`Paused` state chip, and the always-visible trash button (`h-9 w-9`, `border-2
border-ink bg-bg`, danger colour, `title` + `aria-label`). The duplicate `Active` word was removed —
only one state label remains, so the card no longer says Active and Enabled at once.
Body: key chip row (chip + eye + copy + masked note), then a `sm:grid-cols-2` grid — left column ACCESS
(existing `KeyAccessControls` untouched), right column RATE LIMITS stacked over BUDGET.
Rate-limit rows put the label ABOVE the input so the two inputs share one baseline; both keep their own
`0 = unlimited` helper and their own Save button (they save different fields).
Budget: ONE unlimited control (`Unlimited budget` checkbox), the spend meter only renders when a limit
exists, the amount field carries a `$` prefix, Save + Reset spend kept.
The wave-9 masked-flag fix stays intact: the server `masked` flag is kept, reveal/copy are disabled in a
masked session with the reason in `title`/`aria-label` plus a visible note; a local session keeps them
enabled.

EVIDENCE:
eslint owned-file: `npx eslint "src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js" src/shared/components/Sidebar.js`
  → 7 problems (5 errors, 2 warnings) in EndpointPageClient.js, Sidebar.js 0 issues.
  Counts are the PRE-EXISTING baseline (proven upstream at v0.5.119: 5 errors + 2 warnings on the same
  file). Zero new errors/warnings introduced by this work; the pre-existing ones were not "fixed".
  Rules: react-hooks/immutability (3x), react-hooks/set-state-in-effect (2x), react-hooks/exhaustive-deps (2x).

build: `npm run build` → BUILD EXIT: 0 (Next.js 16.4.5 webpack, compiled successfully, 156/156 static
  pages, postbuild standalone-assets copy completed). Log: .loop/scratch/c-keys-build.log

self-check: `node .loop/scratch/c-keys-check.mjs` → exit 0
  PASS: 40-char key -> first 6 + exactly 8 bullets + last 4 (length 18)
  PASS: server-masked sk-12d7a***03af -> same fixed-bullet style as local mask
  PASS: masked session -> reveal/copy disabled + note; local session -> enabled
  PASS: dates via one helper, options {month:'short',day:'numeric',year:'numeric'} -> Oct 27, 2026 / Nov 3, 2026
  PASS: structural checks (credential card, explicit state, delete affordance, budget dedupe, separate saves)

browser: `node .loop/scratch/c-keys-browser.mjs` (playwright-core + system chromium, logged in via
  POST /api/auth/login, cookie auth_token) → exit 0
  1400x1000: cards=4 chips=["sk-12d••••••••03af","sk-0d1••••••••25bf","sk-0d1••••••••3657","sk-0d1••••••••39f0"]
             chipLen=18 (constant) scrollWidth=1400 clientWidth=1400 (NO horizontal overflow)
             cardBorders=[border 2px, radius 12px, bg rgb(244,240,231)] x4
             railRightEdges=[{edges:[1204,1320],heights:[24,36],lastRight:1320,cardRight:1322}] x4
             rpmLeft=[836,836,836,836] tpmLeft=[836,836,836,836] (rate inputs aligned on one baseline)
  390x844:   cards=4 chipLen=18 scrollWidth=390 clientWidth=390 (NO horizontal overflow)
             railRightEdges=[{edges:[210,326],heights:[24,36],lastRight:326,cardRight:328}] x4
             rpmLeft=[64,64,64,64] tpmLeft=[64,64,64,64]
  Trashed button right edge is flush with the card content edge (1320 vs 1322, 326 vs 328) and all
  header controls share one rail with >=8px separation and a consistent height band (toggle 24px,
  trash 36px, both inside the h-9 control row).
  screenshot: .loop/scratch/c-keys-card.png
  Visual re-review of the screenshot: `Enabled` now renders as a pale-green bordered chip next to the
  toggle, trash button is always visible with an outline, no duplicate Active/Enabled wording.

NOTES:
Assumption: `masked` is a per-API-response flag (as `GET /api/keys` implements it), not per key — the
client keeps the flag for the whole list, which is how the endpoint already behaves.
The `Toggle` component exposes `sm|md|lg` sizes only; the status toggle keeps `md` (24px track) inside
an `h-9` control row so the state chip and trash button share the row baseline. The ACCESS toggle inside
`KeyAccessControls` is owned by another file and keeps its own `sm` size — untouched, as instructed.
- fixed-length-mask: DONE
- credential-card: DONE
- explicit-status-state: DONE
- always-visible-delete: DONE
- budget-dedupe+currency: DONE
- aligned-rate-inputs: DONE
- unambiguous-date: DONE
- one-right-rail: DONE
- masked-flag-fix-intact: DONE
