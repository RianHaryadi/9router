// T4 — error taxonomy (Layer 1): classify provider failures by scope
// (model/account/provider/none) and action so the breaker stops burning
// healthy accounts. Covers the pure classifier (rules table, nested-JSON
// 10605 parsing, billing regression guard), the key/cooldown helpers, and
// the wiring into src/sse/services/healthBreaker.js.
import { beforeEach, describe, expect, it } from "vitest";
import {
  breakerKeyFor,
  classifyError,
  cooldownFor,
  shouldCountTowardsBreaker,
} from "../../src/custom/guard/errorTaxonomy.js";
import {
  getSnapshot,
  getState,
  isBlockedFor,
  isOpen,
  listBlocked,
  recordFailure,
  recordSuccess,
  resetAll,
} from "../../src/sse/services/healthBreaker.js";

beforeEach(() => {
  resetAll();
});

// ---------------------------------------------------------------------------
// classifyError — the rules table
// ---------------------------------------------------------------------------

describe("classifyError — qoder queue (vendor 10605 family)", () => {
  it("qoder 503 queueType → queue / model / wait-progressing / 60s", () => {
    const c = classifyError({
      provider: "qoder",
      model: "mmodel",
      status: 503,
      errorText: "503 queueType=p4 waitTime=60s",
    });
    expect(c.kind).toBe("queue");
    expect(c.scope).toBe("model");
    expect(c.action).toBe("wait-progressing");
    expect(c.cooldownMs).toBe(60_000);
    expect(c.confidence).toBe("rule");
    expect(c.needsHuman).toBe(false);
  });

  it("detects 10605 inside JSON-inside-JSON-inside-JSON (max depth 4)", () => {
    const deep = JSON.stringify({
      error: JSON.stringify({
        payload: JSON.stringify({ code: 10605, message: "still queued" }),
      }),
    });
    const c = classifyError({ provider: "qoder", model: "smodel", status: 500, errorText: deep });
    expect(c.kind).toBe("queue");
    expect(c.scope).toBe("model");
    expect(c.action).toBe("wait-progressing");
    expect(c.cooldownMs).toBe(60_000);
  });

  it("10605 + CALL_COUNT_LIMIT → queue / model / EXCLUDE / 30m", () => {
    const c = classifyError({
      provider: "qoder",
      model: "dfmodel",
      status: 503,
      errorText: '{"code":10605,"message":"CALL_COUNT_LIMIT reached"}',
    });
    expect(c.kind).toBe("queue");
    expect(c.scope).toBe("model");
    expect(c.action).toBe("exclude");
    expect(c.cooldownMs).toBe(30 * 60_000);
  });

  it("REGRESSION: 10605 is never classified billing/rate-limit (issue #3510)", () => {
    const c = classifyError({
      provider: "qoder",
      status: 429,
      errorText: '{"error":{"code":10605,"message":"quota exceeded, billing pending"}}',
    });
    expect(c.kind).toBe("queue");
    expect(c.kind).not.toBe("billing");
    expect(c.kind).not.toBe("rate-limit");
    expect(c.action).toBe("wait-progressing");
  });
});

