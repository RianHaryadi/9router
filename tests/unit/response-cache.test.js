/**
 * Unit tests: src/custom/wiring/responseCache.js
 *
 * Covers digest stability, stream tee-capture (async), non-stream clone path,
 * replay headers, and the semantic/idempotency facade.
 */
import { describe, it, expect, vi } from "vitest";
import {
  digestBody,
  captureStreamResponse,
  replayResponse,
  createResponseCache,
} from "../../src/custom/wiring/responseCache.js";

// ---------- digestBody ----------

describe("digestBody", () => {
  it("returns a 64-char hex string", () => {
    const d = digestBody({ model: "x", messages: [] });
    expect(d).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is stable for equal bodies regardless of key order", () => {
    const a = digestBody({ model: "m", messages: [{ role: "user", content: "hi" }], temperature: 0.5 });
    const b = digestBody({ temperature: 0.5, messages: [{ role: "user", content: "hi" }], model: "m" });
    expect(a).toBe(b);
  });

  it("differs when body content differs", () => {
    expect(digestBody({ model: "m" })).not.toBe(digestBody({ model: "other" }));
  });

  it("hashes strings directly", () => {
    const d = digestBody("plain string body");
    expect(d).toMatch(/^[a-f0-9]{64}$/);
    expect(digestBody("plain string body")).toBe(d);
  });

  it("handles null/undefined", () => {
    expect(digestBody(null)).toBe(digestBody(undefined));
    expect(digestBody(null)).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ---------- captureStreamResponse: streaming (tee) ----------

describe("captureStreamResponse (streaming)", () => {
  async function makeStreamResponse(chunks, { status = 200, headers = { "content-type": "text/event-stream" } } = {}) {
    const stream = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });
    return new Response(stream, { status, headers });
  }

  it("tees the stream: client gets identical bytes, onCaptured gets full text + meta", async () => {
    const captured = vi.fn();
    const resp = await makeStreamResponse(["data: one\n\n", "data: two\n\n"]);

    const returned = captureStreamResponse(resp, captured);

    // Returned response is a NEW Response with its own readable body.
    expect(returned).toBeInstanceOf(Response);
    expect(returned.status).toBe(200);
    expect(returned.headers.get("content-type")).toBe("text/event-stream");

    const clientText = await returned.text();
    expect(clientText).toBe("data: one\n\ndata: two\n\n");

    // Wait for async cache-side read to finish.
    await vi.waitFor(() => expect(captured).toHaveBeenCalledTimes(1));
    const [text, meta] = captured.mock.calls[0];
    expect(text).toBe("data: one\n\ndata: two\n\n");
    expect(meta.status).toBe(200);
    expect(meta.headers["content-type"]).toBe("text/event-stream");
  });

  it("preserves status and custom headers on the client-side response", async () => {
    const captured = vi.fn();
    const resp = await makeStreamResponse(["x"], { status: 418, headers: { "x-foo": "bar" } });

    const returned = captureStreamResponse(resp, captured);
    expect(returned.status).toBe(418);
    expect(returned.headers.get("x-foo")).toBe("bar");
    await returned.text(); // drain
  });

  it("client stream remains independently readable after capture", async () => {
    const captured = vi.fn();
    const resp = await makeStreamResponse(["a", "b", "c"]);
    const returned = captureStreamResponse(resp, captured);
    const r1 = returned.text();
    await vi.waitFor(() => expect(captured).toHaveBeenCalledTimes(1));
    expect(await r1).toBe("abc");
  });
});

// ---------- captureStreamResponse: non-streaming ----------

describe("captureStreamResponse (non-streaming)", () => {
  it("captures via clone().text() and returns the original response (no body)", async () => {
    const captured = vi.fn();
    const resp = new Response(null, {
      status: 201,
      headers: { "content-type": "application/json" },
    });

    const returned = captureStreamResponse(resp, captured);
    expect(returned).toBe(resp); // original returned untouched

    await vi.waitFor(() => expect(captured).toHaveBeenCalledTimes(1));
    const [text, meta] = captured.mock.calls[0];
    expect(text).toBe("");
    expect(meta.status).toBe(201);
    expect(meta.headers["content-type"]).toBe("application/json");
  });

  it("original string-body response stays fully readable after capture", async () => {
    const captured = vi.fn();
    const resp = new Response('{"a":1}');
    const returned = captureStreamResponse(resp, captured);
    expect(await returned.text()).toBe('{"a":1}');
    await vi.waitFor(() => expect(captured).toHaveBeenCalledTimes(1));
  });
});

// ---------- captureStreamResponse: fail-open ----------

describe("captureStreamResponse (fail-open)", () => {
  it("never throws when onCaptured throws", async () => {
    const resp = new Response("boom");
    const returned = captureStreamResponse(resp, () => {
      throw new Error("capture callback exploded");
    });
    expect(await returned.text()).toBe("boom");
    // give the microtask a tick to prove no unhandled rejection path breaks read
    await new Promise((r) => setTimeout(r, 5));
  });

  it("returns original response for null/undefined input", () => {
    expect(captureStreamResponse(null, () => {})).toBeNull();
    expect(captureStreamResponse(undefined, () => {})).toBeUndefined();
  });

  it("stream read failure still delivers client stream", async () => {
    const captured = vi.fn();
    const resp = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("ok"));
          controller.close();
        },
      }),
      { status: 200 },
    );
    const returned = captureStreamResponse(resp, captured);
    expect(await returned.text()).toBe("ok");
    await vi.waitFor(() => expect(captured).toHaveBeenCalledTimes(1));
    expect(captured.mock.calls[0][0]).toBe("ok");
  });
});

