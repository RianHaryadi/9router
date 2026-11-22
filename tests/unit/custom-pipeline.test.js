import assert from "node:assert";
import { describe, it } from "vitest";

// src/custom — Fase 1 transform pipeline modules (pure, fail-open).
import {
  estimateTokens, estimateBodyTokens, collectBodyText, tokenDelta,
  normalizePolicy, shouldCompressTool, collectCompressibleToolIndices,
  isEndUserFacing, guardedInjectCaveman, guardedInjectPonytail,
  repairToolArguments, autoCloseJson, shouldRetryToolCall,
  rankByCacheWarm, pickCacheWarmModel,
  runCustomPipeline, requiresEndUserGuard,
} from "../../src/custom/index.js";

describe("src/custom/rtk/tokenMeter", () => {
  it("estimates latin ~1/4 and CJK ~1/1", () => {
    const latin = estimateTokens("The quick brown fox jumps over the lazy dog");
    assert.ok(latin > 8 && latin < 16, `latin=${latin}`);
    const cjk = estimateTokens("这是一个测试字符串用来验证中文的token估算");
    assert.ok(cjk >= 15 && cjk <= 25, `cjk=${cjk}`);
  });
  it("is zero for empty/non-string", () => {
    assert.strictEqual(estimateTokens(""), 0);
    assert.strictEqual(estimateTokens(null), 0);
    assert.strictEqual(estimateTokens(123), 0);
  });
  it("collects text from messages/input/tool results/instructions", () => {
    const segs = collectBodyText({
      instructions: "be brief",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: [{ type: "text", text: "hello" }] },
        { role: "tool", content: "big" },
        { type: "function_call_output", output: [{ type: "input_text", text: "resp" }] },
      ],
    });
    for (const s of ["be brief", "hello", "big", "resp"]) assert.ok(segs.includes(s));
  });
  it("computes a non-negative delta", () => {
    const delta = tokenDelta({ messages: [{ content: "a".repeat(40) }] }, { messages: [] });
    assert.ok(delta.before > delta.after);
    assert.ok(delta.saved >= 0);
  });
});

describe("src/custom/rtk/whitelist", () => {
  it("defaults to allow-all", () => {
    assert.deepStrictEqual(normalizePolicy(undefined), { mode: "allow-all", tools: [] });
    assert.strictEqual(shouldCompressTool(undefined, "x"), true);
  });
  it("deny mode skips listed tools, allows others", () => {
    const p = { mode: "deny", tools: ["dangerous"] };
    assert.strictEqual(shouldCompressTool(p, "dangerous"), false);
    assert.strictEqual(shouldCompressTool(p, "safe"), true);
  });
  it("allow mode compresses only listed tools", () => {
    const p = { mode: "allow", tools: ["safe"] };
    assert.strictEqual(shouldCompressTool(p, "safe"), true);
    assert.strictEqual(shouldCompressTool(p, "other"), false);
  });
  it("collects compressible tool indices by policy", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "tool", name: "search", content: "..." },
        { role: "tool", name: "execute", content: "..." },
        { type: "function_call_output", name: "read", output: "..." },
      ],
    };
    assert.deepStrictEqual(
      collectCompressibleToolIndices(body, { mode: "deny", tools: ["execute"] }),
      [1, 3]
    );
  });
});

describe("src/custom/transform", () => {
  it("treats coding agents as non-end-user-facing", () => {
    assert.strictEqual(isEndUserFacing({ clientTool: "claude" }), false);
    assert.strictEqual(isEndUserFacing({ clientTool: "codex" }), false);
  });
  it("treats chat UIs as end-user-facing", () => {
    assert.strictEqual(isEndUserFacing({ clientTool: "deepseek-tui" }), true);
    assert.strictEqual(isEndUserFacing({ endUserFacing: true }), true);
  });
  it("guarded injectors skip end-user-facing requests", () => {
    const body = { messages: [{ role: "system", content: "" }] };
    assert.strictEqual(guardedInjectCaveman(body, "openai", "full", { clientTool: "deepseek-tui" }), false);
    assert.strictEqual(guardedInjectPonytail(body, "openai", "full", { clientTool: "deepseek-tui" }), false);
    // coding agent -> allowed
    assert.strictEqual(guardedInjectCaveman(body, "openai", "lite", { clientTool: "claude" }), true);
    assert.ok(body.messages[0].content.length > 0);
  });
});

