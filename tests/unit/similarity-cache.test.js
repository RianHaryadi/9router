import { describe, expect, it } from "vitest";

import {
  createSimilarityIndex,
  fingerprintTokens,
  normalizeText,
  similarityScore,
  tokenSet,
} from "../../src/custom/cache/similarity.js";

const chat = (text) => ({
  model: "openai/gpt-4o",
  messages: [{ role: "user", content: text }],
});

describe("normalizeText", () => {
  it("lowercases, strips punctuation to spaces and collapses whitespace", () => {
    expect(normalizeText("Hello,   World!  Again?")).toBe("hello world again");
  });

  it("returns an empty string for non-strings", () => {
    expect(normalizeText(undefined)).toBe("");
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(42)).toBe("");
    expect(normalizeText("")).toBe("");
  });
});

describe("tokenSet", () => {
  it("keeps words of length >= 2 and drops single characters", () => {
    const tokens = tokenSet("a b cd ef");
    expect(tokens.has("cd")).toBe(true);
    expect(tokens.has("ef")).toBe(true);
    expect(tokens.has("a")).toBe(false);
    expect(tokens.has("b")).toBe(false);
  });

  it("adds bigrams of consecutive words so word order partially matters", () => {
    const tokens = tokenSet("the quick brown fox");
    expect(tokens.has("the")).toBe(true);
    expect(tokens.has("the quick")).toBe(true);
    expect(tokens.has("quick brown")).toBe(true);
    expect(tokens.has("brown fox")).toBe(true);
    expect(tokens.has("fox quick")).toBe(false);
  });

  it("is case/punctuation insensitive", () => {
    expect(tokenSet("Hello, World!").size).toBe(tokenSet("hello world").size);
  });

  it("returns an empty set for empty input", () => {
    expect(tokenSet("").size).toBe(0);
    expect(tokenSet(null).size).toBe(0);
  });

  it("caps at 20000 tokens per document", () => {
    const long = Array.from({ length: 30000 }, (_, i) => `w${i}`).join(" ");
    expect(tokenSet(long).size).toBeLessThanOrEqual(20000);
  });
});

describe("similarityScore", () => {
  it("returns 1 for identical sets and 0 for disjoint sets", () => {
    const a = tokenSet("the quick brown fox jumps");
    const b = tokenSet("the quick brown fox jumps");
    const c = tokenSet("completely different content here");
    expect(similarityScore(a, b)).toBe(1);
    expect(similarityScore(a, c)).toBe(0);
  });

  it("stays within [0, 1] for partial overlap", () => {
    const a = tokenSet("alpha beta gamma delta");
    const b = tokenSet("alpha beta gamma epsilon");
    const score = similarityScore(a, b);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 for empty or invalid inputs", () => {
    expect(similarityScore(new Set(), new Set(["a"]))).toBe(0);
    expect(similarityScore(null, new Set(["a"]))).toBe(0);
    expect(similarityScore("not a set", new Set(["a"]))).toBe(0);
  });
});

describe("fingerprintTokens", () => {
  it("collects text from messages with string content", () => {
    const tokens = fingerprintTokens(chat("hello there"));
    expect(tokens.has("hello")).toBe(true);
    expect(tokens.has("hello there")).toBe(true);
  });

  it("collects text from message content array parts", () => {
    const tokens = fingerprintTokens({
      messages: [{ role: "user", content: [{ type: "text", text: "part one" }] }],
    });
    expect(tokens.has("part")).toBe(true);
    expect(tokens.has("part one")).toBe(true);
  });

  it("collects text from input, instructions, system and prompt", () => {
    const tokens = fingerprintTokens({
      input: [{ type: "text", text: "input text" }],
      instructions: "instruction text",
      system: "system text",
      prompt: "prompt text",
    });
    expect(tokens.has("input")).toBe(true);
    expect(tokens.has("instruction")).toBe(true);
    expect(tokens.has("system")).toBe(true);
    expect(tokens.has("prompt")).toBe(true);
  });

  it("accepts a plain string input", () => {
    const tokens = fingerprintTokens({ input: "plain input" });
    expect(tokens.has("plain")).toBe(true);
  });

  it("returns an empty set for bodies without usable text", () => {
    expect(fingerprintTokens({}).size).toBe(0);
    expect(fingerprintTokens(null).size).toBe(0);
    expect(fingerprintTokens("nope").size).toBe(0);
    expect(fingerprintTokens({ messages: [{ role: "user" }] }).size).toBe(0);
  });
});

