import { describe, expect, it } from "vitest";
import { redactChatText } from "../../open-sse/handlers/chatCore.js";

describe("redactChatText", () => {
  it("masks credentials known by common API-key prefix and shape", () => {
    expect(redactChatText({ messages: [{ content: "sk-12345678901234567890" }] }, true).messages[0].content).toBe("[REDACTED_SECRET]");
  });
  it("masks supported PII in chat text fields while preserving structure", () => {
    const body = { messages: [{ role: "user", content: "mail jane.doe@example.com, phone +1 (415) 555-2671, NIK 3175091201990001, sk_live_1234567890abcdefghij" }] };
    expect(redactChatText(body, true)).toEqual({ messages: [{ role: "user", content: "mail [REDACTED_EMAIL], phone [REDACTED_PHONE], NIK [REDACTED_NIK], [REDACTED_SECRET]" }] });
    expect(body.messages[0].content).toContain("jane.doe@example.com");
    expect(redactChatText(body, false)).toBe(body);
    expect(redactChatText({ messages: [{ content: "ghp_abcdefghijklmnopqrstuvwxyz123456" }] }, true).messages[0].content).toBe("[REDACTED_SECRET]");
  });

  it("redacts text blocks and response-style input, but ignores non-chat fields and false positives", () => {
    expect(redactChatText({ input: [{ role: "user", content: [{ type: "input_text", text: "reach a@b.co" }] }], metadata: { note: "a@b.co" }, messages: [{ content: "version 1.2.3, order 123456789012, ordinary text" }] }, true)).toEqual({ input: [{ role: "user", content: [{ type: "input_text", text: "reach [REDACTED_EMAIL]" }] }], metadata: { note: "a@b.co" }, messages: [{ content: "version 1.2.3, order 123456789012, ordinary text" }] });
  });

  it("does not mutate the provider-bound source when the caller retains the original", () => {
    const original = { messages: [{ content: "x@y.com" }] };
    const redacted = redactChatText(original, true);
    expect(redacted).not.toBe(original);
    expect(redacted.messages).not.toBe(original.messages);
    expect(redacted.messages[0].content).toBe("[REDACTED_EMAIL]");
  });
});
