import { NextResponse } from "next/server";
import { deletePromptTemplate, getPromptTemplateById, updatePromptTemplate, updatePromptTemplateOwnedBy, deletePromptTemplateOwnedBy } from "@/lib/localDb";
import { isMemberSession, getSession } from "@/dashboardGuard";
import { ownerIdOfSession } from "@/shared/constants/memberAreas.js";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const template = await getPromptTemplateById(id);
    return template ? NextResponse.json({ template }) : NextResponse.json({ error: "Prompt template not found" }, { status: 404 });
  } catch { return NextResponse.json({ error: "Failed to fetch prompt template" }, { status: 500 }); }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    // The owner updates any template; a teammate updates only their own. The
    // ownership test lives in the repo, in the same place as the write.
    const template = (await isMemberSession(request))
      ? await updatePromptTemplateOwnedBy(id, await request.json(), {
          isOwner: false,
          memberId: ownerIdOfSession(await getSession(request)),
        })
      : await updatePromptTemplate(id, await request.json());
    return template ? NextResponse.json({ template }) : NextResponse.json({ error: "Prompt template not found" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof TypeError ? error.message : "Failed to update prompt template" }, { status: error instanceof TypeError ? 400 : 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const deleted = (await isMemberSession(request))
      ? await deletePromptTemplateOwnedBy(id, {
          isOwner: false,
          memberId: ownerIdOfSession(await getSession(request)),
        })
      : await deletePromptTemplate(id);
    return deleted ? new Response(null, { status: 204 }) : NextResponse.json({ error: "Prompt template not found" }, { status: 404 });
  } catch { return NextResponse.json({ error: "Failed to delete prompt template" }, { status: 500 }); }
}