describe("createSimilarityIndex", () => {
  it("returns null on an empty index", () => {
    const index = createSimilarityIndex();
    expect(index.find(chat("anything at all"))).toBeNull();
    expect(index.stats()).toEqual({ size: 0, hits: 0, misses: 1 });
  });

  it("finds a stored body with score 1 and the same entry object", () => {
    const index = createSimilarityIndex();
    const entry = { body: "cached upstream response" };
    index.add(chat("the exact same question"), entry);
    const found = index.find(chat("the exact same question"));
    expect(found).not.toBeNull();
    expect(found.score).toBe(1);
    expect(found.entry).toBe(entry);
  });

  it("treats whitespace/case/punctuation differences as identical", () => {
    const index = createSimilarityIndex();
    const entry = { id: "e1" };
    index.add(chat("The Quick, Brown   Fox!"), entry);
    const found = index.find(chat("the quick brown fox"));
    expect(found).not.toBeNull();
    expect(found.score).toBe(1);
    expect(found.entry).toBe(entry);
  });

  it("does not match bodies that differ by a trailing sentence", () => {
    const index = createSimilarityIndex();
    index.add(chat("what is the capital of france"), { id: "e1" });
    const found = index.find(chat("what is the capital of france thanks a lot"));
    expect(found).toBeNull();
  });

  it("matches a body that is ~90% identical to a cached one", () => {
    const index = createSimilarityIndex();
    const base =
      "please summarize the following quarterly report about revenue growth " +
      "in the enterprise segment across all regions and include a summary table";
    index.add(chat(base), { id: "e1" });
    const found = index.find(chat(`${base} please`));
    expect(found).not.toBeNull();
    expect(found.score).toBeGreaterThanOrEqual(0.85);
  });

  it("never matches bodies with disjoint content", () => {
    const index = createSimilarityIndex();
    index.add(chat("how do i bake sourdough bread at home"), { id: "e1" });
    const found = index.find(chat("list the planets of the solar system in order"));
    expect(found).toBeNull();
    expect(index.stats().hits).toBe(0);
  });

  it("breaks ties on equal score with the most recently added entry", () => {
    const index = createSimilarityIndex();
    index.add(chat("identical text here"), { id: "old" });
    index.add(chat("identical text here"), { id: "new" });
    const found = index.find(chat("identical text here"));
    expect(found.entry.id).toBe("new");
  });

  it("evicts the least recently accessed entry when maxEntries is exceeded", () => {
    const index = createSimilarityIndex({ maxEntries: 2 });
    index.add(chat("first document body"), { id: "a" });
    index.add(chat("second document body"), { id: "b" });
    // Touch "a" so "b" becomes the least recently accessed entry.
    index.find(chat("first document body"));
    index.add(chat("third document body"), { id: "c" });
    expect(index.stats().size).toBe(2);
    expect(index.find(chat("second document body"))).toBeNull();
    expect(index.find(chat("first document body"))).not.toBeNull();
    expect(index.find(chat("third document body"))).not.toBeNull();
  });

  it("ignores malformed bodies: they are never stored and never match", () => {
    const index = createSimilarityIndex();
    expect(index.add({}, { id: "x" })).toBeNull();
    expect(index.add(null, { id: "x" })).toBeNull();
    expect(index.add({ messages: [] }, { id: "x" })).toBeNull();
    expect(index.stats().size).toBe(0);
    expect(index.find({})).toBeNull();
    expect(index.find(null)).toBeNull();
    expect(index.find("garbage")).toBeNull();
  });

  it("removes and clears entries", () => {
    const index = createSimilarityIndex();
    const id = index.add(chat("removable document"), { id: "r" });
    expect(index.remove(id)).toBe(true);
    expect(index.find(chat("removable document"))).toBeNull();

    index.add(chat("another document"), { id: "s" });
    expect(index.stats().size).toBe(1);
    index.clear();
    expect(index.stats().size).toBe(0);
    expect(index.find(chat("another document"))).toBeNull();
  });

  it("counts hits and misses", () => {
    const index = createSimilarityIndex();
    index.add(chat("counted document"), { id: "c" });
    index.find(chat("counted document"));
    index.find(chat("unrelated request content"));
    expect(index.stats()).toEqual({ size: 1, hits: 1, misses: 1 });
  });

  it("honours a custom threshold", () => {
    const index = createSimilarityIndex({ threshold: 0.3 });
    index.add(chat("alpha beta gamma delta"), { id: "e1" });
    const found = index.find(chat("alpha beta gamma epsilon"));
    expect(found).not.toBeNull();
    expect(found.score).toBeGreaterThanOrEqual(0.3);
  });
});
