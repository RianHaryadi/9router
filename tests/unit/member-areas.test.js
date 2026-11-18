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

describe("member-owned rows", () => {
  const asMember = (memberId) => ({ isOwner: false, memberId });
  const asOwner = { isOwner: true, memberId: null };

  it("binds a combo to its creator and refuses a foreign edit", async () => {
    const { members } = await boot();
    const { getCombos, createCombo, updateComboOwnedBy, deleteComboOwnedBy } = await import("@/lib/db/repos/combosRepo.js");
    const member = await members.createTeamMember({ name: "Andi", password: "pw-1234" });

    // The owner creates a combo (no owner id).
    const ownerCombo = await createCombo({ name: "OwnerCombo", models: [] });
    expect(ownerCombo.ownerId).toBeNull();

    // The member creates one: it is bound to their member id.
    const memberCombo = await createCombo({ name: "MemberCombo", models: [], ownerId: member.id });
    expect(memberCombo.ownerId).toBe(member.id);

    // The member may write their own.
    const updated = await updateComboOwnedBy(memberCombo.id, { name: "Renamed" }, asMember(member.id));
    expect(updated?.name).toBe("Renamed");

    // …and never the owner's, even with the right id.
    expect(await updateComboOwnedBy(ownerCombo.id, { name: "Hijacked" }, asMember(member.id))).toBeNull();
    expect(await deleteComboOwnedBy(ownerCombo.id, asMember(member.id))).toBe(false);

    // Another member's combo is not theirs either.
    const other = await members.createTeamMember({ name: "Citra", password: "pw-1234" });
    expect(await updateComboOwnedBy(memberCombo.id, { name: "Stolen" }, asMember(other.id))).toBeNull();

    // The owner may write every combo, including a member's.
    expect(await updateComboOwnedBy(ownerCombo.id, { name: "OwnerRenamed" }, asOwner)).not.toBeNull();
    expect(await updateComboOwnedBy(memberCombo.id, { name: "OwnerTouched" }, asOwner)).not.toBeNull();
    expect(await deleteComboOwnedBy(memberCombo.id, asOwner)).toBe(true);

    // The owner's id does not move: a member cannot claim a combo.
    const after = (await getCombos()).find((c) => c.name === "OwnerRenamed");
    expect(after.ownerId).toBeNull();
  });

  it("binds a prompt template to its creator and refuses a foreign edit", async () => {
    const { members } = await boot();
    const { getPromptTemplates, createPromptTemplate, updatePromptTemplateOwnedBy, deletePromptTemplateOwnedBy } =
      await import("@/lib/db/repos/promptTemplatesRepo.js");
    const member = await members.createTeamMember({ name: "Budi", password: "pw-1234" });

    const ownerTemplate = await createPromptTemplate({ name: "OwnerTpl", content: "x" });
    expect(ownerTemplate.ownerId).toBeNull();

    const memberTemplate = await createPromptTemplate({ name: "MemberTpl", content: "x", ownerId: member.id });
    expect(memberTemplate.ownerId).toBe(member.id);

    expect(await updatePromptTemplateOwnedBy(memberTemplate.id, { name: "Renamed" }, asMember(member.id))).not.toBeNull();
    expect(await updatePromptTemplateOwnedBy(ownerTemplate.id, { name: "Hijacked" }, asMember(member.id))).toBeNull();
    expect(await deletePromptTemplateOwnedBy(ownerTemplate.id, asMember(member.id))).toBe(false);
    expect(await deletePromptTemplateOwnedBy(memberTemplate.id, asOwner)).toBe(true);
    expect((await getPromptTemplates()).map((t) => t.name)).toEqual(["OwnerTpl"]);
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

  it("keeps the base API paths read-only and exact", async () => {
    const { __test__ } = await import("../../src/dashboardGuard.js");
    // The base paths open the chat's model picker. They must not become a
    // write path: /api/combos accepts POST, /api/models/custom accepts POST.
    expect(__test__.MEMBER_ALLOWED_PATHS).not.toContain("/api/combos");
    expect(__test__.MEMBER_ALLOWED_PATHS).not.toContain("/api/providers");
    expect(__test__.MEMBER_BASE_API_PATHS).toEqual(["/api/providers", "/api/combos", "/api/models"]);
    // The area map must not open the mutating sub-routes either.
    expect(__test__.apiAreaFor("/api/models/custom")).toBe("combos");
    expect(__test__.apiAreaFor("/api/combos/presets")).toBe("combos");
  });

  it("never lets a member read the settings", async () => {
    const { __test__ } = await import("../../src/dashboardGuard.js");
    // /api/settings carries the deployment settings. It is owner-only for
    // every area — no member area maps to it.
    expect(__test__.apiAreaFor("/api/settings")).toBeNull();
    expect(__test__.MEMBER_ALLOWED_PATHS).not.toContain("/api/settings");
    // The chat's model picker needs these three — as read-only base paths.
    for (const p of ["/api/providers", "/api/combos", "/api/models"]) {
      expect(__test__.MEMBER_BASE_API_PATHS).toContain(p);
    }
  });

  it("never publishes a route that can stop the router", async () => {
    const { __test__ } = await import("../../src/dashboardGuard.js");
    // /api/version is public, but shutdown and update kill or replace the
    // running router. A prefix match made them public: a teammate shut the
    // whole instance down.
    expect(__test__.isPublicApi("/api/version")).toBe(true);
    expect(__test__.isPublicApi("/api/version/shutdown")).toBe(false);
    expect(__test__.isPublicApi("/api/version/update")).toBe(false);
    // /api/shutdown is never public either.
    expect(__test__.isPublicApi("/api/shutdown")).toBe(false);
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

  it("lets a member write only their own objects, and only in the areas they hold", async () => {
    const { memberWriteScopeFor } = await import("../../src/shared/constants/memberAreas.js");

    // The member-owned writes: create a combo/template, edit and delete them.
    expect(memberWriteScopeFor("POST", "/api/combos")).toMatchObject({ area: "combos" });
    expect(memberWriteScopeFor("PUT", "/api/combos/abc")).toMatchObject({ area: "combos" });
    expect(memberWriteScopeFor("DELETE", "/api/combos/abc")).toMatchObject({ area: "combos" });
    expect(memberWriteScopeFor("POST", "/api/prompt-templates")).toMatchObject({ area: "prompts" });
    expect(memberWriteScopeFor("PATCH", "/api/prompt-templates/abc")).toMatchObject({ area: "prompts" });
    expect(memberWriteScopeFor("DELETE", "/api/prompt-templates/abc")).toMatchObject({ area: "prompts" });

    // Everything else stays owner-only.
    expect(memberWriteScopeFor("POST", "/api/keys")).toBeNull();
    expect(memberWriteScopeFor("POST", "/api/settings")).toBeNull();
    expect(memberWriteScopeFor("PATCH", "/api/team/members")).toBeNull();
    expect(memberWriteScopeFor("POST", "/api/models/custom")).toBeNull();
    expect(memberWriteScopeFor("PUT", "/api/models/alias")).toBeNull();
    // The preset route creates MANY combos at once — never member-writable.
    expect(memberWriteScopeFor("POST", "/api/combos/presets")).toBeNull();
    // A version read of a template is not a write.
    expect(memberWriteScopeFor("GET", "/api/combos/abc")).toBeNull();
    expect(memberWriteScopeFor("PATCH", "/api/prompt-templates/abc/versions")).toBeNull();
  });

  it("records the owner of a created object", async () => {
    const { ownerIdOfSession } = await import("../../src/shared/constants/memberAreas.js");
    // The owner has no member id; a teammate's session carries theirs.
    expect(ownerIdOfSession({ role: "owner" })).toBeNull();
    expect(ownerIdOfSession({ role: "member", userId: "m-1" })).toBe("m-1");
    // A key sign-in has no member row: it owns nothing.
    expect(ownerIdOfSession({ role: "member", userId: null })).toBeNull();
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