describe("src/custom/toolcall/repair", () => {
  it("passes valid JSON through untouched", () => {
    const r = repairToolArguments('{"a":1,"b":[2,3]}');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.repaired, false);
    assert.deepStrictEqual(r.value, { a: 1, b: [2, 3] });
  });
  it("auto-closes truncated JSON", () => {
    assert.deepStrictEqual(repairToolArguments('{"a":1,"b":[2,3').value, { a: 1, b: [2, 3] });
  });
  it("recovers truncated list ending in comma", () => {
    assert.deepStrictEqual(repairToolArguments('{"a":1,').value, { a: 1 });
  });
  it("recovers trailing commas", () => {
    assert.deepStrictEqual(repairToolArguments('{"a":1,"b":[2,3,],}').value, { a: 1, b: [2, 3] });
  });
  it("recovers single-quoted keys", () => {
    assert.deepStrictEqual(repairToolArguments("{'a':1,'b':'x'}").value, { a: 1, b: "x" });
  });
  it("fails on garbage without throwing", () => {
    assert.strictEqual(repairToolArguments("not json {{{").ok, false);
    assert.strictEqual(repairToolArguments(null).ok, false);
  });
  it("shouldRetryToolCall", () => {
    assert.strictEqual(shouldRetryToolCall({ function: { arguments: "{}" } }), false);
    assert.strictEqual(
      shouldRetryToolCall({ function: { arguments: "broken {{{" } }, { repairsLeft: 1, retryableModels: ["m2"] }),
      true
    );
    assert.strictEqual(shouldRetryToolCall({ function: { arguments: "broken {{{" } }, { repairsLeft: 0, retryableModels: ["m2"] }), false);
  });
});

describe("src/custom/cache/awareRouting", () => {
  it("ranks lastModel first", () => {
    const r = rankByCacheWarm(["a", "b", "c"], { lastModel: "b" });
    assert.strictEqual(r[0], "b");
  });
  it("boosts same-provider, breaks ties stably", () => {
    assert.strictEqual(rankByCacheWarm(["x", "y", "z"], {})[0], "x");
    assert.strictEqual(rankByCacheWarm(["openai/gpt", "anthropic/claude"], { lastProvider: "anthropic" })[0], "anthropic/claude");
  });
  it("pick returns null on empty", () => {
    assert.strictEqual(pickCacheWarmModel([], {}), null);
  });
});

describe("src/custom/pipeline", () => {
  it("runs fail-open with no config", () => {
    const d = runCustomPipeline({ body: { messages: [{ role: "user", content: "hi" }] }, finalFormat: "openai" });
    assert.ok(Array.isArray(d.applied));
    assert.ok(d.tokens && typeof d.tokens.before === "number");
  });
  it("honours tokens:false", () => {
    assert.strictEqual(runCustomPipeline({ body: { messages: [] }, config: { tokens: false } }).tokens, null);
  });
  it("sharp end-user guard on pipeline diag", () => {
    const d = runCustomPipeline({ body: { messages: [] }, clientTool: "deepseek-tui" });
    assert.ok(d.skipped.includes("transform:end-user-facing"));
  });
  it("exposes rtk whitelist indices on diag (never leaks to body)", () => {
    const body = { messages: [{ role: "tool", name: "search", content: "x" }] };
    const d = runCustomPipeline({ body, config: { rtkPolicy: { mode: "deny", tools: ["search"] } } });
    assert.ok(d.applied.some((a) => a.startsWith("rtk-whitelist")));
    assert.ok(Array.isArray(d.rtkWhitelistIndices));
    // body must stay clean — translatedBody goes to the upstream wire
    assert.strictEqual(body._customRtkPolicy, undefined);
  });
  it("rescues malformed tool calls in place", () => {
    const body = { messages: [{ role: "assistant", tool_calls: [{ function: { name: "f", arguments: '{"a":1,' } }] }] };
    const d = runCustomPipeline({ body, config: { repair: { rescue: true } } });
    assert.ok(d.applied.some((a) => a.startsWith("toolcall-repair")));
    assert.strictEqual(JSON.parse(body.messages[0].tool_calls[0].function.arguments).a, 1);
  });
  it("reports cache ranking", () => {
    const d = runCustomPipeline({ body: { messages: [] }, ctx: { lastModel: "openai/gpt" }, config: { cacheWarm: { models: ["anthropic/x", "openai/gpt"] } } });
    assert.strictEqual(d.cacheRank[0], "openai/gpt");
  });
  it("never throws on garbage input", () => {
    assert.ok(runCustomPipeline({ body: null }).applied.length >= 0);
    assert.ok(runCustomPipeline({}).applied.length >= 0);
  });
});

describe("src/custom/pipeline requiresEndUserGuard", () => {
  it("true for chat UIs and explicit flag", () => {
    assert.strictEqual(requiresEndUserGuard({ clientTool: "deepseek-tui" }), true);
    assert.strictEqual(requiresEndUserGuard({ endUserFacing: true }), true);
  });
  it("false for coding agents", () => {
    assert.strictEqual(requiresEndUserGuard({ clientTool: "claude" }), false);
  });
});
