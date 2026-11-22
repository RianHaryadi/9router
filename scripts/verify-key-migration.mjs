// Migration drill: build a DB that looks like an OLD install (raw API keys
// already persisted in usageHistory / fallbackEvents), then run the
// api-key-fingerprint migration and assert the raw keys are gone.
//
// Usage: node --import ./scripts/register-alias.mjs scripts/verify-key-migration.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { apiKeyFingerprint } from "../src/shared/utils/apiKeyFingerprint.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-migration-"));
process.env.DATA_DIR = tempDir;

const { getAdapter } = await import("../src/lib/db/driver.js");
const adapter = await getAdapter();

// Plant raw keys the way the pre-migration code wrote them.
const RAW = "sk-oldteam-rawsecret-1234567890";
adapter.run(
  `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta)
   VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [new Date().toISOString(), "openai", "gpt-5", "c1", RAW, "/v1/chat", 10, 5, 0.01, "ok", "{}", "{}"]
);
adapter.run(
  `INSERT INTO fallbackEvents(id, timestamp, requestId, provider, model, connectionId, apiKey, projectName, fromProvider, fromModel, status, reason, cooldownMs, latencyMs)
   VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ["fe-1", new Date().toISOString(), "req-1", "openai", "gpt-5", "c1", RAW, "team", "openai", "gpt-5", 429, "rate limit", 1000, 100]
);

const before = adapter.get(`SELECT apiKey FROM usageHistory LIMIT 1`).apiKey;
console.log(`before: usageHistory.apiKey = ${before}`);
if (before !== RAW) {
  console.error("❌ fixture did not plant the raw key");
  process.exit(1);
}

// Run the migration by hand (the boot already applied it, so re-run it).
const migration = (await import("../src/lib/db/migrations/004-api-key-fingerprint.js")).default;
migration.up(adapter);

const afterUsage = adapter.get(`SELECT apiKey FROM usageHistory LIMIT 1`).apiKey;
const afterFallback = adapter.get(`SELECT apiKey FROM fallbackEvents LIMIT 1`).apiKey;
const expected = apiKeyFingerprint(RAW);

console.log(`after:  usageHistory.apiKey   = ${afterUsage}`);
console.log(`after:  fallbackEvents.apiKey = ${afterFallback}`);

const problems = [];
if (afterUsage === RAW) problems.push("usageHistory still holds the raw key");
if (afterFallback === RAW) problems.push("fallbackEvents still holds the raw key");
if (afterUsage !== expected) problems.push(`usageHistory fingerprint mismatch (want ${expected})`);
if (afterFallback !== expected) problems.push(`fallbackEvents fingerprint mismatch (want ${expected})`);

// The apiKeys row must carry a fingerprint too.
const keyRow = adapter.get(`SELECT keyRef FROM apiKeys LIMIT 1`);
if (keyRow?.keyRef && keyRow.keyRef === RAW) problems.push("apiKeys.keyRef still holds the raw key");

fs.rmSync(tempDir, { recursive: true, force: true });

if (problems.length) {
  console.error(`\n❌ ${problems.length} problem(s):`);
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}
console.log("\n✅ Migration rewrites every persisted raw API key into a fingerprint.");
