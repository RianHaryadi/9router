import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { isAuthenticated } from "@/dashboardGuard";
import { getDashboardChatApiKey, enforceApiKeyRateLimit } from "@/lib/db/repos/apiKeysRepo.js";

let initialized = false;

export async function POST(request) {
  // Authenticate here too: never rely only on middleware for key injection.
  if (!(await isAuthenticated(request))) {
    return Response.json({ error: { message: "Sign in to the dashboard to use Basic Chat" } }, { status: 401 });
  }
  let key;
  try {
    key = await getDashboardChatApiKey();
    if (!key) {
      return Response.json({ error: { message: "Dashboard Basic Chat key is disabled. Enable it in Endpoint & Key." } }, { status: 403 });
    }
    const limited = await enforceApiKeyRateLimit(key);
    if (limited) return limited;
  } catch {
    return Response.json({ error: { message: "Dashboard chat authentication is unavailable" } }, { status: 503 });
  }
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${key}`);
  headers.delete("x-api-key");
  headers.delete("x-goog-api-key");
  // Preserve normal key validation, access restrictions, budgets and accounting.
  return handleChat(new Request(request, { headers }));
}
