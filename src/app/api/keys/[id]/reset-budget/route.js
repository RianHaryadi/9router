import { NextResponse } from "next/server";
import { getApiKeyById } from "@/lib/localDb";
import { resetApiKeyBudgetById } from "@/lib/db/repos/apiKeysRepo.js";

export const dynamic = "force-dynamic";

// POST /api/keys/[id]/reset-budget - Zero the key's monthly budget counter mid-period
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const ok = await resetApiKeyBudgetById(id);
    if (!ok) {
      return NextResponse.json({ error: "Failed to reset budget" }, { status: 500 });
    }

    const key = await getApiKeyById(id);
    return NextResponse.json({ key });
  } catch (error) {
    console.log("Error resetting key budget:", error);
    return NextResponse.json({ error: "Failed to reset budget" }, { status: 500 });
  }
}
