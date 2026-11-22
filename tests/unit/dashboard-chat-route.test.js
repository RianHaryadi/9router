import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";

const handleChatMock = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({
  isAuthenticated: vi.fn(),
  getSession: vi.fn(),
  getDashboardChatApiKey: vi.fn(),
  enforceApiKeyRateLimit: vi.fn(),
}));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: handleChatMock }));
vi.mock("@/dashboardGuard", () => ({
  isAuthenticated: auth.isAuthenticated,
  getSession: auth.getSession,
}));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getDashboardChatApiKey: auth.getDashboardChatApiKey, enforceApiKeyRateLimit: auth.enforceApiKeyRateLimit }));

const { POST } = await import("../../src/app/api/dashboard/chat/completions/route.js");

describe("dashboard playground chat route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.isAuthenticated.mockResolvedValue(true);
    // An owner session (no userId) → the server-managed key is used.
    auth.getSession.mockResolvedValue({ role: "owner" });
    auth.getDashboardChatApiKey.mockResolvedValue("server-managed-fixture-key");
    auth.enforceApiKeyRateLimit.mockResolvedValue(null);
  });
  it("exposes the existing Basic Chat in dashboard navigation", async () => {
    const sidebar = await readFile(new URL("../../src/shared/components/Sidebar.js", import.meta.url), "utf8");
    const executableSource = sidebar.replace(/^\s*\/\/.*$/gm, "");
    expect(executableSource).toContain('{ href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat" }');
  });

  it("sends the selected model and streaming request through the shared chat pipeline", async () => {
    const response = new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    handleChatMock.mockResolvedValue(response);
    const request = new Request("http://localhost/api/dashboard/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-4o", stream: true, messages: [{ role: "user", content: "ping" }] }),
    });

    expect(await POST(request)).toBe(response);
    const forwarded = handleChatMock.mock.calls[0][0];
    expect(auth.isAuthenticated).toHaveBeenCalledWith(request);
    expect(forwarded.headers.get("authorization")).toBe("Bearer server-managed-fixture-key");
    expect(await forwarded.json()).toMatchObject({ model: "openai/gpt-4o", stream: true });
    expect(auth.enforceApiKeyRateLimit).toHaveBeenCalledWith("server-managed-fixture-key");
    expect(response.headers.get("authorization")).toBeNull();
  });

  it("rejects unauthenticated callers before creating a key or dispatching", async () => {
    auth.isAuthenticated.mockResolvedValue(false);
    const request = new Request("http://localhost/api/dashboard/chat/completions", { method: "POST", headers: { "x-dashboard-authenticated": "true", authorization: "Bearer arbitrary-key" }, body: "{}" });
    expect((await POST(request)).status).toBe(401);
    expect(auth.getDashboardChatApiKey).not.toHaveBeenCalled();
    expect(handleChatMock).not.toHaveBeenCalled();
  });

  it("does not bypass a disabled dashboard key or its RPM policy", async () => {
    auth.getDashboardChatApiKey.mockResolvedValue(null);
    expect((await POST(new Request("http://localhost/api/dashboard/chat/completions", { method: "POST", body: "{}" }))).status).toBe(403);
    expect(handleChatMock).not.toHaveBeenCalled();
    auth.getDashboardChatApiKey.mockResolvedValue("server-managed-fixture-key");
    const limited = Response.json({ error: "rate limited" }, { status: 429 });
    auth.enforceApiKeyRateLimit.mockResolvedValue(limited);
    expect(await POST(new Request("http://localhost/api/dashboard/chat/completions", { method: "POST", body: "{}" }))).toBe(limited);
    expect(handleChatMock).not.toHaveBeenCalled();
  });

  it("fails closed when the key store is unavailable", async () => {
    auth.getDashboardChatApiKey.mockRejectedValue(new Error("DB unavailable"));
    expect((await POST(new Request("http://localhost/api/dashboard/chat/completions", { method: "POST", body: "{}" }))).status).toBe(503);
    expect(handleChatMock).not.toHaveBeenCalled();
  });
});
