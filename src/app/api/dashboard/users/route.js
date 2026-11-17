import { NextResponse } from "next/server";
import {
  getDashboardUsers,
  createDashboardUser,
  updateDashboardUser,
  deleteDashboardUser,
} from "@/lib/localDb";
import { isOwnerSession } from "@/dashboardGuard";

export const dynamic = "force-dynamic";

// Owner-only: manages the teammate accounts that may use Basic Chat.
async function requireOwner(request) {
  return await isOwnerSession(request);
}

// GET /api/dashboard/users - list teammates
export async function GET(request) {
  if (!(await requireOwner(request))) {
    return NextResponse.json({ error: "Owner only" }, { status: 403 });
  }
  try {
    const users = await getDashboardUsers();
    return NextResponse.json({ users });
  } catch (error) {
    console.log("Error fetching dashboard users:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

// POST /api/dashboard/users - create a teammate
export async function POST(request) {
  if (!(await requireOwner(request))) {
    return NextResponse.json({ error: "Owner only" }, { status: 403 });
  }
  try {
    const body = await request.json();
    const { username, password, displayName, apiKeyRef } = body;
    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
    }
    const user = await createDashboardUser({ username, password, displayName, apiKeyRef });
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    const message = error?.message || "Failed to create user";
    const status = /already exists/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

// PUT /api/dashboard/users - update a teammate
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
    const { username, password, displayName, apiKeyRef, isActive } = body;
    const user = await updateDashboardUser(id, { username, password, displayName, apiKeyRef, isActive });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Failed to update user" }, { status: 400 });
  }
}

// DELETE /api/dashboard/users - remove a teammate
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
    const deleted = await deleteDashboardUser(id);
    if (!deleted) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Failed to delete user" }, { status: 400 });
  }
}
