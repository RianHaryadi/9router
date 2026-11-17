// T3 — Fallback chain logging: request identity (requestId + project) and the
// chain of events one inbound request produces, at three levels:
//   1. the pure helpers (requestContext.js),
//   2. combo.js member rotation through the `onFallback` callback (option A —
//      open-sse stays DB-free, the caller persists),
//   3. handleChat end to end with mocked auth/chatCore and a REAL temp DB, so
//      the payload chat.js writes to fallbackEvents is asserted for real.
import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Lifted above the imports (vi.hoisted runs first) so the data dir is fixed
// before any module resolves it: the DB this file opens is a throwaway under
// /tmp/opencode, never the real ~/.9router.
const DATA_DIR = vi.hoisted(() => {
  process.env.DATA_DIR = `/tmp/opencode/9router-t3-${process.pid}`;
  return process.env.DATA_DIR;
});

const fx = vi.hoisted(() => ({
  combos: [{ id: "c1", name: "Main", models: ["openai/model-a", "openai/model-b"] }],
  keys: {},
}));
const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  handleChatCore: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: false, comboStrategy: "fallback" }),
  getModelAliases: async () => ({}),
  getComboByName: async (name) => fx.combos.find((c) => c.name === name) || null,
  getProviderNodes: async () => [],
  getCombos: async () => fx.combos,
  getProviderConnections: async () => [],
  getProviderConnectionById: async () => null,
  getCustomModels: async () => [],
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => fx.combos }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async (k) => fx.keys[k] || null }));
vi.mock("@/lib/usageDb.js", () => ({ saveRequestUsage: vi.fn() }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: vi.fn(),
  extractApiKey: (request) => {
    const a = request.headers.get("Authorization");
    return a?.startsWith("Bearer ") ? a.slice(7) : request.headers.get("x-api-key");
  },
  isValidApiKey: async () => true,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: async (_p, c) => c,
  updateProviderCredentials: vi.fn(),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));

import { resolveProjectName, createRequestId } from "../../src/sse/services/requestContext.js";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { handleChat } from "../../src/sse/handlers/chat.js";
import { getFallbackEvents, getFallbackSummary } from "../../src/lib/db/repos/fallbackRepo.js";
import { getAdapter } from "../../src/lib/db/driver.js";

const silentLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function validationError(message = "Request validation failed") {
  return jsonResponse({ error: { message, type: "invalid_request_error" } }, 400);
}

