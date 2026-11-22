SKILLS LOADED: design-system-implementation

STATUS: done

FILES CHANGED: src/shared/components/Sidebar.js, .loop/scratch/b-sidebar-check.mjs

SUMMARY:
Replaced the flat `navItems` list with a single in-file `NAV_GROUPS` declaration.
`navItems` is now derived via `NAV_GROUPS.flatMap()`, so no route or label changed
and no second nav declaration was introduced.
Groups: Workspace (Endpoint & Key, Providers, Basic Chat, Combo & Vision Adapter, Prompt Library),
Monitor (Usage, Health & Spend, Quota Tracker), Tools (Token Saver, CLI Tools).
Each group renders under the same heading classes as System: uppercase, muted
`text-white/40`, `text-[10px] font-bold tracking-[0.08em]`.
Link markup, icon/active classes, hover states, hrefs, the System block, the
scroll container, and the drawer behaviour are untouched.
Member filtering moved to per-group `visibleGroups`: same `AREA_FOR_NAV[item.href]`
predicate, plus a `group.items.length > 0` filter so empty headings never render.
Read the Next.js "Linking and Navigating" guide per AGENTS.md; no breaking API
usage — `<Link href>` unchanged.

EVIDENCE:
eslint: `npx eslint src/shared/components/Sidebar.js` → `ESLint: No issues found` (exit 0).
build: `npm run build` → `✓ Compiled successfully in 16.7s`, `✓ Generating static pages using 15 workers (156/156) in 2.5s`, postbuild standalone-assets copy completed (exit 0). Full log: .loop/scratch/b-sidebar-build.log
self-check: `node .loop/scratch/b-sidebar-check.mjs` →
`PASS: 10 items, order Workspace → Monitor → Tools, member filter keeps /dashboard/usage only, no empty group.` (exit 0).

NOTES:
Assumption: nav grouping data stays inside Sidebar.js as required, with `navItems` derived from it rather than removed — other code/tests referring to `navItems` keep the same 10 entries in the same order. System remains a separate owner-only block as specified.
three-nav-groups: DONE
group-headings: DONE
member-filter-ok: DONE
