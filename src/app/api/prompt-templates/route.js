import { NextResponse } from "next/server";
import { getPromptTemplates, createPromptTemplate } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json({ templates: await getPromptTemplates() }); }
  catch { return NextResponse.json({ error: "Failed to fetch prompt templates" }, { status: 500 }); }
}

export async function POST(request) {
  try {
    const template = await createPromptTemplate(await request.json());
    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof TypeError ? error.message : "Failed to create prompt template" }, { status: error instanceof TypeError ? 400 : 500 });
  }
}
