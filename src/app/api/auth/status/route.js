import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { isSamlConfigured } from "@/lib/auth/saml.js";
import { getDashboardAuthSession, dashboardRoleOf } from "@/lib/auth/dashboardSession";
import { MEMBER_BASE_AREAS } from "@/shared/constants/memberAreas";

/**
 * The areas the signed-in member may reach.
 * Read live from the member row: the owner grants an area in the dashboard
 * and it must show up for the teammate right away.
 */
async function memberAreasForStatus(session) {
  if (dashboardRoleOf(session) === "owner") return [];
  const areas = new Set(MEMBER_BASE_AREAS);
  const memberId = session?.userId || null;
  if (!memberId) return [...areas];
  try {
    const { getTeamMemberById } = await import("@/lib/db/repos/teamMembersRepo.js");
    const member = await getTeamMemberById(memberId);
    if (!member || member.isActive === false) return [...areas];
    for (const id of member.areas || []) areas.add(id);
  } catch {
    /* fail closed: base areas only */
  }
  return [...areas];
}

export async function GET() {
  try {
    const settings = await getSettings();
    const cookieStore = await cookies();
    const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
    const requireLogin = settings.requireLogin !== false;
    const authMode = settings.authMode || "password";
    const ssoType = settings.ssoType || "oidc";
    const oidcName = String(session?.oidcName || "").trim();
    const oidcEmail = String(session?.oidcEmail || "").trim();
    const samlName = String(session?.samlName || "").trim();
    const samlEmail = String(session?.samlEmail || "").trim();

    const displayName =
      samlName ||
      samlEmail ||
      oidcName ||
      oidcEmail ||
      session?.username ||
      (session?.saml ? "SAML user" : session?.oidc ? "OIDC user" : "Password user");

    const loginMethod = session?.saml ? "SAML" : session?.oidc ? "OIDC" : "Password";

    return NextResponse.json({
      requireLogin,
      authMode,
      ssoType,
      oidcConfigured: isOidcConfigured(settings),
      oidcLoginLabel: (settings.oidcLoginLabel || "Sign in with OIDC").trim() || "Sign in with OIDC",
      samlConfigured: isSamlConfigured(settings),
      samlLoginLabel: (settings.samlLoginLabel || "Sign in with SAML SSO").trim() || "Sign in with SAML SSO",
      hasPassword: !!settings.password,
      role: session ? dashboardRoleOf(session) : null,
      username: session?.username || null,
      // The areas the member may reach, read live so a grant takes effect
      // without waiting for the teammate to sign in again.
      areas: session ? await memberAreasForStatus(session) : [],
      displayName,
      loginMethod,
      authenticated: !!session,
      oidcName: oidcName || null,
      oidcEmail: oidcEmail || null,
      oidcLogin: !!session?.oidc,
      samlName: samlName || null,
      samlEmail: samlEmail || null,
      samlLogin: !!session?.saml,
    });
  } catch {
    return NextResponse.json({
      requireLogin: true,
      authMode: "password",
      ssoType: "oidc",
      oidcConfigured: false,
      oidcLoginLabel: "Sign in with OIDC",
      samlConfigured: false,
      samlLoginLabel: "Sign in with SAML SSO",
      hasPassword: false,
      displayName: "Password user",
      loginMethod: "Password",
      authenticated: false,
      oidcName: null,
      oidcEmail: null,
      oidcLogin: false,
      samlName: null,
      samlEmail: null,
      samlLogin: false,
    });
  }
}
