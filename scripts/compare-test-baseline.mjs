// Compare the current test run against the committed baseline, by test name.
// Usage: node scripts/compare-test-baseline.mjs <current-results.json>
import { readFileSync } from "node:fs";

const currentPath = process.argv[2];
if (!currentPath) {
  console.error("Missing current results path");
  process.exit(2);
}

function failedNames(file) {
  const r = JSON.parse(readFileSync(file, "utf8"));
  return new Set(
    r.testResults.flatMap((f) =>
      f.assertionResults
        .filter((a) => a.status === "failed")
        .map((a) => `${f.name.split("/tests/")[1]} :: ${a.fullName}`)
    )
  );
}

const baseline = failedNames(new URL("../tests/__baseline__/baseline-results.json", import.meta.url));
const current = failedNames(currentPath);

const regressions = [...current].filter((t) => !baseline.has(t));
const fixed = [...baseline].filter((t) => !current.has(t));

console.log(`baseline fails: ${baseline.size} | current fails: ${current.size}`);
console.log(`\nREGRESSIONS (${regressions.length}):`);
regressions.forEach((t) => console.log(`  - ${t}`));
console.log(`\nNEWLY PASSING (${fixed.length}):`);
fixed.forEach((t) => console.log(`  + ${t}`));
process.exit(regressions.length ? 1 : 0);
