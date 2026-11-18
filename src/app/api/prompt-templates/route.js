import { NextResponse } from "next/server";
import { getPromptTemplates, createPromptTemplate } from "@/lib/localDb";
import { isMemberSession, getSession } from "@/dashboardGuard";
import { ownerIdOfSession } from "@/shared/constants/memberAreas.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const templates = await getPromptTemplates();
    // The owner may write every template; a teammate only their own. The
    // flag is what the dashboard uses to show the edit/delete actions.
    const memberId = (await isMemberSession(request)) ? ownerIdOfSession(await getSession(request)) : null;
    return NextResponse.json({
      templates: templates.map((t) => ({ ...t, canWrite: memberId === null ? true : t.ownerId === memberId })),
    });
  }
  catch { return NextResponse.json({ error: "Failed to fetch prompt templates" }, { status: 500 }); }
}

export async function POST(request) {
  try {
    // A teammate creates the template as their own: the row is bound to their
    // member id, so they may edit or delete it later. The owner creates it
    // with no owner id (owner-owned).
    const ownerId = (await isMemberSession(request)) ? ownerIdOfSession(await getSession(request)) : null;
    const template = await createPromptTemplate({ ...(await request.json()), ownerId });
    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof TypeError ? error.message : "Failed to create prompt template" }, { status: error instanceof TypeError ? 400 : 500 });
  }
}