describe("classifyError — billing", () => {
  it("qoder code 110 → billing / account / exclude / 30m / needsHuman", () => {
    const c = classifyError({
      provider: "qoder",
      status: 400,
      errorText: '{"error":{"code":110,"message":"billing daily count exceeded"}}',
    });
    expect(c.kind).toBe("billing");
    expect(c.scope).toBe("account");
    expect(c.action).toBe("exclude");
    expect(c.cooldownMs).toBe(30 * 60_000);
    expect(c.needsHuman).toBe(true);
  });

  it("qoder code 112 → billing / account / exclude / needsHuman", () => {
    const c = classifyError({
      provider: "qoder",
      status: 400,
      errorText: '{"error":{"code":112,"message":"quota exhausted"}}',
    });
    expect(c.kind).toBe("billing");
    expect(c.scope).toBe("account");
    expect(c.action).toBe("exclude");
    expect(c.cooldownMs).toBe(30 * 60_000);
    expect(c.needsHuman).toBe(true);
  });

  it("status 402 (muse billing_not_configured) → billing / account / needs-human", () => {
    const c = classifyError({
      provider: "muse",
      status: 402,
      errorText:
        '{"error":{"code":"billing_not_configured","message":"Billing verification failed... https://dev.meta.ai/billing/?team_id=42"}}',
    });
    expect(c.kind).toBe("billing");
    expect(c.scope).toBe("account");
    expect(c.action).toBe("needs-human");
    expect(c.cooldownMs).toBe(30 * 60_000);
    expect(c.needsHuman).toBe(true);
  });

  it("status 403 with billing/quota/insufficient/pricingUrl → billing / account / needs-human", () => {
    const c = classifyError({
      provider: "muse",
      status: 403,
      errorText: "Insufficient balance — update payment method (pricingUrl)",
    });
    expect(c.kind).toBe("billing");
    expect(c.scope).toBe("account");
    expect(c.action).toBe("needs-human");
    expect(c.cooldownMs).toBe(30 * 60_000);
  });
});

describe("classifyError — auth / model / local bug", () => {
  it("status 401 → auth / account / exclude / 5m", () => {
    const c = classifyError({ provider: "openai", status: 401, errorText: "unauthorized" });
    expect(c.kind).toBe("auth");
    expect(c.scope).toBe("account");
    expect(c.action).toBe("exclude");
    expect(c.cooldownMs).toBe(5 * 60_000);
  });

  it("auth wording without401 (sign-in lapsed / Login expired / invalid_api_key)", () => {
    for (const text of [
      "sign-in lapsed, reconnect the account",
      "Login expired",
      '{"error":"invalid_api_key"}',
    ]) {
      const c = classifyError({ provider: "qoder", status: 400, errorText: text });
      expect(c.kind, text).toBe("auth");
      expect(c.scope, text).toBe("account");
      expect(c.action, text).toBe("exclude");
    }
  });

  it("status 404 → model-not-found / model / exclude / 10m", () => {
    const c = classifyError({
      provider: "antigravity",
      model: "gemini-9",
      status: 404,
      errorText: "Requested entity was not found",
    });
    expect(c.kind).toBe("model-not-found");
    expect(c.scope).toBe("model");
    expect(c.action).toBe("exclude");
    expect(c.cooldownMs).toBe(10 * 60_000);
  });

  it("status 400 model_config … not yet known → request-invalid / none / ignore / 0", () => {
    const c = classifyError({
      provider: "qoder",
      model: "ultimate",
      status: 400,
      errorText: 'model_config for "ultimate" not yet known',
    });
    expect(c.kind).toBe("request-invalid");
    expect(c.scope).toBe("none");
    expect(c.action).toBe("ignore");
    expect(c.cooldownMs).toBe(0);
    expect(c.confidence).toBe("rule");
  });

  it("same local bug wrapped in JSON still ignores", () => {
    const body = JSON.stringify({
      error: { code: 400, message: 'model_config for "auto" not yet known' },
    });
    const c = classifyError({ provider: "qoder", status: 400, errorText: body });
    expect(c.kind).toBe("request-invalid");
    expect(c.scope).toBe("none");
    expect(c.action).toBe("ignore");
  });
});

