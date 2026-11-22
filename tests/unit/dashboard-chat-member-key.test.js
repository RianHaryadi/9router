import { beforeEach, describe, expect, it, vi } from "vitest";

// The dashboard playground chat route.
//
// A teammate chats on THEIR OWN key: its allow-list, budget and rate limits
// decide what they reach. Two cases must not be confused:
//
//   no key at all   → the owner's shared key (the connections are shared;
//                     only the workflow differs),
//   revoked key     → NOTHING. A deactivated key must not fall back to the
//                     shared key: that would hand a suspended teammate the
//                     owner's unrestricted key.

const handleChatMock = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({
  isAuthenticated: vi.fn(),
  getSession: vi.fn(),
  getApiKeys: vi.fn(),
  getDashboardChatApiKey: vi.fn(),
  enforceApiKeyRateLimit: vi.fn(),
}));

vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: handleChatMock }));
vi.mock("@/dashboardGuard", () => ({
  isAuthenticated: auth.isAuthenticated,
  getSession: auth.getSession,
}));
vi.mock("@/lib/localDb", () => ({ getApiKeys: auth.getApiKeys }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  getDashboardChatApiKey: auth.getDashboardChatApiKey,
  enforceApiKeyRateLimit: auth.enforceApiKeyRateLimit,
}));

const { POST } = await import("../../src/app/api/dashboard/chat/completions/route.js");

const post = () =>
  POST(new Request("http://localhost/api/dashboard/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "openai/gpt-4o", messages: [] }),
  }));

describe("dashboard chat route — a member's key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.isAuthenticated.mockResolvedValue(true);
    auth.enforceApiKeyRateLimit.mockResolvedValue(null);
    auth.getDashboardChatApiKey.mockResolvedValue("server-managed-fixture-key");
  });

  it("uses the owner's managed key for an owner session", async () => {
    auth.getSession.mockResolvedValue({ role: "owner" });
    handleChatMock.mockResolvedValue(new Response("data: [DONE]\n\n"));

    await post();

    const forwarded = handleChatMock.mock.calls[0][0];
    expect(forwarded.headers.get("authorization")).toBe("Bearer server-managed-fixture-key");
  });

  it("uses the member's own key when they have one", async () => {
    auth.getSession.mockResolvedValue({ role: "member", keyRef: "ref-1" });
    auth.getApiKeys.mockResolvedValue([
      { keyRef: "ref-1", key: "sk-member", isActive: true, access: { restricted: true, allow: ["x"] } },
    ]);
    handleChatMock.mockResolvedValue(new Response("data: [DONE]\n\n"));

    await post();

    const forwarded = handleChatMock.mock.calls[0][0];
    expect(forwarded.headers.get("authorization")).toBe("Bearer sk-member");
  });

  it("falls back to the owner's shared key when the member has NO key", async () => {
    auth.getSession.mockResolvedValue({ role: "member", keyRef: null });
    auth.getApiKeys.mockResolvedValue([
      { keyRef: "owner-ref", key: "sk-shared", isActive: true, access: { restricted: false, allow: [] } },
    ]);
    handleChatMock.mockResolvedValue(new Response("data: [DONE]\n\n"));

    const res = await post();
    expect(res.status).toBe(200);
    const forwarded = handleChatMock.mock.calls[0][0];
    expect(forwarded.headers.get("authorization")).toBe("Bearer sk-shared");
  });

  it("refuses a REVOKED key instead of handing over the shared key", async () => {
    auth.getSession.mockResolvedValue({ role: "member", keyRef: "ref-1" });
    // The key exists but is deactivated — the owner suspended this teammate.
    auth.getApiKeys.mockResolvedValue([
      { keyRef: "ref-1", key: "sk-revoked", isActive: false, access: { restricted: true, allow: [] } },
      { keyRef: "owner-ref", key: "sk-shared", isActive: true, access: { restricted: false, allow: [] } },
    ]);

    const res = await post();
    expect(res.status).toBe(403);
    expect(handleChatMock).not.toHaveBeenCalled();
  });

  it("refuses a key that no longer exists instead of falling back", async () => {
    auth.getSession.mockResolvedValue({ role: "member", keyRef: "ref-gone" });
    auth.getApiKeys.mockResolvedValue([
      { keyRef: "owner-ref", key: "sk-shared", isActive: true, access: { restricted: false, allow: [] } },
    ]);

    const res = await post();
    expect(res.status).toBe(403);
    expect(handleChatMock).not.toHaveBeenCalled();
  });

  it("refuses when no key at all is available", async () => {
    auth.getSession.mockResolvedValue({ role: "member", keyRef: null });
    auth.getApiKeys.mockResolvedValue([]);

    const res = await post();
    expect(res.status).toBe(403);
    expect(handleChatMock).not.toHaveBeenCalled();
  });
});