const post = (path, body, key, extra = {}) => new Request(`http://localhost${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}), ...extra },
  body: JSON.stringify(body),
});

const chat = (model, key, extra) => handleChat(post(
  "/v1/chat/completions",
  { model, stream: false, messages: [{ role: "user", content: "hi" }] },
  key,
  extra,
));

// The DB layer must be up before any handleChat runs (chat.js refuses to let a
// fallback log be what opens the database — see logFallbackEvent).
beforeAll(async () => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  await getAdapter();
});

beforeEach(() => {
  vi.clearAllMocks();
  fx.keys = {
    "sk-open": { id: "o", name: "open", isActive: true, access: { restricted: false, allow: [] } },
  };
  mocks.getProviderCredentials.mockResolvedValue({ connectionId: "conn-1", connectionName: "first" });
  mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });
  mocks.handleChatCore.mockResolvedValue({ success: true, response: new Response("ok", { status: 200 }) });
});

afterAll(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

describe("resolveProjectName", () => {
  it("prefers the x-9router-project header over the API key name", () => {
    const headers = new Headers({ "x-9router-project": "  acme-web  " });
    expect(resolveProjectName(headers, "my-key")).toBe("acme-web");
  });

  it("reads the header case-insensitively from a plain header object too", () => {
    expect(resolveProjectName({ "X-9Router-Project": "Plain-Object" }, null)).toBe("Plain-Object");
    expect(resolveProjectName(new Headers({ "X-9ROUTER-PROJECT": "Headers-Object" }), null)).toBe("Headers-Object");
  });

  it("falls back to the API key name when no header is sent", () => {
    expect(resolveProjectName(new Headers(), "  key-name  ")).toBe("key-name");
    expect(resolveProjectName(null, "key-name")).toBe("key-name");
  });

  it("falls back to 'unassigned' when nothing identifies a project", () => {
    expect(resolveProjectName(null, null)).toBe("unassigned");
    expect(resolveProjectName(new Headers(), undefined)).toBe("unassigned");
    expect(resolveProjectName({ "x-9router-project": "   " }, "  ")).toBe("unassigned");
  });

  it("trims and caps every candidate at 64 chars", () => {
    expect(resolveProjectName({ "x-9router-project": `  ${"p".repeat(100)}  ` }, null)).toHaveLength(64);
    expect(resolveProjectName(null, "k".repeat(80))).toHaveLength(64);
    expect(resolveProjectName(null, `  ${"k".repeat(80)}  `)).toHaveLength(64);
  });
});

describe("createRequestId", () => {
  it("produces a non-empty string", () => {
    const id = createRequestId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(4);
  });

  it("is unique across rapid successive calls", () => {
    const ids = new Set();
    for (let i = 0; i < 2000; i++) ids.add(createRequestId());
    expect(ids.size).toBe(2000);
  });
});

describe("combo member rotation reports every switch (onFallback)", () => {
  it("names the failed member and the next one", async () => {
    const onFallback = vi.fn();
    const handleSingleModel = vi.fn(async (_b, modelStr) => (
      modelStr === "provider-a/model-a" ? validationError() : jsonResponse({ choices: [{ message: { content: "served" } }] })
    ));

    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["provider-a/model-a", "provider-b/model-b"],
      handleSingleModel,
      log: silentLog,
      comboStrategy: "fallback",
      requestId: "req-1",
      projectName: "acme",
      apiKey: "sk-test",
      onFallback,
    });

    expect(result.status).toBe(200);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback.mock.calls[0][0]).toMatchObject({
      requestId: "req-1",
      projectName: "acme",
      apiKey: "sk-test",
      provider: "provider-a",
      model: "model-a",
      fromProvider: "provider-b",
      fromModel: "model-b",
      status: 400,
    });
    expect(onFallback.mock.calls[0][0].reason).toContain("validation");
    expect(typeof onFallback.mock.calls[0][0].latencyMs).toBe("number");
  });

  it("keeps the chain ordered across several members", async () => {
    const onFallback = vi.fn();
    const handleSingleModel = vi.fn(async (_b, modelStr) => (
      modelStr === "provider-c/model-c"
        ? jsonResponse({ choices: [{ message: { content: "served by c" } }] })
        : validationError(`${modelStr} rejected it`)
    ));

    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["provider-a/model-a", "provider-b/model-b", "provider-c/model-c"],
      handleSingleModel,
      log: silentLog,
      comboStrategy: "fallback",
      onFallback,
    });

    expect(result.status).toBe(200);
    expect(onFallback.mock.calls.map(([e]) => [e.provider, e.model, e.fromProvider, e.fromModel])).toEqual([
      ["provider-a", "model-a", "provider-b", "model-b"],
      ["provider-b", "model-b", "provider-c", "model-c"],
    ]);
  });

  it("marks the last candidate's failure with fromProvider 'next'", async () => {
    const onFallback = vi.fn();
    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["provider-a/model-a"],
      handleSingleModel: vi.fn(async () => validationError()),
      log: silentLog,
      comboStrategy: "fallback",
      onFallback,
    });

    expect(result.status).toBe(400);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback.mock.calls[0][0]).toMatchObject({
      provider: "provider-a",
      model: "model-a",
      fromProvider: "next",
      fromModel: null,
      status: 400,
    });
  });

  it("never fires when the first member serves the request", async () => {
    const onFallback = vi.fn();
    await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["provider-a/model-a", "provider-b/model-b"],
      handleSingleModel: vi.fn(async () => jsonResponse({ choices: [{ message: { content: "ok" } }] })),
      log: silentLog,
      comboStrategy: "fallback",
      onFallback,
    });
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("stays quiet when no callback is passed", async () => {
    const handleSingleModel = vi.fn(async () => validationError());
    await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["provider-a/model-a", "provider-b/model-b"],
      handleSingleModel,
      log: silentLog,
      comboStrategy: "fallback",
    });
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });
});

describe("handleChat writes the fallback chain (real temp DB)", () => {
  it("logs the account rotation with requestId, project, cooldown and latency", async () => {
    mocks.getProviderCredentials.mockImplementation(async (_p, exclude) => (
      exclude.has("conn-1")
        ? { connectionId: "conn-2", connectionName: "second" }
        : { connectionId: "conn-1", connectionName: "first" }
    ));
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 4242 });

    const snapshots = [];
    let attempts = 0;
    mocks.handleChatCore.mockImplementation(async (opts) => {
      snapshots.push({ ...opts.clientRawRequest });
      attempts += 1;
      return attempts === 1
        ? { success: false, status: 429, error: "rate limited by upstream", response: new Response("nope", { status: 429 }) }
        : { success: true, response: new Response("ok", { status: 200 }) };
    });

    const res = await chat("openai/model-a", "sk-open", { "x-9router-project": "  acme-web  " });
    expect(res.status).toBe(200);
    expect(snapshots).toHaveLength(2);

    const events = await getFallbackEvents({ limit: 50 });
    expect(events).toHaveLength(1);
    const evt = events[0];
    expect(evt).toMatchObject({
      projectName: "acme-web",
      provider: "openai",
      model: "model-a",
      connectionId: "conn-1",
      // The stored row carries the key FINGERPRINT, never the raw key: a DB
      // file or backup must not carry the team's secret.
      apiKey: "360fe086f853eba4",
      fromProvider: "openai",
      fromModel: "model-a",
      status: 429,
      reason: "rate limited by upstream",
      cooldownMs: 4242,
    });
    expect(typeof evt.requestId).toBe("string");
    expect(evt.requestId.length).toBeGreaterThan(4);
    expect(Number(evt.latencyMs)).toBeGreaterThanOrEqual(0);

    // The meta rides on clientRawRequest — the object chatCore hands to the
    // usage-saving handlers — so usageHistory gets the same id/project/count.
    expect(snapshots[0].requestId).toBe(evt.requestId);
    expect(snapshots[0].projectName).toBe("acme-web");
    expect(snapshots[0].fallbackCount).toBe(0);
    expect(snapshots[1].requestId).toBe(evt.requestId);
    expect(snapshots[1].projectName).toBe("acme-web");
    expect(snapshots[1].fallbackCount).toBe(1);

    const summary = await getFallbackSummary({});
    expect(summary.total).toBeGreaterThanOrEqual(1);
    expect(summary.byProvider.openai).toBeGreaterThanOrEqual(1);
  });

  it("logs a combo member switch through onFallback with the request identity", async () => {
    const snapshots = [];
    let attempts = 0;
    mocks.handleChatCore.mockImplementation(async (opts) => {
      snapshots.push({ ...opts.clientRawRequest });
      attempts += 1;
      return attempts === 1
        ? {
          success: false,
          status: 500,
          error: "upstream error",
          response: jsonResponse({ error: { message: "upstream error" } }, 500),
        }
        : { success: true, response: new Response("ok", { status: 200 }) };
    });

    const res = await chat("Main", "sk-open", { "x-9router-project": "acme" });
    expect(res.status).toBe(200);
    expect(snapshots).toHaveLength(2);

    const events = await getFallbackEvents({ limit: 50 });
    const evt = events.find((e) => e.model === "model-a" && e.projectName === "acme");
    expect(evt).toBeTruthy();
    expect(evt).toMatchObject({
      projectName: "acme",
      provider: "openai",
      model: "model-a",
      fromProvider: "openai",
      fromModel: "model-b",
      status: 500,
      reason: "upstream error",
      apiKey: "360fe086f853eba4",
    });
    expect(evt.requestId).toBe(snapshots[0].requestId);
    expect(snapshots[1].fallbackCount).toBe(1);
    expect(snapshots[1].requestId).toBe(snapshots[0].requestId);
  });

  it("attributes the project to the API key name without the header, else 'unassigned'", async () => {
    const snapshots = [];
    mocks.handleChatCore.mockImplementation(async (opts) => {
      snapshots.push({ ...opts.clientRawRequest });
      return { success: true, response: new Response("ok", { status: 200 }) };
    });

    await chat("openai/model-a", "sk-open");
    await chat("openai/model-a", "sk-unknown-key");

    expect(snapshots[0].projectName).toBe("open"); // apiKeys.name fallback
    expect(snapshots[1].projectName).toBe("unassigned");
  });
});
