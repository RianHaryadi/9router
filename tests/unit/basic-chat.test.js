import { describe, expect, it } from "vitest";
import { readChatResponse, toChatRequestModel } from "../../src/shared/utils/basicChat.js";

function sse(parts) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}

describe("Basic Chat request models", () => {
  it("routes raw and vendor-namespaced live IDs to their selected provider", () => {
    expect(toChatRequestModel("codex", "gpt-test", "cx")).toBe("codex/gpt-test");
    expect(toChatRequestModel("openrouter", "anthropic/claude-test", "or")).toBe("openrouter/anthropic/claude-test");
    expect(toChatRequestModel("openai-compatible-local", "vendor/model")).toBe("openai-compatible-local/vendor/model");
  });
  it("does not duplicate canonical or UI-alias prefixes", () => {
    expect(toChatRequestModel("codex", "codex/gpt-test", "cx")).toBe("codex/gpt-test");
    expect(toChatRequestModel("codex", "cx/gpt-test", "cx")).toBe("cx/gpt-test");
  });
});

describe("Basic Chat response reader", () => {
  it("reads JSON completions even when Response.body is a readable stream", async () => {
    const updates = [];
    expect(await readChatResponse(Response.json({ choices: [{ message: { content: "JSON reply" } }] }), (text) => updates.push(text))).toBe("JSON reply");
    expect(updates).toEqual(["JSON reply"]);
  });
  it("reads chunked SSE with CRLF and a final data frame without a newline", async () => {
    const updates = [];
    const response = sse(['data: {"choices":[{"delta":{"content":"Halo "}}]}\r', '\n\r\ndata: {"choices":[{"delta":{"content":"dunia"}}]}\n\ndata: [DONE]']);
    expect(await readChatResponse(response, (text) => updates.push(text))).toBe("Halo dunia");
    expect(updates).toEqual(["Halo ", "Halo dunia"]);
  });
  it("surfaces upstream errors inside a successful HTTP stream", async () => {
    await expect(readChatResponse(sse(['data: {"error":{"message":"Quota exhausted"}}\n\n']))).rejects.toThrow("Quota exhausted");
  });
  it("reports a truncated stream instead of pretending completion succeeded", async () => {
    await expect(readChatResponse(sse(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']))).rejects.toThrow(/interrupted/i);
  });
  it("accepts a finish_reason terminal event without a DONE sentinel", async () => {
    expect(await readChatResponse(sse(['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n']))).toBe("ok");
  });
  it("rejects an empty answer and HTTP JSON errors", async () => {
    await expect(readChatResponse(sse(['data: [DONE]\n\n']))).rejects.toThrow(/no text/i);
    await expect(readChatResponse(Response.json({ error: { message: "Missing API key" } }, { status: 401 }))).rejects.toThrow("Missing API key");
  });
});
