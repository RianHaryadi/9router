import { describe, expect, it } from "vitest";
import {
  toMemberConnectionResponse,
  toProviderConnectionResponse,
} from "../../src/lib/providerConnectionResponse.js";

// What a teammate may see of the owner's connections.
//
// The connection NAME is the account identity for OAuth providers (it IS the
// owner's email), and the error text can carry it too. So a member sees the
// provider and its health, never WHICH account it is.

const ownerConnection = {
  id: "conn-1",
  provider: "claude",
  authType: "oauth",
  name: "owner@gmail.com",
  email: "owner@gmail.com",
  displayName: "Owner",
  apiKey: "sk-secret-value",
  accessToken: "at-secret",
  refreshToken: "rt-secret",
  testStatus: "active",
  lastError: "401 for owner@gmail.com",
  lastErrorAt: "2026-11-18T00:00:00Z",
  errorCode: 401,
  lastUsedAt: "2026-11-18T00:00:00Z",
  consecutiveUseCount: 3,
  rateLimitedUntil: null,
  expiresAt: null,
  expiresIn: 3600,
  defaultModel: "claude-opus",
  globalPriority: 10,
  priority: 1,
  projectId: "proj-1",
  providerSpecificData: { copilotToken: "pt-secret", baseUrl: "https://example.org" },
  isActive: true,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-18T00:00:00Z",
};

describe("member connection response", () => {
  it("hides the account identity and the secrets", () => {
    const safe = toMemberConnectionResponse(ownerConnection);

    // The account identity is gone in every form.
    expect(safe.name).not.toContain("@");
    expect(safe.email).toBeUndefined();
    expect(safe.displayName).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain("owner@gmail.com");

    // The secrets are gone.
    expect(safe.apiKey).toBeUndefined();
    expect(safe.accessToken).toBeUndefined();
    expect(safe.refreshToken).toBeUndefined();
    expect(safe.providerSpecificData).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain("secret");
  });

  it("keeps what the member needs: the provider, its health and the handle", () => {
    const safe = toMemberConnectionResponse(ownerConnection);

    expect(safe.id).toBe("conn-1");
    expect(safe.provider).toBe("claude");
    expect(safe.authType).toBe("oauth");
    expect(safe.isActive).toBe(true);
    // The status stays: it is the provider's health, not an identity.
    expect(safe.testStatus).toBe("active");
    // The error text can carry the email, so it goes.
    expect(safe.lastError).toBeUndefined();
    expect(safe.errorCode).toBeUndefined();
  });

  it("drops the owner's per-connection policy fields", () => {
    const safe = toMemberConnectionResponse(ownerConnection);
    for (const field of [
      "defaultModel",
      "globalPriority",
      "priority",
      "projectId",
      "lastUsedAt",
      "consecutiveUseCount",
      "rateLimitedUntil",
      "expiresAt",
      "expiresIn",
    ]) {
      expect(safe[field]).toBeUndefined();
    }
  });

  it("strips the secrets before the member fields", () => {
    // The raw row carries the apiKey: stripping the secrets FIRST is what
    // keeps it out of the rest-spread.
    const safe = toMemberConnectionResponse(ownerConnection);
    expect(Object.keys(safe)).not.toContain("apiKey");
    expect(Object.keys(toProviderConnectionResponse(ownerConnection))).not.toContain("apiKey");
  });

  it("names the provider when the registry knows it", () => {
    const safe = toMemberConnectionResponse(ownerConnection);
    expect(safe.name).toBeTruthy();
    expect(safe.name).not.toBe("owner@gmail.com");
  });
});
