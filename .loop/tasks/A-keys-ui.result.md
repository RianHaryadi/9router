SKILLS LOADED: design-system-implementation

STATUS: done

FILES CHANGED:
- `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`
- `.loop/scratch/a-keys-check.mjs` (self-check)
- `.loop/scratch/a-keys-build.log` (build log)
- `.loop/tasks/A-keys-ui.result.md` (artifact)

SUMMARY:
Kept the API response's per-response `masked` flag in a new `keysMasked` state (also refreshed after auto-provisioning a default key).
Added pure mask helpers: server-masked values are normalized from `***` to the same `•` mask style used locally, and one `keyMaskView` decides display value, disabled affordances, and the note.
Server-masked keys now show a single clean masked chip, a short visible explanation, and disabled reveal/copy buttons with the explanation in `title`. Local keys retain reveal/copy exactly as before.
Key value moved to its own select-all, monospace, `text-sm` code chip with `whitespace-nowrap overflow-x-auto` (no `break-all`, no dim `text-xs` mush) and two separated 36px square icon buttons using the existing brand accent.
Each key is now a stack of five labelled sub-blocks with uppercase muted labels and hairline dividers: Key, Status, Access, Rate limits, Budget.
Status holds Created date, Paused badge, the existing Toggle and delete button (confirm flows unchanged). Rate limits are two separate grid columns with their own label, input, helper and Save. Budget keeps its progress bar, USD input, Unlimited checkbox, Save and Reset spend.
All handlers, API calls, `KeyAccessControls` usage, paused opacity and existing token vocabulary unchanged; no new dependencies, no raw hex colours, no new CSS.

EVIDENCE:
eslint owned-file: 5 error pre-existing (baseline sebelum edit: 5 error 2 warning), 0 error baru.
  Baseline (before edit), lines 86/103/104/105/115/123/829:
    86 error react-hooks/set-state-in-effect
    103 error react-hooks/immutability
    104 error react-hooks/immutability
    105 warn react-hooks/exhaustive-deps
    115 error react-hooks/immutability
    123 warn react-hooks/exhaustive-deps
    829 error react-hooks/set-state-in-effect
  Final (after edit), same rules shifted +35 lines by added helpers/state:
    121 error react-hooks/set-state-in-effect
    138 error react-hooks/immutability
    139 error react-hooks/immutability
    140 warn react-hooks/exhaustive-deps
    150 error react-hooks/immutability
    158 warn react-hooks/exhaustive-deps
    864 error react-hooks/set-state-in-effect
  Counts unchanged: 5 errors, 2 warnings; no new rule or new line beyond the shift.

build: `npm run build` → BUILD EXIT: 0, compiled successfully, `/dashboard/endpoint` emitted as static, postbuild copy-standalone-assets completed.

self-check: `node .loop/scratch/a-keys-check.mjs`
  PASS: server-masked -> disabled reveal/copy + note + bullet mask
  PASS: local full key -> reveal/copy enabled

NOTES:
- Assumption: `masked` is per API response (all keys together), as implemented by `GET /api/keys`; the flag is not stored per key.
- Assumption: "one clean, consistent masked token" means replacing the server's `***` run with the same `•` bullets used by the local mask, preserving visible prefix/suffix; the underlying masked string is never trusted as a copyable secret.
- masking-correctness: DONE
- key-chip-readability: DONE
- five-sub-block-grouping: DONE
- Another worker's in-flight `src/shared/components/Sidebar.js` changes were present in the tree; not touched by this worker. Build succeeded with them included.
