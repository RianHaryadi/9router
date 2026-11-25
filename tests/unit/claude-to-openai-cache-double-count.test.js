// Regression: a Claude-format provider (minimax-code-global, anthropic, ...)
// streamed into an OpenAI-format client must not have its cache counted twice.
//
// Before the fix, claudeToOpenAIResponse() put a CACHE-INCLUSIVE prompt_tokens
// on state.usage and ALSO emitted cache_read_input_tokens. canonicalizeUsage()
// reads cache_read_input_tokens as "prompt EXCLUDES cache" and folds it in a
// second time: prompt 2x, hit% halved, cost ~2x. Live proof on prod (7d):
// 10.219 minimax rows all pinned at cached/prompt = 0.499-0.500, with
//   468097 = 2177 + 2*232960   (exact, 8 rows, zero deviation)
// while the real cache rate was ~99.8%.
//
// The translator emits the cache in the canonical OpenAI field (cached_tokens /
// prompt_tokens_details), which canonicalizeUsage() passes through unfolded.
import { describe, it, expect } from "vitest";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";

function runStream(events) {
  const state = {};
  const out = [];
  for (const ev of events) {
    const r = claudeToOpenAIResponse(ev, state);
    if (Array.isArray(r)) out.push(...r);
    else if (r) out.push(r);
  }
  return { state, out };
}

// A real minimax-code-global turn: 50 fresh input tokens, 31104 cache read.
const CACHE_READ = 31104;
const FRESH = 50;

const stream = [
  {
    type: "message_start",
    message: {
      id: "msg_1", model: "MiniMax-M3.1-Flash", role: "assistant", content: [],
      usage: { input_tokens: FRESH, output_tokens: 1, cache_read_input_tokens: CACHE_READ, cache_creation_input_tokens: 0 },
    },
  },
  {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { input_tokens: FRESH, output_tokens: 3, cache_read_input_tokens: CACHE_READ, cache_creation_input_tokens: 0 },
  },
  { type: "message_stop" },
];

describe("claude→openai stream usage: cache must be counted once", () => {
  it("state.usage carries the cache in the canonical OpenAI field", () => {
    const { state } = runStream(stream);
    expect(state.usage.prompt_tokens).toBe(FRESH + CACHE_READ); // cache-inclusive
    expect(state.usage.cached_tokens).toBe(CACHE_READ);
    // The exclusive-cache field must NOT ride along: it is what makes
    // canonicalizeUsage() fold the cache a second time.
    expect(state.usage.cache_read_input_tokens).toBeUndefined();
  });

  it("canonicalizes to a cache-inclusive prompt with no double fold", () => {
    const { state } = runStream(stream);
    const canon = canonicalizeUsage(state.usage);
    expect(canon.prompt_tokens).toBe(FRESH + CACHE_READ);
    expect(canon.cached_tokens).toBe(CACHE_READ);
    // The old bug: prompt was 2x and the hit rate was pinned at ~0.5.
    expect(canon.prompt_tokens).not.toBe(FRESH + 2 * CACHE_READ);
    expect(canon.cached_tokens / canon.prompt_tokens).toBeGreaterThan(0.99);
  });

  it("survives message_delta arriving without the cache fields", () => {
    // Anthropic-style: cache only in message_start, delta carries output only.
    const { state } = runStream([
      stream[0],
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } },
    ]);
    const canon = canonicalizeUsage(state.usage);
    expect(canon.cached_tokens).toBe(CACHE_READ);
    expect(canon.prompt_tokens).toBe(FRESH + CACHE_READ);
  });

  it("keeps a genuine Anthropic exclusive-cache provider correct", () => {
    // Real Anthropic: input_tokens EXCLUDES the cache, so the translator must
    // add it once. prompt = 100 + 200 + 30, cached = 200.
    const { state } = runStream([
      {
        type: "message_start",
        message: {
          id: "msg_2", model: "claude-opus-5", role: "assistant", content: [],
          usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 200, cache_creation_input_tokens: 30 },
        },
      },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
    ]);
    const canon = canonicalizeUsage(state.usage);
    expect(canon.prompt_tokens).toBe(330);
    expect(canon.cached_tokens).toBe(200);
    expect(canon.cache_creation_input_tokens).toBe(30);
  });

  it("still reports cache to the OpenAI-format client", () => {
    const { out } = runStream(stream);
    const final = out.find((c) => c?.usage);
    expect(final).toBeTruthy();
    expect(final.usage.prompt_tokens).toBe(FRESH + CACHE_READ);
    expect(final.usage.prompt_tokens_details?.cached_tokens).toBe(CACHE_READ);
  });
});
