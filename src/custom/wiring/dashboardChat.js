/**
 * dashboardChat.js — one server-side entry point for dashboard-initiated chat.
 *
 * The dashboard playground (Basic Chat) and the request replay both dispatch a
 * chat request THROUGH the router without the browser ever holding a router
 * API key: the server uses its own managed key, so key policies (RPM, budget,
 * allow-list, disabled state) still apply — they are simply enforced on a key
 * the user never has to copy.
 *
 * The managed key is created on first use and never rotated afterwards, so a
 * disabled key stays disabled (the caller gets 403 instead of a silent
 * bypass).
 */

import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { getDashboardChatApiKey, enforceApiKeyRateLimit } from "@/lib/db/repos/apiKeysRepo.js";

let translatorsReady = false;

async function ensureTranslators() {
  if (translatorsReady) return;
  await initTranslators();
  translatorsReady = true;
}

/**
 * Dispatch a chat request on behalf of the dashboard.
 *
 * @param {Request} request   the original request (body is read as-is)
 * @param {object} [opts]
 * @param {string} [opts.model] override the model in the body
 * @returns {Promise<Response>} the router's response (stream or JSON)
 */
export async function dispatchDashboardChat(request, opts = {}) {
  let key;
  try {
    key = await getDashboardChatApiKey();
  } catch {
    return Response.json({ error: { message: "Dashboard chat authentication is unavailable" } }, { status: 503 });
  }
  if (!key) {
    return Response.json({ error: { message: "Dashboard Basic Chat key is disabled. Enable it in Endpoint & Key." } }, { status: 403 });
  }
  try {
    const limited = await enforceApiKeyRateLimit(key);
    if (limited) return limited;
  } catch {
    return Response.json({ error: { message: "Rate limit service unavailable" } }, { status: 503 });
  }

  await ensureTranslators();

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }
  if (opts.model) body.model = opts.model;

  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${key}`);
  headers.delete("x-api-key");
  headers.delete("x-goog-api-key");
  return handleChat(new Request(request, { headers, body: JSON.stringify(body) }));
}