describe("classifyError — rate-limit / server / capacity / fallback", () => {
  it("status 429 → rate-limit / account / backoff / escalating (cooldownMs null)", () => {
    const c = classifyError({ provider: "openai", status: 429, errorText: "rate limit hit" });
    expect(c.kind).toBe("rate-limit");
    expect(c.scope).toBe("account");
    expect(c.action).toBe("backoff");
    expect(c.cooldownMs).toBeNull();
    expect(c.confidence).toBe("rule");
  });

  it("'too many requests' text → rate-limit", () => {
    const c = classifyError({ status: 400, errorText: "Too many requests, slow down" });
    expect(c.kind).toBe("rate-limit");
    expect(c.action).toBe("backoff");
  });

  it("status 503 → server / provider / retry-now / 5s", () => {
    const c = classifyError({ provider: "openai", status: 503, errorText: "Service Unavailable" });
    expect(c.kind).toBe("server");
    expect(c.scope).toBe("provider");
    expect(c.action).toBe("retry-now");
    expect(c.cooldownMs).toBe(5_000);
  });

  it("status 502 and 504 → server too", () => {
    expect(classifyError({ status: 502, errorText: "bad gateway" }).kind).toBe("server");
    expect(classifyError({ status: 504, errorText: "gateway timeout" }).kind).toBe("server");
  });

  it("'capacity'/'overloaded' text → queue / provider / wait-progressing", () => {
    const c = classifyError({
      provider: "anthropic",
      status: 500,
      errorText: "server overloaded, retry later",
    });
    expect(c.kind).toBe("queue");
    expect(c.scope).toBe("provider");
    expect(c.action).toBe("wait-progressing");
  });

  it("default → unknown / account / backoff / confidence fallback / 30s", () => {
    const c = classifyError({ provider: "openai", status: 418, errorText: "i'm a teapot" });
    expect(c.kind).toBe("unknown");
    expect(c.scope).toBe("account");
    expect(c.action).toBe("backoff");
    expect(c.confidence).toBe("fallback");
    expect(c.cooldownMs).toBe(30_000);
  });
});

describe("classifyError — purity", () => {
  it("is deterministic: two calls deep-equal the same object", () => {
    const input = {
      provider: "qoder",
      model: "mmodel",
      status: 503,
      errorText: JSON.stringify({
        error: JSON.stringify({ code: 10605, message: 'still queued, queueType=p4' }),
      }),
    };
    expect(classifyError(input)).toEqual(classifyError(input));
    expect(classifyError({})).toEqual(classifyError({}));
  });
});

// ---------------------------------------------------------------------------
// shouldCountTowardsBreaker / breakerKeyFor / cooldownFor
// ---------------------------------------------------------------------------

describe("shouldCountTowardsBreaker", () => {
  it("queue + wait-progressing does NOT count (antrean bukan fault akun)", () => {
    expect(
      shouldCountTowardsBreaker(
        classifyError({ provider: "qoder", status: 503, errorText: "queueType=p4 waitTime=60s" })
      )
    ).toBe(false);
  });

  it("scope none / action ignore does NOT count (local bug)", () => {
    expect(
      shouldCountTowardsBreaker(
        classifyError({ status: 400, errorText: 'model_config for "x" not yet known' })
      )
    ).toBe(false);
  });

  it("queue + exclude DOES count (daily limit needs a long lock)", () => {
    expect(
      shouldCountTowardsBreaker(
        classifyError({ provider: "qoder", errorText: "CALL_COUNT_LIMIT" })
      )
    ).toBe(true);
  });

  it("billing / rate-limit / server / default all count", () => {
    expect(shouldCountTowardsBreaker(classifyError({ status: 402, errorText: "billing" }))).toBe(true);
    expect(
      shouldCountTowardsBreaker(classifyError({ status: 429, errorText: "rate limit" }))
    ).toBe(true);
    expect(
      shouldCountTowardsBreaker(classifyError({ status: 503, errorText: "unavailable" }))
    ).toBe(true);
    expect(shouldCountTowardsBreaker(classifyError({ status: 418 }))).toBe(true);
    expect(shouldCountTowardsBreaker(null)).toBe(true); // unclassified → legacy
  });
});

