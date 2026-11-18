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
 *
 * A key that was REVOKED (deactivated) resolves to null — and that is NOT
 * the same as "this member never had a key". The caller must not fall back
 * to the shared key for a revoked one: that would hand a suspended
 * teammate the owner's unrestricted key.
 */
async function resolveSessionKey(keyRef) {
  if (!keyRef) return null;
  try {
    const keys = await getApiKeys();
    const match = keys.find((k) => k.keyRef === keyRef);
    if (!match) return null;
    return match.isActive !== false ? match.key : null;
  } catch {
    return null;
  }
}

/**
 * The key a teammate chats on when the owner assigned none.
 *
 * The connections are the owner's and shared — a teammate is meant to use
 * the SAME accounts, only through a different workflow. So a teammate with
 * no key of their own falls back to the owner's shared key: the server
 * injects it, the browser never sees it, and the owner's own key policies
 * still apply (they are the owner's policies, and that is the point).
 *
 * Without this a teammate without an assigned key could not chat at all.
 */
async function resolveSharedKey() {
  try {
    const keys = await getApiKeys();
    // The owner's own key: the first unrestricted, active key. A restricted
    // one belongs to a teammate and carries that teammate's allow-list.
    const shared = keys.find((k) => k.isActive !== false && !k.access?.restricted);
    return shared?.key || null;
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
    const keyRef = session.keyRef || null;
    let key = await resolveSessionKey(keyRef);
    if (!key && keyRef) {
      // They HAD a key and it is gone or deactivated: a revoked key must
      // not become the owner's shared key. The owner assigns a new one.
      return Response.json(
        { error: { message: "Your API key is no longer valid. Ask the owner for a new one." } },
        { status: 403 }
      );
    }
    if (!key) {
      // No key of their own: use the owner's shared key. The connections are
      // shared anyway — only the workflow differs.
      key = await resolveSharedKey();
      if (!key) {
        return Response.json(
          { error: { message: "No API key is available for your account. Ask the owner to assign one." } },
          { status: 403 }
        );
      }
    }
    return dispatchDashboardChat(request, { apiKey: key });
  }

  // The server-managed key is injected server-side, so the browser never holds
  // a router API key. Every key policy (RPM, budget, allow-list, disabled
  // state) still applies — it is enforced on the managed key.
  return dispatchDashboardChat(request);
}
