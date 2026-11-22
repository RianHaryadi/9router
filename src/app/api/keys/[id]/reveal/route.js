import { NextResponse } from "next/server";
import { getApiKeyById } from "@/lib/localDb";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { isLocalRequest, isMemberSession } from "@/dashboardGuard";

export const dynamic = "force-dynamic";

const PASSWORD_HEADER = "x-9r-password";

// Reveal ONE key value to the OWNER.
//
// The key list never carries a raw value over the network: a leaked dashboard
// password must not hand out every key at once. A local request (the machine
// the router runs on) reads it straight from the DB; a remote owner re-enters
// the dashboard password, so the secret leaves the host only to the person who
// already owns it.
//
// A teammate never sees a key value — not from the list, not from here.
export async function POST(request, { params }) {
  try {
    if (await isMemberSession(request)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!isLocalRequest(request)) {
      const password = request.headers.get(PASSWORD_HEADER);
      if (!(await verifyDashboardPassword(password))) {
        return NextResponse.json({ error: "Invalid password" }, { status: 401 });
      }
    }

    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json(
      { key: key.key },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.log("Error revealing key:", error);
    return NextResponse.json({ error: "Failed to reveal key" }, { status: 500 });
  }
}