describe("breakerKeyFor", () => {
  it("scope model → provider|model, NEVER the connectionId", () => {
    const queue = classifyError({ provider: "qoder", status: 503, errorText: "queueType=p4" });
    const key = breakerKeyFor(queue, {
      connectionId: "qoder-acct-3",
      provider: "qoder",
      model: "mmodel",
    });
    expect(key).toBe("qoder|mmodel");
    expect(key).not.toContain("qoder-acct-3");
  });

  it("scope account → connectionId (or provider|account without a connection)", () => {
    const auth = classifyError({ status: 401, errorText: "invalid_api_key" });
    expect(breakerKeyFor(auth, { connectionId: "c1", provider: "openai", model: "m" })).toBe("c1");
    expect(breakerKeyFor(auth, { connectionId: null, provider: "muse", model: "m" })).toBe(
      "muse|account"
    );
    expect(breakerKeyFor(auth, { connectionId: "noauth", provider: "muse", model: "m" })).toBe(
      "muse|account"
    );
  });

  it("scope provider → provider; scope none → null (no lock)", () => {
    const server = classifyError({ status: 503, errorText: "Service Unavailable" });
    expect(breakerKeyFor(server, { connectionId: "c1", provider: "openai", model: "m" })).toBe(
      "openai"
    );
    const local = classifyError({ status: 400, errorText: 'model_config for "x" not yet known' });
    expect(breakerKeyFor(local, { connectionId: "c1", provider: "qoder", model: "m" })).toBeNull();
  });
});

describe("cooldownFor", () => {
  it("uses classified.cooldownMs when present (exclude / ignore)", () => {
    expect(cooldownFor(classifyError({ status: 404, errorText: "nope" }))).toBe(600_000);
    expect(cooldownFor(classifyError({ status: 401, errorText: "bad key" }))).toBe(300_000);
    expect(cooldownFor(classifyError({ status: 402, errorText: "billing" }))).toBe(1_800_000);
    expect(
      cooldownFor(classifyError({ status: 400, errorText: 'model_config for "x" not yet known' }))
    ).toBe(0);
  });

  it("escalates base*multiplier for action=backoff and caps at max", () => {
    const rate = classifyError({ status: 429, errorText: "rate limit" });
    expect(cooldownFor(rate, { consecutiveFailures: 3 })).toBe(60_000);
    expect(cooldownFor(rate, { consecutiveFailures: 4 })).toBe(120_000);
    expect(cooldownFor(rate, { consecutiveFailures: 5 })).toBe(240_000);
    expect(cooldownFor(rate, { consecutiveFailures: 10 })).toBe(900_000); // 15m cap
  });

  it("default/unknown keeps escalating even though its advisory cooldownMs is 30s", () => {
    const unknown = classifyError({ status: 418, errorText: "teapot" });
    expect(unknown.cooldownMs).toBe(30_000);
    expect(cooldownFor(unknown, { consecutiveFailures: 4 })).toBe(120_000);
    expect(cooldownFor(null, { consecutiveFailures: 3 })).toBe(60_000); // unclassified → legacy
  });
});

// ---------------------------------------------------------------------------
// Wiring into healthBreaker.js
// ---------------------------------------------------------------------------

describe("healthBreaker wiring — qoder queue must not burn accounts", () => {
  it("recordFailure with 503 queueType ×5 across 5 accounts: nothing counts, nothing locks", () => {
    const failure = {
      provider: "qoder",
      model: "mmodel",
      status: 503,
      errorText: "503 queueType=p4 waitTime=60s",
    };
    for (let i = 0; i < 5; i += 1) {
      recordFailure({ connectionId: `qoder-acct-${i}`, ...failure });
    }

    const state = getState({ connectionId: "qoder-acct-0", provider: "qoder", model: "mmodel" });
    expect(state.consecutiveFailures).toBe(0); // per-connection entry NOT incremented
    expect(state.state).toBe("closed");
    expect(isBlockedFor({ connectionId: "qoder-acct-0", provider: "qoder", model: "mmodel" })).toBe(
      false
    );
    // diagnostics still visible for the dashboard
    expect(state.lastError).toContain("queueType");
    expect(state.lastFailureKind).toBe("queue");
    expect(state.lastFailureScope).toBe("model");
    expect(state.lastFailureAction).toBe("wait-progressing");
    // no lock at any level
    expect(isOpen({ connectionId: "noauth", provider: "qoder", model: "mmodel" })).toBe(false);
    expect(getSnapshot().open).toBe(0);
  });

  it("queue diagnostics do not disturb a real account-failure streak", () => {
    const p = { connectionId: "c1", provider: "openai", model: "gpt-5" };
    recordFailure({ ...p, status: 500, errorText: "boom" });
    recordFailure({ ...p, status: 500, errorText: "boom" });
    recordFailure({ ...p, status: 503, errorText: "queueType=p4" }); // diagnostics only
    expect(getState(p).consecutiveFailures).toBe(2);
    recordFailure({ ...p, status: 500, errorText: "boom" });
    expect(getState(p).state).toBe("open");
  });
});

