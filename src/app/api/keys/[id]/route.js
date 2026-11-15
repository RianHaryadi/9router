import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";
import { validateKeyAccessInput } from "@/shared/utils/keyAccess.js";

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { isActive, access, budgetLimitCents, budgetPeriod, rpmLimit, tpmLimit } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (access !== undefined) {
      const checked = validateKeyAccessInput(access);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      updateData.access = checked.value;
    }

    // Per-key monthly budget. budgetLimitCents: number >= 0, or null (= unlimited).
    if (budgetLimitCents !== undefined) {
      if (budgetLimitCents === null) {
        updateData.budgetLimitCents = null;
      } else {
        const cents = Number(budgetLimitCents);
        if (!Number.isInteger(cents) || cents < 0) {
          return NextResponse.json({ error: "budgetLimitCents must be a non-negative integer or null" }, { status: 400 });
        }
        updateData.budgetLimitCents = cents;
      }
    }
    if (budgetPeriod !== undefined && budgetPeriod !== "monthly") {
      return NextResponse.json({ error: "budgetPeriod must be 'monthly'" }, { status: 400 });
    }
    if (budgetPeriod !== undefined) updateData.budgetPeriod = budgetPeriod;
    if (rpmLimit !== undefined) {
      if (!Number.isInteger(rpmLimit) || rpmLimit < 0 || rpmLimit > 1_000_000) {
        return NextResponse.json({ error: "rpmLimit must be an integer between 0 and 1000000" }, { status: 400 });
      }
      updateData.rpmLimit = rpmLimit;
    }
    if (tpmLimit !== undefined) {
      if (!Number.isInteger(tpmLimit) || tpmLimit < 0 || tpmLimit > 1_000_000_000) {
        return NextResponse.json({ error: "tpmLimit must be an integer between 0 and 1000000000" }, { status: 400 });
      }
      updateData.tpmLimit = tpmLimit;
    }

    const updated = await updateApiKey(id, updateData);

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
