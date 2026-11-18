import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The owner's team page: how much each teammate spends, on which key, and
// how much of that key's budget is left.
//
// The spend is read from the usage rows of the key the teammate is bound to:
// usageHistory stores the key FINGERPRINT, which is exactly the keyRef the
// member row points at. A teammate WITHOUT a key of their own chats on the
// owner's shared key, so their usage cannot be attributed — it is reported
// as shared, not as a personal number.

let tempDir;
const originalDataDir = process.env.DATA_DIR;

async function boot() {
  delete global._dbAdapter;
  vi.resetModules();
  const members = await import("@/lib/db/repos/teamMembersRepo.js");
  const keys = await import("@/lib/db/repos/apiKeysRepo.js");
  const usage = await import("@/lib/db/repos/usageRepo.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  await getAdapter();
  return { members, keys, usage };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-team-usage-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("team member usage", () => {
  it("reports the spend and the request count of the member's own key", async () => {
    const { members, keys, usage } = await boot();
    const key = await keys.createApiKey("Teammate key", "aaaaaaaabbbbbbbb");
    // The cost of a row is computed from the pricing table, so the rows are
    // written directly: this test is about the ATTRIBUTION, not the pricing.
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    for (const cost of [1.5, 0.5]) {
      db.run(
        `INSERT INTO usageHistory(timestamp, provider, model, apiKey, cost, promptTokens, completionTokens, tokens)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
        [new Date().toISOString(), "muse", "muse-spark", key.keyRef, cost, 100, 50, "{}"]
      );
    }

    const member = await members.createTeamMember({
      name: "Andi",
      password: "pw-1234",
      apiKeyRef: key.keyRef,
    });

    const [row] = await members.getTeamMembersWithUsage();
    expect(row.id).toBe(member.id);
    expect(row.sharedKey).toBe(false);
    expect(row.keyName).toBe("Teammate key");
    expect(row.usage.requests).toBe(2);
    expect(row.usage.cost).toBeCloseTo(2, 5);
  });

  it("reports the remaining budget of the member's key", async () => {
    const { members, keys } = await boot();
    const key = await keys.createApiKey("Budgeted key", "cccccccdddddddd");
    await keys.updateApiKey(key.id, { budgetLimitCents: 5000 });

    await members.createTeamMember({
      name: "Budi",
      password: "pw-1234",
      apiKeyRef: key.keyRef,
    });

    const [row] = await members.getTeamMembersWithUsage();
    expect(row.budget.limitCents).toBe(5000);
    expect(row.budget.spentCents).toBe(0);
    expect(row.budget.remainingCents).toBe(5000);
  });

  it("marks a member without a key as using the shared key", async () => {
    const { members } = await boot();
    await members.createTeamMember({ name: "Citra", password: "pw-1234" });
    const [row] = await members.getTeamMembersWithUsage();
    expect(row.sharedKey).toBe(true);
    expect(row.keyName).toBeNull();
    expect(row.budget).toBeNull();
  });

  it("reports a member whose key was deleted as broken, not as shared", async () => {
    const { members, keys } = await boot();
    const key = await keys.createApiKey("Deleted key", "ggggggghhhhhhhh");
    await members.createTeamMember({
      name: "Eko",
      password: "pw-1234",
      apiKeyRef: key.keyRef,
    });
    // The owner deletes the key: the member still points at its fingerprint.
    await keys.deleteApiKey(key.id);

    const [row] = await members.getTeamMembersWithUsage();
    expect(row.keyMissing).toBe(true);
    // NOT the shared key: this teammate cannot chat at all.
    expect(row.sharedKey).toBe(false);
    expect(row.keyName).toBeNull();
  });

  it("measures the spend over the budget window of a budgeted key", async () => {
    const { members, keys } = await boot();
    const key = await keys.createApiKey("Windowed key", "iiiiiiijjjjjjjjj");
    await keys.updateApiKey(key.id, { budgetLimitCents: 5000 });
    await members.createTeamMember({
      name: "Fajar",
      password: "pw-1234",
      apiKeyRef: key.keyRef,
    });

    const [row] = await members.getTeamMembersWithUsage();
    expect(row.usageWindow).toBe("budget");
  });

  it("measures the spend over the lifetime of a key without a budget", async () => {
    const { members, keys } = await boot();
    const key = await keys.createApiKey("Unbudgeted key", "kkkkkkkkllllllll");
    await members.createTeamMember({
      name: "Gita",
      password: "pw-1234",
      apiKeyRef: key.keyRef,
    });

    const [row] = await members.getTeamMembersWithUsage();
    expect(row.usageWindow).toBe("all");
  });

  it("never leaks the raw key value to the caller", async () => {
    const { members, keys } = await boot();
    const key = await keys.createApiKey("Secret key", "eeeeeeeffffffff");
    await members.createTeamMember({
      name: "Dewi",
      password: "pw-1234",
      apiKeyRef: key.keyRef,
    });
    const [row] = await members.getTeamMembersWithUsage();
    expect(JSON.stringify(row)).not.toContain(key.key);
    expect(row.keyRef).toBe(key.keyRef);
  });
});