describe("healthBreaker wiring — billing needs a human", () => {
  it("402 ×3 opens the breaker with needsHuman + 30m cooldown; success clears it", () => {
    const p = {
      connectionId: "muse-1",
      provider: "muse",
      model: "gpt-x",
      status: 402,
      errorText:
        '{"error":{"code":"billing_not_configured","message":"Billing verification failed"}}',
    };
    recordFailure(p);
    recordFailure(p);
    recordFailure(p);

    const state = getState({ connectionId: "muse-1", provider: "muse", model: "gpt-x" });
    expect(state.state).toBe("open");
    expect(state.needsHuman).toBe(true);
    expect(state.needsHumanSince).toBeTypeOf("number");
    expect(state.cooldownMs).toBe(30 * 60_000);
    expect(state.blockedUntil).toBeGreaterThan(Date.now() + 29 * 60_000);
    expect(state.lastFailureKind).toBe("billing");
    expect(state.lastFailureAction).toBe("needs-human");
    expect(isBlockedFor({ connectionId: "muse-1", provider: "muse", model: "gpt-x" })).toBe(true);

    recordSuccess({ connectionId: "muse-1", provider: "muse", model: "gpt-x" });
    const after = getState({ connectionId: "muse-1", provider: "muse", model: "gpt-x" });
    expect(after.needsHuman).toBe(false);
    expect(after.needsHumanSince).toBeNull();
  });
});

describe("healthBreaker wiring — model-scoped locks", () => {
  it("404 ×3 locks the provider|model key (10m), never the per-connection entry", () => {
    const base = {
      provider: "antigravity",
      model: "gemini-9",
      status: 404,
      errorText: "Requested entity was not found",
    };
    recordFailure({ connectionId: "ant-1", ...base });
    recordFailure({ connectionId: "ant-1", ...base });
    recordFailure({ connectionId: "ant-1", ...base });

    const conn = getState({ connectionId: "ant-1", provider: "antigravity", model: "gemini-9" });
    expect(conn.consecutiveFailures).toBe(0);
    expect(conn.state).toBe("closed");

    const agg = getState({ connectionId: null, provider: "antigravity", model: "gemini-9" });
    expect(agg.state).toBe("open");
    expect(agg.consecutiveFailures).toBe(3);
    expect(agg.cooldownMs).toBe(10 * 60_000);

    // heterozygous read: the model-level lock applies to every account —
    // but only for that model.
    expect(isBlockedFor({ connectionId: "ant-2", provider: "antigravity", model: "gemini-9" })).toBe(
      true
    );
    expect(isOpen({ connectionId: "ant-2", provider: "antigravity", model: "gemini-9" })).toBe(true);
    expect(
      isBlockedFor({ connectionId: "ant-2", provider: "antigravity", model: "gemini-2.5" })
    ).toBe(false);
  });

  it("qoder CALL_COUNT_LIMIT ×3 locks provider|model for 30m (counts, exclude)", () => {
    const p = {
      connectionId: "qoder-7",
      provider: "qoder",
      model: "qmodel_latest",
      status: 503,
      errorText: '{"code":10605,"message":"CALL_COUNT_LIMIT reached"}',
    };
    recordFailure(p);
    recordFailure(p);
    recordFailure(p);

    expect(
      getState({ connectionId: "qoder-7", provider: "qoder", model: "qmodel_latest" })
        .consecutiveFailures
    ).toBe(0); // account itself untouched
    const agg = getState({ connectionId: null, provider: "qoder", model: "qmodel_latest" });
    expect(agg.state).toBe("open");
    expect(agg.consecutiveFailures).toBe(3);
    expect(agg.cooldownMs).toBe(30 * 60_000);
    expect(isBlockedFor({ connectionId: "qoder-8", provider: "qoder", model: "qmodel_latest" })).toBe(
      true
    );
  });
});

