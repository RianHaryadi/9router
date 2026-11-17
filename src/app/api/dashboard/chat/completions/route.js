import { isAuthenticated, getSession } from "@/dashboardGuard";
import { dashboardRoleOf, DASHBOARD_ROLE_OWNER } from "@/lib/auth/dashboardSession";
import { getDashboardUserApiKey } from "@/lib/localDb";
import { dispatchDashboardChat } from "@/custom/wiring/dashboardChat.js";

export async function POST(request) {
  // Authenticate here too: never rely only on middleware for key injection.
  if (!(await isAuthenticated(request))) {
    return Response.json({ error: { message: "Sign in to the dashboard to use Basic Chat" } }, { status: 401 });
  }

  // A teammate member chats on THEIR OWN key: the allow-list, budget and
  // rate limits of that key decide what they can reach. The owner's chats
  // keep using the server-managed key.
  const session = await getSession(request);
  if (session && dashboardRoleOf(session) !== DASHBOARD_ROLE_OWNER) {
    const key = await getDashboardUserApiKey({
      id: session.userId,
      apiKeyRef: session.apiKeyRef || null,
    });
    if (!key) {
      return Response.json(
        { error: { message: "Your account has no API key assigned. Ask the owner to assign one." } },
        { status: 403 }
      );
    }
    return dispatchDashboardChat(request, { apiKey: key });
  }

  // The server-managed key is injected server-side, so the browser never holds
  // a router API key. Every key policy (RPM, budget, allow-list, disabled
  // state) still applies — it is enforced on the managed key.
  return dispatchDashboardChat(request);
}
