import { isAuthenticated } from "@/dashboardGuard";
import { dispatchDashboardChat } from "@/custom/wiring/dashboardChat.js";

export async function POST(request) {
  // Authenticate here too: never rely only on middleware for key injection.
  if (!(await isAuthenticated(request))) {
    return Response.json({ error: { message: "Sign in to the dashboard to use Basic Chat" } }, { status: 401 });
  }
  // The server-managed key is injected server-side, so the browser never holds
  // a router API key. Every key policy (RPM, budget, allow-list, disabled
  // state) still applies — it is enforced on the managed key.
  return dispatchDashboardChat(request);
}
