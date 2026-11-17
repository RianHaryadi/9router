import { isAuthenticated, getSession } from "@/dashboardGuard";
import { dashboardRoleOf, DASHBOARD_ROLE_OWNER } from "@/lib/auth/dashboardSession";
import { getApiKeys } from "@/lib/localDb";
import { dispatchDashboardChat } from "@/custom/wiring/dashboardChat.js";

/**
 * The raw key behind a session's key fingerprint.
 *
 * Only the server ever sees the raw value: the browser holds a JWT that
 * carries the fingerprint, and the fingerprint is resolved back to the key
 * here on every request.
 */
async function resolveSessionKey(keyRef) {
  if (!keyRef) return null;
  try {
    const keys = await getApiKeys();
    const match = keys.find((k) => k.keyRef === keyRef && k.isActive !== false);
    return match?.key || null;
  } catch {
    return null;
  }
}

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
    // The member signed in with an API key: resolve THAT key from the
    // session's fingerprint so their requests are billed to it and its
    // allow-list / budget / rate limits apply.
    const key = await resolveSessionKey(session.keyRef);
    if (!key) {
      return Response.json(
        { error: { message: "Your API key is no longer valid. Ask the owner for a new one." } },
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
