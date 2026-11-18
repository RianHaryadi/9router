import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The backward-compat shims (src/lib/localDb.js, src/lib/usageDb.js)
// re-export an EXPLICIT list of names. A function that exists in the repo
// but was left out of the shim is "not a function" at runtime — a 500 in
// production, and a green build.
//
// This test checks the names that are actually IMPORTED from those shims:
// every import must resolve to a name the shim exports.
//
// The files are parsed as TEXT: importing them would boot the DB layer.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "src");

/** Every .js file under src/. */
function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(p, out);
    else if (entry.name.endsWith(".js")) out.push(p);
  }
  return out;
}

/** The names in an `export { ... } from "..."` block. */
function exportedNames(source) {
  const names = new Set();
  const re = /export\s*\{([^}]*)\}\s*from/g;
  let m;
  while ((m = re.exec(source))) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/** The names imported from a given module path, across the whole source tree. */
function importedNames(modulePath) {
  const wanted = new Set();
  const escaped = modulePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${escaped}["']`, "g");
  for (const file of sourceFiles(SRC)) {
    const source = fs.readFileSync(file, "utf8");
    let m;
    while ((m = re.exec(source))) {
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0]?.trim();
        if (name) wanted.add(name);
      }
    }
  }
  return wanted;
}

describe("compat shims", () => {
  it("localDb.js exports every name the app imports from it", () => {
    const shim = exportedNames(fs.readFileSync(path.join(ROOT, "src/lib/localDb.js"), "utf8"));
    const used = importedNames("@/lib/localDb.js");
    const missing = [...used].filter((n) => !shim.has(n));
    expect(missing).toEqual([]);
  });

  it("usageDb.js exports every name the app imports from it", () => {
    const shim = exportedNames(fs.readFileSync(path.join(ROOT, "src/lib/usageDb.js"), "utf8"));
    const used = importedNames("@/lib/usageDb.js");
    const missing = [...used].filter((n) => !shim.has(n));
    expect(missing).toEqual([]);
  });
});