describe("healthBreaker wiring — local bug and provider-scoped 5xx", () => {
  it("400 model_config bug ×5 never opens anything (ignore / scope none)", () => {
    const p = {
      connectionId: "qoder-1",
      provider: "qoder",
      model: "auto",
      status: 400,
      errorText: 'model_config for "auto" not yet known',
    };
    for (let i = 0; i < 5; i += 1) recordFailure(p);

    const state = getState({ connectionId: "qoder-1", provider: "qoder", model: "auto" });
    expect(state.consecutiveFailures).toBe(0);
    expect(state.state).toBe("closed");
    expect(state.lastFailureKind).toBe("request-invalid");
    expect(state.lastFailureScope).toBe("none");
    expect(state.lastFailureAction).toBe("ignore");
    expect(isBlockedFor({ connectionId: "qoder-1", provider: "qoder", model: "auto" })).toBe(false);
    expect(getSnapshot().open).toBe(0);
  });

  it("503 ×3 locks the provider-wide key for ~5s, without counting the account", () => {
    const p = {
      connectionId: "openai-1",
      provider: "openai",
      model: "gpt-5",
      status: 503,
      errorText: "Service Unavailable",
    };
    recordFailure(p);
    recordFailure(p);
    recordFailure(p);

    expect(
      getState({ connectionId: "openai-1", provider: "openai", model: "gpt-5" }).consecutiveFailures
    ).toBe(0);
    expect(isOpen({ connectionId: "openai-1", provider: "openai", model: "gpt-5" })).toBe(true);
    // provider scope → the lock is provider-wide, not per model
    expect(isOpen({ connectionId: "openai-2", provider: "openai", model: "gpt-6" })).toBe(true);

    const locked = listBlocked().find(
      (e) => e.connectionId === null && e.model === null && e.provider === "openai"
    );
    expect(locked).toBeTruthy();
    expect(locked.state).toBe("open");
    expect(locked.lastFailureKind).toBe("server");
    expect(locked.blockedUntil - Date.now()).toBeLessThanOrEqual(5_000 + 100);
    expect(locked.blockedUntil - Date.now()).toBeGreaterThan(4_000);
  });

  it("status 401 ×3 excludes the account for 5m", () => {
    const p = {
      connectionId: "bad-1",
      provider: "openai",
      model: "gpt-5",
      status: 401,
      errorText: "invalid_api_key",
    };
    recordFailure(p);
    recordFailure(p);
    recordFailure(p);

    const state = getState({ connectionId: "bad-1", provider: "openai", model: "gpt-5" });
    expect(state.state).toBe("open");
    expect(state.cooldownMs).toBe(5 * 60_000);
    expect(state.needsHuman).toBe(false);
    expect(state.lastFailureKind).toBe("auth");
    expect(state.lastFailureScope).toBe("account");
    expect(state.lastFailureAction).toBe("exclude");
  });
});

describe("healthBreaker wiring — snapshot fields", () => {
  it("entries expose lastFailureKind/Scope/Action + needsHuman (additive)", () => {
    recordFailure({
      connectionId: "muse-2",
      provider: "muse",
      model: "m2",
      status: 402,
      errorText: "billing_not_configured",
    });

    const entry = getSnapshot().entries.find((e) => e.connectionId === "muse-2");
    expect(entry).toBeTruthy();
    expect(entry.lastFailureKind).toBe("billing");
    expect(entry.lastFailureScope).toBe("account");
    expect(entry.lastFailureAction).toBe("needs-human");
    expect(entry.needsHuman).toBe(true);
    expect(entry).toHaveProperty("needsHumanSince");
    // old fields untouched for existing dashboard clients
    expect(entry).toHaveProperty("lastError");
    expect(entry).toHaveProperty("lastStatus");
    expect(entry).toHaveProperty("consecutiveFailures");
  });
});
