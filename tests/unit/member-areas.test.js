import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Per-member dashboard areas: the owner grants a teammate a set of areas
// ("can see usage", "can reach the endpoint page") and the guard enforces it.
//
// Covers:
//   1. the areas are persisted and survive a round trip,
//   2. an unknown area id is refused (fail closed),
//   3. the guard maps an API path / page to the right area,
//   4. base areas (chat) are always granted, whatever the owner ticked,
//   5. an area that is NOT granted is not in the member's set.

let tempDir;
const originalDataDir = process.env.DATA_DIR;

async function boot() {
  delete global._dbAdapter;
  vi.resetModules();
  const members = await import("@/lib/db/repos/teamMembersRepo.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  await getAdapter();
  return { members, adapter: await getAdapter() };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-areas-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("member areas", () => {
  it("persists the granted areas on the member row", async () => {
    const { members } = await boot();
    const created = await members.createTeamMember({
      name: "Andi",
      password: "pw-1234",
      areas: ["usage", "combos"],
    });
    expect(created.areas).toEqual(["usage", "combos"]);

    const [listed] = await members.getTeamMembers();
    expect(listed.areas).toEqual(["usage", "combos"]);
  });

  it("refuses an unknown area id", async () => {
    const { members } = await boot();
    const created = await members.createTeamMember({
      name: "Budi",
      password: "pw-1234",
      areas: ["usage", "not-an-area", "usage"],
    });
    expect(created.areas).toEqual(["usage"]);
  });

  it("updates the areas on an existing member", async () => {
    const { members } = await boot();
    const created = await members.createTeamMember({ name: "Citra", password: "pw-1234", areas: ["usage"] });
    const updated = await members.updateTeamMember(created.id, { areas: ["combos", "prompts"] });
    expect(updated.areas).toEqual(["combos", "prompts"]);
  });

  it("keeps a member with no areas chat-only", async () => {
    const { members } = await boot();
    const created = await members.createTeamMember({ name: "Dewi", password: "pw-1234" });
    expect(created.areas).toEqual([]);
  });
});

describe("area mapping", () => {
  it("maps API paths and pages to their area", async () => {
    const { __test__ } = await import("../../src/dashboardGuard.js");

    expect(__test__.apiAreaFor("/api/usage/stats")).toBe("usage");
    expect(__test__.apiAreaFor("/api/usage")).toBe("usage");
    expect(__test__.apiAreaFor("/api/combos")).toBe("combos");
    expect(__test__.apiAreaFor("/api/prompt-templates")).toBe("prompts");
    expect(__test__.apiAreaFor("/api/dashboard/chat/completions")).toBe("basic-chat");
    // An unknown endpoint is owner-only, not "some area".
    expect(__test__.apiAreaFor("/api/something-new")).toBeNull();

    expect(__test__.pageAreaFor("/dashboard/basic-chat")).toBe("basic-chat");
    expect(__test__.pageAreaFor("/dashboard/usage")).toBe("usage");
    expect(__test__.pageAreaFor("/dashboard/providers")).toBe("providers");
    expect(__test__.pageAreaFor("/dashboard/profile")).toBe("endpoint");
    // A page with no entry is owner-only.
    expect(__test__.pageAreaFor("/dashboard/unknown")).toBeNull();
  });

  it("keeps the health subtree out of the public list", async () => {
    const { __test__ } = await import("../../src/dashboardGuard.js");
    // /api/health is public; the matrix and breaker expose provider
    // internals, so they need the health area.
    expect(__test__.isPublicApi("/api/health")).toBe(true);
    expect(__test__.isPublicApi("/api/health/matrix")).toBe(false);
    expect(__test__.isPublicApi("/api/health/breaker")).toBe(false);
    // The health area covers the sub-routes.
    expect(__test__.apiAreaFor("/api/health/matrix")).toBe("health");
    expect(__test__.apiAreaFor("/api/health/breaker")).toBe("health");
  });

  it("always grants the base areas and only known areas", async () => {
    const { memberAreasOf, MEMBER_AREA_IDS } = await import("../../src/shared/constants/memberAreas.js");

    const areas = memberAreasOf({ areas: ["usage", "bogus"] });
    expect(areas.has("basic-chat")).toBe(true);
    expect(areas.has("usage")).toBe(true);
    expect(areas.has("bogus")).toBe(false);
    for (const id of areas) expect(MEMBER_AREA_IDS).toContain(id);

    // No claim at all → chat only.
    const bare = memberAreasOf(null);
    expect(bare.has("basic-chat")).toBe(true);
    expect(bare.size).toBe(1);
  });
});
