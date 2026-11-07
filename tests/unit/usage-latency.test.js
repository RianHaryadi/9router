// T3 — latencyMs / ttftMs / projectName / fallbackCount on usageHistory.
// Real temp DB (never the real ~/.9router): saveRequestUsage must persist the
// new observability columns, entries that omit them must keep inserting with
// the schema defaults, and saveUsageStats (the handler entry point) must map
// its optional latency/project/fallback args onto the entry.
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Lifted above the imports so the data dir is fixed before any module
// resolves it — a throwaway under /tmp/opencode, never the real ~/.9router.
const DATA_DIR = vi.hoisted(() => {
  process.env.DATA_DIR = `/tmp/opencode/9router-t3-usage-${process.pid}`;
  return process.env.DATA_DIR;
});

import * as db from "../../src/lib/db/index.js";
import { getAdapter } from "../../src/lib/db/driver.js";
import { requestObservability, saveUsageStats } from "../../open-sse/handlers/chatCore/requestDetail.js";

const SELECT = "SELECT latencyMs, ttftMs, projectName, fallbackCount FROM usageHistory WHERE model = ?";

beforeAll(async () => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  await db.initDb();
});

afterAll(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const rowsFor = async (model) => {
  const adapter = await getAdapter();
  return adapter.all(SELECT, [model]);
};

describe("saveRequestUsage latency/project attribution", () => {
  it("persists latencyMs, ttftMs, projectName and fallbackCount", async () => {
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      connectionId: "c1",
      apiKey: "sk-latency",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      endpoint: "/v1/chat",
      status: "ok",
      latencyMs: 1500,
      ttftMs: 250,
      projectName: "acme",
      fallbackCount: 2,
    });

    const rows = await rowsFor("gpt-4");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      latencyMs: 1500,
      ttftMs: 250,
      projectName: "acme",
      fallbackCount: 2,
    });
  });

  it("keeps inserting entries that predate the observability columns (defaults)", async () => {
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-3.5-turbo",
      connectionId: "c1",
      apiKey: "sk-old",
      tokens: { prompt_tokens: 7, completion_tokens: 3 },
      endpoint: "/v1/chat",
      status: "ok",
      // no latencyMs / ttftMs / projectName / fallbackCount — as callers did pre-T3
    });

    const rows = await rowsFor("gpt-3.5-turbo");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      latencyMs: 0,
      ttftMs: 0,
      projectName: null,
      fallbackCount: 0,
    });
  });

  it("maps latency {ttft,total} + project + fallbackCount through saveUsageStats", async () => {
    saveUsageStats({
      provider: "openai",
      model: "gpt-4o",
      connectionId: "c1",
      apiKey: "sk-handler",
      endpoint: "/v1/chat",
      silent: true,
      tokens: { prompt_tokens: 3, completion_tokens: 4 },
      latency: { ttft: 120, total: 980 },
      projectName: "acme",
      fallbackCount: 1,
      requestId: "req-1",
    });

    // saveUsageStats persists fire-and-forget; wait for the row to land.
    await vi.waitFor(async () => {
      const rows = await rowsFor("gpt-4o");
      expect(rows).toHaveLength(1);
    }, { timeout: 5000 });

    const rows = await rowsFor("gpt-4o");
    expect(rows[0]).toMatchObject({
      latencyMs: 980,
      ttftMs: 120,
      projectName: "acme",
      fallbackCount: 1,
    });
  });

  it("falls back to 0/null when saveUsageStats is called without observability args", async () => {
    saveUsageStats({
      provider: "openai",
      model: "gpt-4.1",
      connectionId: "c1",
      apiKey: "sk-plain",
      endpoint: "/v1/chat",
      silent: true,
      tokens: { prompt_tokens: 2, completion_tokens: 2 },
    });

    await vi.waitFor(async () => {
      const rows = await rowsFor("gpt-4.1");
      expect(rows).toHaveLength(1);
    }, { timeout: 5000 });

    const rows = await rowsFor("gpt-4.1");
    expect(rows[0]).toMatchObject({
      latencyMs: 0,
      ttftMs: 0,
      projectName: null,
      fallbackCount: 0,
    });
  });
});

describe("requestObservability (meta as it rides on clientRawRequest)", () => {
  it("reads the request's id, project and running fallback count", () => {
    expect(requestObservability({ requestId: "req-1", projectName: "acme", fallbackCount: 3 })).toEqual({
      requestId: "req-1",
      projectName: "acme",
      fallbackCount: 3,
    });
  });

  it("degrades to null/0 when chatCore was called without meta", () => {
    expect(requestObservability(null)).toEqual({ requestId: null, projectName: null, fallbackCount: 0 });
    expect(requestObservability({})).toEqual({ requestId: null, projectName: null, fallbackCount: 0 });
  });
});
