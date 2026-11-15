import { NextResponse } from "next/server";
import { deletePromptTemplate, getPromptTemplateById, updatePromptTemplate } from "@/lib/localDb";

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
    const template = await updatePromptTemplate(id, await request.json());
    return template ? NextResponse.json({ template }) : NextResponse.json({ error: "Prompt template not found" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof TypeError ? error.message : "Failed to update prompt template" }, { status: error instanceof TypeError ? 400 : 500 });
  }
}

export async function DELETE(_request, { params }) {
  try {
    const { id } = await params;
    return await deletePromptTemplate(id) ? new Response(null, { status: 204 }) : NextResponse.json({ error: "Prompt template not found" }, { status: 404 });
  } catch { return NextResponse.json({ error: "Failed to delete prompt template" }, { status: 500 }); }
}
