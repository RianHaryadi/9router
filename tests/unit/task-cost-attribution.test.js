import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Fork: task attribution.
//
// The client names the task it is working on (x-task-id header, or
// metadata.taskId in the body). Every usage row of that task carries the
// label, so "what did this agent run cost me?" is answerable — not just
// "what did this project cost?".

const db = {
  get: vi.fn(() => undefined),
  run: vi.fn(),
  transaction: vi.fn((fn) => fn()),
  all: vi.fn(() => []),
};

vi.mock("@/lib/db/driver.js", async () => {
  const actual = await vi.importActual("@/lib/db/driver.js");
  return { ...actual, getAdapter: vi.fn(async () => db) };
});

vi.mock("open-sse/providers/pricing.js", () => ({
  calculateCostFromTokens: vi.fn(async () => 0),
  getPricingForModel: vi.fn(() => null),
}));

const { saveUsageStats, requestObservability } = await import("../../open-sse/handlers/chatCore/requestDetail.js");
const { parseTaskId } = await import("../../src/custom/budget/costAttribution.js");

let insertArgs;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  insertArgs = undefined;
  db.get.mockReturnValue(undefined);
  db.all.mockReturnValue([]);
  db.run.mockImplementation((sql, args) => {
    if (String(sql).includes("INSERT INTO usageHistory")) insertArgs = args;
  });
  db.transaction.mockImplementation((fn) => fn());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("parseTaskId — where the task label comes from", () => {
  it("reads the x-task-id header", () => {
    expect(parseTaskId({ "x-task-id": "task-42" }, {})).toBe("task-42");
  });

  it("reads the header case-insensitively", () => {
    expect(parseTaskId({ "X-Task-Id": "task-42" }, {})).toBe("task-42");
  });

  it("falls back to x-session-id", () => {
    expect(parseTaskId({ "x-session-id": "sess-1" }, {})).toBe("sess-1");
  });

  it("reads metadata.taskId from the body", () => {
    expect(parseTaskId({}, { metadata: { taskId: "task-7" } })).toBe("task-7");
  });

  it("returns null when nothing names a task", () => {
    expect(parseTaskId({}, {})).toBeNull();
    expect(parseTaskId(null, null)).toBeNull();
  });
});

describe("the task label reaches the usage row", () => {
  it("stores the task id on the usage row", async () => {
    saveUsageStats({
      provider: "some-provider",
      model: "some-model",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      connectionId: "conn-1",
      apiKey: "key-1",
      taskId: "task-42",
    });
    await flush();

    expect(insertArgs).toBeDefined();
    expect(insertArgs).toContain("task-42");
  });

  it("stores null when the request named no task", async () => {
    saveUsageStats({
      provider: "some-provider",
      model: "some-model",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      connectionId: "conn-1",
      apiKey: "key-1",
    });
    await flush();

    expect(insertArgs).toBeDefined();
    expect(insertArgs[insertArgs.length - 1]).toBeNull();
  });
});

describe("requestObservability carries the task id", () => {
  it("passes the task id from clientRawRequest", () => {
    const obs = requestObservability({ taskId: "task-9", projectName: "p" });
    expect(obs.taskId).toBe("task-9");
  });

  it("defaults to null", () => {
    expect(requestObservability({}).taskId).toBeNull();
    expect(requestObservability(null).taskId).toBeNull();
  });
});
