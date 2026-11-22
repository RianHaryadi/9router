import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

describe("combo credit fallback", () => {
  it.each([
    // Credit wording matches the errorConfig text rules ("insufficient credit" /
    // "credit balance is too low", backoff: true) -> account fallback -> next model.
    ["You have insufficient credits to make this request."],
    ["Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."],
    // A plain 400 matches no rule: it is request-scoped, so the combo advances to
    // the next member too (commit 5cdcddf5, "advance past a request-scoped 4xx
    // instead of ending the combo") and only returns the first member's own 400
    // when no member serves the request.
    ["Bad request"],
  ])("routes a 400 response correctly: %s", async (message) => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const models = ["cmc/deepseek/deepseek-v4-pro", "mistral/mistral-medium-latest"];
    const failure = Response.json({ error: { message } }, { status: 400 });
    const success = Response.json({ choices: [{ message: { content: "Hello" } }] });
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(success);

    const response = await handleComboChat({
      body, models, handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "credit-fallback", comboStrategy: "fallback",
    });

    // Both members are tried: the first one's 400 never ends the combo.
    expect(handleSingleModel.mock.calls).toEqual(models.map((model) => [body, model]));
    expect(response).toBe(success);
  });

  it("returns the first request-scoped 400 when no member serves the request", async () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const models = ["cmc/deepseek/deepseek-v4-pro", "mistral/mistral-medium-latest"];
    const failure = Response.json({ error: { message: "Bad request" } }, { status: 400 });
    const handleSingleModel = vi.fn().mockResolvedValue(failure);

    const response = await handleComboChat({
      body, models, handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "credit-fallback-400", comboStrategy: "fallback",
    });

    expect(handleSingleModel.mock.calls).toEqual(models.map((model) => [body, model]));
    expect(response).toBe(failure);
    expect(response.status).toBe(400);
  });
});
