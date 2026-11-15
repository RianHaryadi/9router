import { NextResponse } from "next/server";
import { getPromptTemplateById, getPromptTemplateVersions } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    if (!await getPromptTemplateById(id)) return NextResponse.json({ error: "Prompt template not found" }, { status: 404 });
    return NextResponse.json({ versions: await getPromptTemplateVersions(id) });
  } catch { return NextResponse.json({ error: "Failed to fetch prompt template versions" }, { status: 500 }); }
}