// ---------- replayResponse ----------

describe("replayResponse", () => {
  it("rebuilds a Response with body, status, and x-9router-cache tag", async () => {
    const resp = replayResponse({
      bodyText: "cached body",
      status: 200,
      headers: { "content-type": "application/json" },
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toBe("application/json");
    expect(resp.headers.get("x-9router-cache")).toBe("semantic");
    expect(await resp.text()).toBe("cached body");
  });

  it("defaults to status 200 and cacheType 'semantic'", () => {
    const resp = replayResponse({ bodyText: "x" });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-9router-cache")).toBe("semantic");
  });

  it("honors custom cacheType (idempotency)", () => {
    const resp = replayResponse({ bodyText: "x", cacheType: "idempotency" });
    expect(resp.headers.get("x-9router-cache")).toBe("idempotency");
  });

  it("does not mutate the passed-in headers object", async () => {
    const headers = { "content-type": "text/plain" };
    const resp = replayResponse({ bodyText: "y", headers });
    await resp.text();
    expect(headers["x-9router-cache"]).toBeUndefined();
  });
});

// ---------- createResponseCache ----------

describe("createResponseCache", () => {
  it("getSemantic misses on empty cache, hits after setSemantic (same fingerprint)", () => {
    const rc = createResponseCache();
    const body = { model: "gpt", messages: [{ role: "user", content: "hi" }] };
    expect(rc.getSemantic(body)).toBeNull();

    rc.setSemantic(body, "cached-value", {
      headers: { "content-type": "application/json" },
      status: 200,
    });

    const hit = rc.getSemantic({ messages: [{ role: "user", content: "hi" }], model: "gpt" });
    expect(hit).not.toBeNull();
    expect(hit.value).toBe("cached-value");
    expect(hit.status).toBe(200);
    expect(hit.headers["content-type"]).toBe("application/json");
  });

  it("getSemantic misses when body differs", () => {
    const rc = createResponseCache();
    rc.setSemantic({ model: "a" }, "v1");
    expect(rc.getSemantic({ model: "b" })).toBeNull();
  });

  it("setSemantic records stats hits/misses", () => {
    const rc = createResponseCache();
    const body = { model: "m" };
    rc.getSemantic(body); // miss
    rc.setSemantic(body, "v");
    rc.getSemantic(body); // hit
    const s = rc.stats().semantic;
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
    expect(s.size).toBe(1);
  });

  it("idempotency: claim → complete → replay on second claim with same digest", () => {
    const rc = createResponseCache();
    const digest = digestBody({ model: "m", messages: [] });

    const first = rc.claimIdempotency("key-1", digest);
    expect(first.status).toBe("in-progress");

    const done = rc.completeIdempotency("key-1", digest, {
      bodyText: "result",
      headers: { "content-type": "application/json" },
      status: 200,
    });
    expect(done).toBe(true);

    const second = rc.claimIdempotency("key-1", digest);
    expect(second.status).toBe("completed");
    expect(second.value.bodyText).toBe("result");
    expect(second.value.status).toBe(200);
  });

  it("idempotency: different digest on same key → conflict", () => {
    const rc = createResponseCache();
    rc.claimIdempotency("k", "digest-a");
    rc.completeIdempotency("k", "digest-a", { bodyText: "x", status: 200 });

    const conflict = rc.claimIdempotency("k", "digest-b");
    expect(conflict.status).toBe("conflict");
    expect(conflict.expectedDigest).toBe("digest-a");
  });

  it("getIdempotency returns missing for unknown key", () => {
    const rc = createResponseCache();
    expect(rc.getIdempotency("nope")).toEqual({ status: "missing", seq: 0 });
  });

  it("stats() reports both stores", () => {
    const rc = createResponseCache();
    const s = rc.stats();
    expect(s.semantic).toEqual({ size: 0, hits: 0, misses: 0, evictions: 0 });
    expect(s.idempotency.size).toBe(0);
    expect(s.idempotency).toHaveProperty("completed");
    expect(s.idempotency).toHaveProperty("inProgress");
    expect(s.idempotency).toHaveProperty("evictions");
    expect(s.idempotency).toHaveProperty("conflicts");
  });

  it("clear() empties both stores", () => {
    const rc = createResponseCache();
    rc.setSemantic({ model: "m" }, "v");
    rc.claimIdempotency("k", "d");
    rc.clear();
    expect(rc.stats().semantic.size).toBe(0);
    expect(rc.stats().idempotency.size).toBe(0);
  });

  it("accepts semanticOpts/idempotencyOpts (e.g. custom ttlMs)", () => {
    let clock = 0;
    const rc = createResponseCache({
      semanticOpts: { ttlMs: 1000, now: () => clock },
      idempotencyOpts: { maxEntries: 8 },
    });
    const body = { model: "m" };
    rc.setSemantic(body, "v");
    expect(rc.getSemantic(body)).not.toBeNull();
    clock = 2000; // past ttl
    expect(rc.getSemantic(body)).toBeNull();
  });
});
