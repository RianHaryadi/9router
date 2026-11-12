/**
 * Unit tests: src/custom/wiring/serveCache.js
 * Injected clocks/fakes only — no DB, no network.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetForTests,
  getResponseCache,
  lookupIdempotency,
  lookupSemantic,
  storeIdempotency,
  storeSemantic,
  captureAndStore,
  shouldServeCache,
} from "../../src/custom/wiring/serveCache.js";

const HEADERS = { "content-type": "application/json" };

// Fresh singleton per test.
beforeEach(() => {
  __resetForTests();
});

// ---------- getResponseCache / __resetForTests ----------

describe("getResponseCache", () => {
  it("returns a working facade singleton", () => {
    const c = getResponseCache();
    expect(typeof c.getSemantic).toBe("function");
    expect(typeof c.claimIdempotency).toBe("function");
    expect(c.stats().semantic.size).toBe(0);
  });

  it("__resetForTests drops state (singleton is recreated empty)", () => {
    getResponseCache().setSemantic({ model: "m" }, "v");
    expect(getResponseCache().getSemantic({ model: "m" })).not.toBeNull();
    __resetForTests();
    expect(getResponseCache().getSemantic({ model: "m" })).toBeNull();
  });
});

// ---------- lookupIdempotency ----------

describe("lookupIdempotency", () => {
  it("returns null when no idempotencyKey", () => {
    expect(lookupIdempotency({ idempotencyKey: null, body: { a: 1 } })).toBeNull();
    expect(lookupIdempotency({ idempotencyKey: "", body: { a: 1 } })).toBeNull();
    expect(lookupIdempotency({})).toBeNull();
  });

  it("first claim → in-progress with seq 1", () => {
    const r = lookupIdempotency({ idempotencyKey: "k1", body: { model: "m" } });
    expect(r).toEqual({ type: "in-progress", seq: 1 });
  });

  it("second claim with same digest → in-progress seq 2 (concurrent)", () => {
    const key = "k2";
    lookupIdempotency({ idempotencyKey: key, body: { model: "m" } });
    const r = lookupIdempotency({ idempotencyKey: key, body: { model: "m" } });
    expect(r).toEqual({ type: "in-progress", seq: 2 });
  });

  it("completed key with same digest → replay with stored value", () => {
    const key = "k3";
    const body = { model: "m", messages: [] };
    lookupIdempotency({ idempotencyKey: key, body }); // claim
    storeIdempotency({
      idempotencyKey: key,
      body,
      bodyText: "final answer",
      headers: HEADERS,
      status: 200,
    });
    const r = lookupIdempotency({ idempotencyKey: key, body });
    expect(r).toEqual({
      type: "replay",
      value: { bodyText: "final answer", headers: HEADERS, status: 200 },
    });
  });

  it("completed key with different digest → conflict with expectedDigest", () => {
    const key = "k4";
    const bodyA = { model: "m", messages: [{ role: "user", content: "a" }] };
    const bodyB = { model: "m", messages: [{ role: "user", content: "b" }] };
    lookupIdempotency({ idempotencyKey: key, body: bodyA });
    storeIdempotency({ idempotencyKey: key, body: bodyA, bodyText: "x", headers: HEADERS, status: 200 });
    const r = lookupIdempotency({ idempotencyKey: key, body: bodyB });
    expect(r.type).toBe("conflict");
    expect(r.expectedDigest).toBeTypeOf("string");
    expect(r.expectedDigest.length).toBeGreaterThan(0);
  });

  it("digest is stable across object key order", () => {
    const key = "k5";
    lookupIdempotency({ idempotencyKey: key, body: { model: "m", temperature: 1 } });
    const r = lookupIdempotency({ idempotencyKey: key, body: { temperature: 1, model: "m" } });
    expect(r).toEqual({ type: "in-progress", seq: 2 });
  });
});

// ---------- storeIdempotency ----------

describe("storeIdempotency", () => {
  it("is a no-op when idempotencyKey is missing", () => {
    expect(storeIdempotency({ idempotencyKey: null, body: {}, bodyText: "x" })).toBeUndefined();
    expect(getResponseCache().stats().idempotency.size).toBe(0);
  });

  it("stores value retrievable via getIdempotency", () => {
    const body = { model: "m" };
    lookupIdempotency({ idempotencyKey: "k6", body });
    storeIdempotency({
      idempotencyKey: "k6",
      body,
      bodyText: "stored",
      headers: HEADERS,
      status: 200,
    });
    const got = getResponseCache().getIdempotency("k6");
    expect(got.status).toBe("completed");
    expect(got.value.bodyText).toBe("stored");
  });

  it("completing an unclaimed key returns false (no crash, no entry)", () => {
    storeIdempotency({ idempotencyKey: "ghost", body: {}, bodyText: "x" });
    expect(getResponseCache().getIdempotency("ghost").status).toBe("missing");
  });
});

// ---------- lookupSemantic / storeSemantic ----------

describe("lookupSemantic", () => {
  it("miss → null on empty cache", () => {
    expect(lookupSemantic({ body: { model: "m", messages: [] } })).toBeNull();
  });

  it("hit → replay with stored value", () => {
    const body = { model: "gpt", messages: [{ role: "user", content: "hi" }] };
    storeSemantic({ body, model: "gpt", bodyText: "hello!", headers: HEADERS, status: 200 });
    const r = lookupSemantic({ body });
    expect(r).not.toBeNull();
    expect(r.type).toBe("replay");
    expect(r.value.value).toBe("hello!");
    expect(r.value.status).toBe(200);
  });

  it("model mismatch → treated as miss", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    storeSemantic({ body, model: "gpt-4", bodyText: "for gpt-4", headers: HEADERS, status: 200 });
    const r = lookupSemantic({ body, model: "gpt-4o" });
    expect(r).toBeNull();
    // ...but same model still hits
    expect(lookupSemantic({ body, model: "gpt-4" })).not.toBeNull();
  });

  it("case-sensitive model compare", () => {
    const body = { messages: [] };
    storeSemantic({ body, model: "GPT-4", bodyText: "v", headers: HEADERS, status: 200 });
    expect(lookupSemantic({ body, model: "gpt-4" })).toBeNull();
  });

  it("entry stored without model scope matches any request model", () => {
    const body = { messages: [] };
    storeSemantic({ body, bodyText: "unscoped", headers: HEADERS, status: 200 });
    expect(lookupSemantic({ body, model: "anything" })).not.toBeNull();
  });
});

describe("storeSemantic", () => {
  it("skips storing on status >= 400", () => {
    const body = { model: "m", messages: [] };
    for (const status of [400, 401, 429, 500, 503]) {
      storeSemantic({ body, bodyText: "err", headers: HEADERS, status });
    }
    expect(lookupSemantic({ body })).toBeNull();
  });

  it("skips storing when bodyText is empty", () => {
    const body = { model: "m", messages: [] };
    storeSemantic({ body, bodyText: "", headers: HEADERS, status: 200 });
    storeSemantic({ body, bodyText: undefined, headers: HEADERS, status: 200 });
    storeSemantic({ body, bodyText: null, headers: HEADERS, status: 200 });
    expect(lookupSemantic({ body })).toBeNull();
  });

  it("stores on 2xx/3xx status", () => {
    const body = { model: "m", messages: [] };
    storeSemantic({ body, bodyText: "ok", headers: HEADERS, status: 201 });
    expect(lookupSemantic({ body })).not.toBeNull();
  });
});

// ---------- captureAndStore (end-to-end with real Response) ----------

describe("captureAndStore", () => {
  async function makeStreamResponse(chunks, { status = 200, headers = HEADERS } = {}) {
    const stream = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });
    return new Response(stream, { status, headers });
  }

  it("streams to client AND stores into semantic cache", async () => {
    const body = { model: "gpt", messages: [{ role: "user", content: "stream me" }] };
    const resp = await makeStreamResponse(["data: a\n\n", "data: b\n\n"]);

    const returned = captureAndStore({
      response: resp,
      body,
      idempotencyKey: null,
      model: "gpt",
    });

    expect(await returned.text()).toBe("data: a\n\ndata: b\n\n");

    // storage is async — wait for it
    await new Promise((r) => setTimeout(r, 10));
    const hit = lookupSemantic({ body, model: "gpt" });
    expect(hit).not.toBeNull();
    expect(hit.value.value).toBe("data: a\n\ndata: b\n\n");
    expect(hit.value.status).toBe(200);
  });

  it("stores into idempotency when key given", async () => {
    const body = { model: "gpt", messages: [{ role: "user", content: "idem" }] };
    const key = "cap-1";
    lookupIdempotency({ idempotencyKey: key, body }); // claim

    const resp = await makeStreamResponse(["chunk"]);
    const returned = captureAndStore({ response: resp, body, idempotencyKey: key, model: "gpt" });
    await returned.text();

    await new Promise((r) => setTimeout(r, 10));
    const r = lookupIdempotency({ idempotencyKey: key, body });
    expect(r).toEqual({
      type: "replay",
      value: { bodyText: "chunk", headers: HEADERS, status: 200 },
    });
  });

  it("non-streaming response is stored too", async () => {
    const body = { model: "gpt", messages: [] };
    const resp = new Response('{"choices":[]}', { status: 200, headers: HEADERS });
    const returned = captureAndStore({ response: resp, body, idempotencyKey: null, model: "gpt" });
    expect(await returned.text()).toBe('{"choices":[]}');

    await new Promise((r) => setTimeout(r, 10));
    const hit = lookupSemantic({ body, model: "gpt" });
    expect(hit).not.toBeNull();
    expect(hit.value.value).toBe('{"choices":[]}');
  });

  it("error status is streamed to client but NOT cached", async () => {
    const body = { model: "gpt", messages: [] };
    const resp = new Response("upstream exploded", { status: 500 });
    const returned = captureAndStore({ response: resp, body, idempotencyKey: null, model: "gpt" });
    expect(returned.status).toBe(500);
    expect(await returned.text()).toBe("upstream exploded");

    await new Promise((r) => setTimeout(r, 10));
    expect(lookupSemantic({ body })).toBeNull();
  });

  it("full request flow: miss → capture → second call replays", async () => {
    const body = { model: "gpt", messages: [{ role: "user", content: "twice" }] };
    // 1. miss
    expect(lookupSemantic({ body, model: "gpt" })).toBeNull();

    // 2. upstream + capture
    const resp = await makeStreamResponse(["data: once\n\n"]);
    await captureAndStore({ response: resp, body, idempotencyKey: null, model: "gpt" }).text();
    await new Promise((r) => setTimeout(r, 10));

    // 3. hit
    const hit = lookupSemantic({ body, model: "gpt" });
    expect(hit.type).toBe("replay");
    expect(hit.value.value).toBe("data: once\n\n");
  });
});

// ---------- shouldServeCache ----------

describe("shouldServeCache", () => {
  it("true only for POST on /chat/completions paths", () => {
    expect(shouldServeCache({ method: "POST", path: "/v1/chat/completions" })).toBe(true);
    expect(shouldServeCache({ method: "post", path: "/openai/v1/chat/completions" })).toBe(true);
  });

  it("false for non-chat paths", () => {
    expect(shouldServeCache({ method: "POST", path: "/v1/models" })).toBe(false);
    expect(shouldServeCache({ method: "POST", path: "/v1/embeddings" })).toBe(false);
  });

  it("false for non-POST methods", () => {
    expect(shouldServeCache({ method: "GET", path: "/v1/chat/completions" })).toBe(false);
    expect(shouldServeCache({ method: "OPTIONS", path: "/v1/chat/completions" })).toBe(false);
  });

  it("false for missing inputs", () => {
    expect(shouldServeCache({})).toBe(false);
    expect(shouldServeCache({ method: "POST" })).toBe(false);
    expect(shouldServeCache({ path: "/v1/chat/completions" })).toBe(false);
  });
});
