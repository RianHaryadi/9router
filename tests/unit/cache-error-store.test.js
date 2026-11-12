import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  storeIdempotency,
  storeSemantic,
  lookupIdempotency,
  lookupSemantic,
  __resetForTests,
} from "../../src/custom/wiring/serveCache.js";

// Fork (T6): an error response must never become a cached result. A stored
// 500 would be replayed for the whole TTL of the key, so a transient upstream
// failure would look permanent to the client.
//
// The real request flow is: lookupIdempotency() claims the key, the upstream
// call runs, then captureAndStore() stores the outcome. The tests below
// follow that same order.

const BODY = { model: "gpt-5.6", messages: [{ role: "user", content: "hi" }] };

beforeEach(() => {
  __resetForTests();
});
afterEach(() => {
  __resetForTests();
});

describe("T6 — cache never stores an error", () => {
  it("does not replay an error response under the idempotency key", () => {
    // Request 1: claim, then fail upstream.
    lookupIdempotency({ idempotencyKey: "key-1", body: BODY });
    storeIdempotency({
      idempotencyKey: "key-1",
      body: BODY,
      bodyText: '{"error":"upstream exploded"}',
      headers: {},
      status: 500,
    });

    // Request 2 with the same key must NOT be served the stored error.
    const retry = lookupIdempotency({ idempotencyKey: "key-1", body: BODY });
    expect(retry?.type).not.toBe("replay");
  });

  it("releases the claim so a later retry is not rejected as in-progress", () => {
    lookupIdempotency({ idempotencyKey: "key-2", body: BODY });

    storeIdempotency({
      idempotencyKey: "key-2",
      body: BODY,
      bodyText: '{"error":"boom"}',
      headers: {},
      status: 502,
    });

    // The retry must be allowed to run again (seq 1), not rejected as a
    // concurrent request with the same key.
    const retry = lookupIdempotency({ idempotencyKey: "key-2", body: BODY });
    expect(retry).toMatchObject({ type: "in-progress", seq: 1 });
  });

  it("does not store an empty body", () => {
    lookupIdempotency({ idempotencyKey: "key-3", body: BODY });
    storeIdempotency({
      idempotencyKey: "key-3",
      body: BODY,
      bodyText: "",
      headers: {},
      status: 200,
    });

    const retry = lookupIdempotency({ idempotencyKey: "key-3", body: BODY });
    expect(retry?.type).not.toBe("replay");
  });

  it("still stores a successful response for replay", () => {
    lookupIdempotency({ idempotencyKey: "key-4", body: BODY });
    storeIdempotency({
      idempotencyKey: "key-4",
      body: BODY,
      bodyText: '{"ok":true}',
      headers: { "content-type": "application/json" },
      status: 200,
    });

    const found = lookupIdempotency({ idempotencyKey: "key-4", body: BODY });
    expect(found).toMatchObject({ type: "replay" });
    expect(found.value.bodyText).toBe('{"ok":true}');
  });

  it("does not store an error in the semantic cache", () => {
    storeSemantic({
      body: BODY,
      model: "gpt-5.6",
      bodyText: '{"error":"nope"}',
      headers: {},
      status: 429,
    });

    expect(lookupSemantic({ body: BODY, model: "gpt-5.6" })).toBeNull();
  });

  it("still stores a successful response in the semantic cache", () => {
    storeSemantic({
      body: BODY,
      model: "gpt-5.6",
      bodyText: '{"ok":true}',
      headers: {},
      status: 200,
    });

    expect(lookupSemantic({ body: BODY, model: "gpt-5.6" })).toMatchObject({ type: "replay" });
  });

  it("does not release a claim made for a different body", () => {
    lookupIdempotency({ idempotencyKey: "key-5", body: BODY });
    const otherBody = { model: "gpt-5.6", messages: [{ role: "user", content: "different" }] };

    storeIdempotency({
      idempotencyKey: "key-5",
      body: otherBody,
      bodyText: '{"error":"boom"}',
      headers: {},
      status: 500,
    });

    // The original claim survives — a release must not cancel somebody
    // else's claim.
    const found = lookupIdempotency({ idempotencyKey: "key-5", body: BODY });
    expect(found).toMatchObject({ type: "in-progress" });
  });
});
