// Compare two vitest JSON reports and print the differences.
// Usage: node scripts/compare-test-runs.mjs <before.json> <after.json>
import { readFileSync } from "node:fs";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("Usage: node scripts/compare-test-runs.mjs <before.json> <after.json>");
  process.exit(2);
}

function fails(file) {
  const r = JSON.parse(readFileSync(file, "utf8"));
  return new Set(
    r.testResults.flatMap((f) =>
      f.assertionResults
        .filter((a) => a.status === "failed")
        .map((a) => `${f.name.split("/tests/")[1]} :: ${a.fullName}`)
    )
  );
}

const before = fails(beforePath);
const after = fails(afterPath);
const newFails = [...after].filter((t) => !before.has(t));
const fixed = [...before].filter((t) => !after.has(t));

console.log(`before fails: ${before.size} | after fails: ${after.size}`);
console.log(`\nNEW FAILURES (${newFails.length}):`);
newFails.forEach((t) => console.log(`  - ${t}`));
console.log(`\nFIXED (${fixed.length}):`);
fixed.forEach((t) => console.log(`  + ${t}`));
