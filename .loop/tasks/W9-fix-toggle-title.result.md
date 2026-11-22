SKILLS LOADED: test-driven-development (Hermes Brain MCP; RED → GREEN → mutation check followed)

STATUS: done

FILES CHANGED:
- `src/shared/components/Toggle.js` — accept `title` prop, forward to internal real `<button role="switch">`.
- `tests/unit/toggle-title.test.js` — new focused source-contract test (new file).

SUMMARY:
Toggle destructure gains `title` between `size` and `className`; the real switch `<button>` gains `title={title}` immediately after `role="switch"`.
No behavior, styling, size, disabled handling, or other API change. EndpointPageClient.js, Sidebar.js, other source, `.loop/state.md` untouched.
No stash/reset/commit/push/deploy performed.
Test framework ceiling: this repo's vitest config uses `environment: "node"` and does not declare a JSX transform for `.js` files; an initial real-render test with `react-dom/server` + `createElement` was rejected by Vite with "Failed to parse source for import analysis because the content contains invalid JS syntax. If you are using JSX, make sure to name the file with the .jsx or .tsx extension." because Toggle.js itself contains JSX. Installing jsdom/testing-library or adding a JSX transform would change config/dependencies outside owned scope, so per brief the test is a minimal source-contract test that extracts the Toggle props signature and the switch `<button>` opening tag, asserting `title` is accepted and forwarded on that exact button.

EVIDENCE:
RED (before fix, Node 26.12.1):
```
$ cd tests && PATH=/home/kennyh/.hermes/tools/node-26.12.1-linux-x64/bin:$PATH npx vitest run unit/toggle-title.test.js
 FAIL  unit/toggle-title.test.js > Toggle title forwarding source contract > accepts title and forwards it to the switch button
AssertionError: expected [ 'checked = false', 'onChange', …(6) ] to include 'title'
 ❯ tests/unit/toggle-title.test.js:12:51
 Test Files  1 failed (1)
      Tests  1 failed (1)
```
GREEN (after fix, same command):
```
 RUN  v4.1.12 /home/kennyh/Documents/9router/tests
 ✓ unit/toggle-title.test.js (1 test)
 Test Files  1 passed (1)
      Tests  1 passed (1)
```
Mutation check (TDD skill): temporarily removed `title={title}` from the real button in Toggle.js → test FAILED with `expected '<button ...' to contain 'title={title}'`; line restored → test PASSED again. This proves the assertion is sensitive to the exact regression, not vacuously green.
Focused eslint:
```
$ npx eslint src/shared/components/Toggle.js tests/unit/toggle-title.test.js
ESLint: No issues found
eslint exit=0
```
Whitespace:
```
$ git diff --check -- src/shared/components/Toggle.js tests/unit/toggle-title.test.js
diff-check exit=0
```
Final source diff (2 added lines):
```
@@ -9,6 +9,7 @@ export default function Toggle({
+  title,
   className,
@@ -32,6 +33,7 @@
         role="switch"
+        title={title}
         aria-checked={checked}
```
Working tree status for owned paths: `M src/shared/components/Toggle.js`, `?? tests/unit/toggle-title.test.js`.

NOTES:
- Assumption: the failing `<button>` is the switch button identified by `role="switch"`; forwarding `title` there gives the native browser tooltip.
- The test is a structural source contract with a stated ceiling; it does not render in a real browser. The mutation check above compensates by proving it fails on the pre-fix shape.
- `title` is optional; when EndpointPageClient.js does not pass one, the rendered button has no `title` attribute — unchanged from before.
- No other worker's files were touched; all writes stayed inside the workspace.
