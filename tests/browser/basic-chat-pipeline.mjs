// Full UI -> dashboard route -> router -> local upstream fixture.
// Requires a disposable app DATA_DIR with requireLogin=true and requireApiKey=true.
// BASIC_CHAT_ISOLATED=1 node tests/browser/basic-chat-pipeline.mjs
import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright-core";

if (process.env.BASIC_CHAT_ISOLATED !== "1") throw new Error("Use a disposable app instance and set BASIC_CHAT_ISOLATED=1");
const origin = process.env.BASIC_CHAT_URL || "http://127.0.0.1:20129";
if (new URL(origin).hostname !== "127.0.0.1") throw new Error("This write probe is loopback-only");
const calls = [];
const upstream = http.createServer(async (req, res) => {
  if (req.url === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ data: [{ id: "vendor/pipeline-model", name: "Pipeline model" }] }));
  }
  const buffers = [];
  for await (const chunk of req) buffers.push(chunk);
  const body = JSON.parse(Buffer.concat(buffers).toString());
  calls.push(body);
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "Real pipeline fixture reply" }, finish_reason: null }] })}\n\n`);
  res.end(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
let browser, connectionId, nodeId, comboId;
let managedKeyId;
let cookie;
const unique = `qa-chat-${Date.now()}`;
async function api(path, method = "GET", body) {
  const response = await fetch(`${origin}${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.equal(response.ok, true, `${method} ${path}: ${response.status}`);
  return data;
}
try {
  const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: process.env.BASIC_CHAT_TEST_PASSWORD || "qa-dashboard-only-password" }) });
  assert.equal(login.status, 200, "Disposable fixture dashboard login");
  cookie = login.headers.getSetCookie().find((value) => value.startsWith("auth_token="))?.split(";")[0];
  assert.ok(cookie);
  const settings = await api("/api/settings");
  assert.equal(settings.requireLogin, true);
  assert.equal(settings.requireApiKey, true, "Run the regression with public API key enforcement ON");
  const denied = await fetch(`${origin}/api/dashboard/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", redirect: "manual" });
  assert.equal(denied.status, 401, "Anonymous callers must not get automatic authentication");
  const publicDenied = await fetch(`${origin}/api/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", Cookie: cookie }, body: JSON.stringify({ model: "auth-diagnostic", messages: [] }) });
  assert.equal(publicDenied.status, 401, "A dashboard cookie must not bypass public API key enforcement");
  console.log("PASS anonymous dashboard denial and public API key requirement");
  const { node } = await api("/api/provider-nodes", "POST", { name: "Pipeline fixture", prefix: unique, apiType: "chat", baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, type: "openai-compatible" });
  nodeId = node.id;
  const { connection } = await api("/api/providers", "POST", { provider: node.id, name: unique, apiKey: "fixture-not-a-live-key" });
  connectionId = connection.id;
  const combo = await api("/api/combos", "POST", { name: unique, models: [`${node.id}/vendor/pipeline-model`], kind: "llm" });
  comboId = combo.id;
  browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.context().addCookies([{ name: "auth_token", value: cookie.slice("auth_token=".length), url: origin, httpOnly: true, sameSite: "Lax" }]);
  const browserKeys = [];
  page.on("request", (request) => { if (request.url().endsWith("/api/dashboard/chat/completions")) browserKeys.push(request.headers().authorization); });
  await page.goto(`${origin}/dashboard/basic-chat`);
  await page.getByRole("button", { name: "Select model" }).filter({ hasText: "Pipeline model" }).waitFor();
  await page.getByPlaceholder("Message AI").fill("Pipeline question");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByText("Real pipeline fixture reply", { exact: true }).waitFor({ timeout: 20000 });
  assert.equal(calls.at(-1).model, "vendor/pipeline-model");
  assert.equal(calls.at(-1).messages.at(-1).content, "Pipeline question");
  console.log("PASS UI -> dashboard API -> shared router -> local upstream -> SSE reply");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByRole("button", { name: "Select model" }).click();
  await page.getByRole("button", { name: unique }).click();
  await page.getByPlaceholder("Message AI").fill("Combo pipeline question");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByText("Real pipeline fixture reply", { exact: true }).waitFor({ timeout: 20000 });
  assert.equal(calls.length, 2);
  assert.equal(calls.at(-1).messages.at(-1).content, "Combo pipeline question");
  console.log("PASS combo -> shared router -> upstream");
  const managed = (await api("/api/keys")).keys.find((key) => key.id === "dashboard-basic-chat");
  assert.ok(managed, "One managed key must exist after chat");
  managedKeyId = managed.id;
  assert.equal(browserKeys.every((value) => value === undefined), true, "Browser sends only its session, never the managed API key");
  assert.equal((await page.evaluate(() => JSON.stringify(localStorage))).includes(managed.key), false);
  const chat = () => fetch(`${origin}/api/dashboard/chat/completions`, { method: "POST", headers: { "content-type": "application/json", Cookie: cookie }, body: JSON.stringify({ model: `${node.id}/vendor/pipeline-model`, messages: [{ role: "user", content: "Policy check" }], stream: true }) });
  await api(`/api/keys/${managed.id}`, "PUT", { rpmLimit: 1 });
  const allowed = await chat();
  assert.equal(allowed.status, 200);
  await allowed.text();
  assert.equal((await chat()).status, 429);
  await api(`/api/keys/${managed.id}`, "PUT", { rpmLimit: 0, budgetLimitCents: 0 });
  assert.equal((await chat()).status, 402);
  await api(`/api/keys/${managed.id}`, "PUT", { budgetLimitCents: null, access: { restricted: true, allow: [] } });
  assert.equal((await chat()).status, 403);
  await api(`/api/keys/${managed.id}`, "PUT", { access: { restricted: false, allow: [] }, isActive: false });
  assert.equal((await chat()).status, 403);
  assert.equal(calls.length, 3, "Denied requests must not dispatch upstream");
  console.log("PASS automatic key preserves RPM, budget, allowlist and disabled-state policies");
  const screenshot = `${process.env.TMPDIR}/9router-basic-chat-qa/basic-chat-desktop.png`;
  await page.screenshot({ path: screenshot });
  console.log(`Screenshot: ${screenshot}`);
} finally {
  await browser?.close();
  if (managedKeyId) await api(`/api/keys/${managedKeyId}`, "DELETE");
  if (comboId) await api(`/api/combos/${comboId}`, "DELETE");
  if (connectionId) await api(`/api/providers/${connectionId}`, "DELETE");
  if (nodeId) await api(`/api/provider-nodes/${nodeId}`, "DELETE");
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
}
