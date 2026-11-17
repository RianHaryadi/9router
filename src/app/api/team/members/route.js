import { NextResponse } from "next/server";
import {
  getTeamMembers,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
} from "@/lib/localDb";
import { isOwnerSession } from "@/dashboardGuard";

export const dynamic = "force-dynamic";

// Owner-only: manages the teammates who may use Basic Chat.
async function requireOwner(request) {
  return await isOwnerSession(request);
}

// GET /api/team/members - list teammates
export async function GET(request) {
  if (!(await requireOwner(request))) {
    return NextResponse.json({ error: "Owner only" }, { status: 403 });
  }
  try {
    const members = await getTeamMembers();
    return NextResponse.json({ members });
  } catch (error) {
    console.log("Error fetching team members:", error);
    return NextResponse.json({ error: "Failed to fetch teammates" }, { status: 500 });
  }
}

// POST /api/team/members - create a teammate
export async function POST(request) {
  if (!(await requireOwner(request))) {
    return NextResponse.json({ error: "Owner only" }, { status: 403 });
  }
  try {
    const body = await request.json();
    const { name, password, apiKeyRef } = body;
    if (!name || !password) {
      return NextResponse.json({ error: "Name and password are required" }, { status: 400 });
    }
    const member = await createTeamMember({ name, password, apiKeyRef });
    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Failed to add teammate" }, { status: 400 });
  }
}

// PUT /api/team/members - update a teammate
export async function PUT(request) {
  if (!(await requireOwner(request))) {
    return NextResponse.json({ error: "Owner only" }, { status: 403 });
  }
  try {
    const body = await request.json();
    const { id } = body;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const { name, password, apiKeyRef, isActive } = body;
    const member = await updateTeamMember(id, { name, password, apiKeyRef, isActive });
    if (!member) {
      return NextResponse.json({ error: "Teammate not found" }, { status: 404 });
    }
    return NextResponse.json({ member });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Failed to update teammate" }, { status: 400 });
  }
}

// DELETE /api/team/members - remove a teammate
export async function DELETE(request) {
  if (!(await requireOwner(request))) {
    return NextResponse.json({ error: "Owner only" }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const deleted = await deleteTeamMember(id);
    if (!deleted) {
      return NextResponse.json({ error: "Teammate not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Failed to remove teammate" }, { status: 400 });
  }
}
