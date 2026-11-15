import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ isAuthenticated: vi.fn() }));
const usageDb = vi.hoisted(() => ({ getRequestDetailById: vi.fn() }));
const dashboardChat = vi.hoisted(() => ({ dispatchDashboardChat: vi.fn() }));

vi.mock("@/dashboardGuard", () => ({ isAuthenticated: auth.isAuthenticated }));
vi.mock("@/lib/usageDb", () => ({ getRequestDetailById: usageDb.getRequestDetailById }));
vi.mock("@/custom/wiring/dashboardChat.js", () => ({ dispatchDashboardChat: dashboardChat.dispatchDashboardChat }));

const { POST } = await import("../../src/app/api/usage/request-details/[id]/replay/route.js");

function replayRequest() {
  return new Request("http://localhost/api/usage/request-details/abc/replay", { method: "POST" });
}

describe("request replay route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.isAuthenticated.mockResolvedValue(true);
  });

  it("rejects unauthenticated callers", async () => {
    auth.isAuthenticated.mockResolvedValue(false);
    const response = await POST(replayRequest(), { params: { id: "abc" } });
    expect(response.status).toBe(401);
    expect(dashboardChat.dispatchDashboardChat).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown request detail", async () => {
    usageDb.getRequestDetailById.mockResolvedValue(null);
    const response = await POST(replayRequest(), { params: { id: "abc" } });
    expect(response.status).toBe(404);
    expect(dashboardChat.dispatchDashboardChat).not.toHaveBeenCalled();
  });

  it("refuses to replay a stored request without a model", async () => {
    usageDb.getRequestDetailById.mockResolvedValue({ id: "abc", request: { messages: [{ role: "user", content: "hi" }] } });
    const response = await POST(replayRequest(), { params: { id: "abc" } });
    expect(response.status).toBe(422);
    expect(dashboardChat.dispatchDashboardChat).not.toHaveBeenCalled();
  });

  it("refuses to replay a stored request without messages", async () => {
    usageDb.getRequestDetailById.mockResolvedValue({ id: "abc", request: { model: "openai/gpt-4o" } });
    const response = await POST(replayRequest(), { params: { id: "abc" } });
    expect(response.status).toBe(422);
    expect(dashboardChat.dispatchDashboardChat).not.toHaveBeenCalled();
  });

  it("replays the stored snapshot, not a caller-supplied body", async () => {
    usageDb.getRequestDetailById.mockResolvedValue({
      id: "abc",
      model: "openai/gpt-4o",
      request: { model: "openai/gpt-4o", messages: [{ role: "user", content: "original" }], temperature: 0.2 },
    });
    const upstream = Response.json({ choices: [{ message: { content: "replayed" } }] });
    dashboardChat.dispatchDashboardChat.mockResolvedValue(upstream);

    const response = await POST(replayRequest(), { params: { id: "abc" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ choices: [{ message: { content: "replayed" } }] });

    expect(dashboardChat.dispatchDashboardChat).toHaveBeenCalledTimes(1);
    const [forwarded, opts] = dashboardChat.dispatchDashboardChat.mock.calls[0];
    const body = await forwarded.json();
    expect(body.model).toBe("openai/gpt-4o");
    expect(body.messages).toEqual([{ role: "user", content: "original" }]);
    expect(body.stream).toBe(false);
    expect(opts.model).toBe("openai/gpt-4o");
  });

  it("propagates an upstream failure status", async () => {
    usageDb.getRequestDetailById.mockResolvedValue({
      id: "abc",
      request: { model: "openai/gpt-4o", messages: [{ role: "user", content: "x" }] },
    });
    dashboardChat.dispatchDashboardChat.mockResolvedValue(Response.json({ error: { message: "boom" } }, { status: 502 }));
    const response = await POST(replayRequest(), { params: { id: "abc" } });
    expect(response.status).toBe(502);
  });
});
