// Browser regression test with explicit API fixtures; no provider traffic.
// Run: BASIC_CHAT_URL=http://127.0.0.1:20129 node tests/browser/basic-chat.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const origin = process.env.BASIC_CHAT_URL || "http://127.0.0.1:20129";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
const requests = [];
const authHeaders = [];
let mode = "json";
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  let json = {};
  if (path === "/api/providers") json = { connections: [{ id: "fixture", provider: "openai-compatible-qa", name: "QA provider", isActive: true }] };
  else if (path === "/api/providers/fixture/models") json = { models: [{ id: "vendor/test-model", name: "QA model" }] };
  else if (path === "/api/combos") json = { combos: [{ id: "qa-combo", name: "qa-fallback", models: ["openai-compatible-qa/vendor/test-model"] }] };
  else if (path === "/api/auth/status") json = { authenticated: true };
  else if (path === "/api/settings") json = { requireLogin: false };
  else if (path === "/api/dashboard/chat/completions") {
    requests.push(route.request().postDataJSON());
    authHeaders.push(route.request().headers().authorization);
    if (mode === "slow") {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return route.fulfill({ json: { choices: [{ message: { content: "Late reply" } }] } }).catch(() => {});
    }
    if (mode === "sse") return route.fulfill({ contentType: "text/event-stream", body: 'data: {"choices":[{"delta":{"content":"Stream reply"}}]}\n\ndata: [DONE]' });
    if (mode === "error") return route.fulfill({ contentType: "text/event-stream", body: 'data: {"error":{"message":"Fixture quota exhausted"}}\n\n' });
    json = { choices: [{ message: { content: "JSON fixture reply" } }] };
  }
  return route.fulfill({ json });
});
try {
  await page.goto(`${origin}/dashboard/basic-chat`);
  await page.getByRole("button", { name: "Select model" }).filter({ hasText: "QA model" }).waitFor();
  assert.equal(await page.locator('aside a[href="/dashboard/basic-chat"]:visible').count(), 1, "Basic Chat must be in the visible sidebar");
  await page.getByPlaceholder("Message AI").fill("First question");
  await page.getByPlaceholder("Message AI").press("Enter");
  await page.getByText("JSON fixture reply", { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(requests[0].model, "openai-compatible-qa/vendor/test-model");
  console.log("PASS sidebar, routed namespaced model, JSON reply");

  mode = "sse";
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByPlaceholder("Message AI").fill("Second question");
  await page.getByPlaceholder("Message AI").press("Enter");
  await page.getByText("Stream reply", { exact: true }).waitFor();
  console.log("PASS new chat and SSE final frame");

  mode = "error";
  await page.getByPlaceholder("Message AI").fill("Third question");
  await page.getByPlaceholder("Message AI").press("Enter");
  await page.getByRole("alert").filter({ hasText: "Fixture quota exhausted" }).waitFor();
  console.log("PASS SSE error surfaced");

  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByRole("button", { name: "Select model" }).click();
  await page.getByRole("button", { name: /qa-fallback/ }).click();
  mode = "json";
  await page.getByPlaceholder("Message AI").fill("Combo question");
  await page.getByPlaceholder("Message AI").press("Enter");
  await page.getByText("JSON fixture reply", { exact: true }).waitFor();
  assert.equal(requests.at(-1).model, "qa-fallback");
  console.log("PASS combo selection uses exact router target");

  await page.reload();
  await page.getByText("JSON fixture reply", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  assert.equal(await page.getByText("Combo question", { exact: true }).count(), 0);
  console.log("PASS persistence and clear");

  await page.getByRole("button", { name: "New chat", exact: true }).click();
  mode = "slow";
  await page.getByPlaceholder("Message AI").fill("Stop this request");
  await page.getByPlaceholder("Message AI").press("Enter");
  await page.getByRole("button", { name: "Stop response" }).click();
  await page.getByText("Stopped", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "New chat", exact: true }).isEnabled(), true);
  console.log("PASS stop returns chat to an idle state");

  mode = "json";
  assert.equal(await page.getByLabel("Router API key", { exact: true }).count(), 0, "No manual API key field in dashboard chat");
  await page.getByPlaceholder("Message AI").fill("Automatic dashboard authentication");
  await page.getByPlaceholder("Message AI").press("Enter");
  await page.getByText("JSON fixture reply", { exact: true }).waitFor();
  assert.equal(authHeaders.every((value) => value === undefined), true, "Browser must not handle any router key");
  assert.equal(requests.at(-1).messages.some((message) => message.role === "assistant" && !message.content), false);
  console.log("PASS no manual key or client-side Authorization header");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Select model" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Mobile page must not overflow");
  assert.equal(await page.evaluate(() => {
    const menu = document.querySelector('[data-testid="chat-model-menu"]');
    const rect = menu?.getBoundingClientRect();
    return !!rect && rect.right <= innerWidth && rect.left >= 0;
  }), true, "Model menu must fit mobile viewport");
  console.log("PASS mobile model menu");
  assert.deepEqual(errors, [], "No browser runtime/hydration errors");
  console.log("PASS no runtime/hydration errors");
} finally {
  await browser.close();
}
