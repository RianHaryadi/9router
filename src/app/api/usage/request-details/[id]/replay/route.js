import { NextResponse } from "next/server";
import { isAuthenticated } from "@/dashboardGuard";
import { getRequestDetailById } from "@/lib/usageDb";
import { dispatchDashboardChat } from "@/custom/wiring/dashboardChat.js";

/**
 * POST /api/usage/request-details/[id]/replay
 *
 * Re-runs a stored request through the router with the dashboard's own
 * managed key. The stored detail holds the original model + messages, so the
 * operator can reproduce a failure without copying the request by hand.
 *
 * The request body is rebuilt from the STORED snapshot, never from anything
 * the caller sends, so this endpoint cannot be used to smuggle an arbitrary
 * prompt past the dashboard.
 */
export async function POST(request, { params }) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  let detail = null;
  try {
    detail = await getRequestDetailById(id);
  } catch {
    return NextResponse.json({ error: "Failed to load request detail" }, { status: 500 });
  }
  if (!detail) {
    return NextResponse.json({ error: "Request detail not found" }, { status: 404 });
  }

  const stored = detail.request || {};
  const model = stored.model || detail.model;
  if (!model) {
    return NextResponse.json({ error: "Stored request has no model to replay" }, { status: 422 });
  }
  if (!Array.isArray(stored.messages) || stored.messages.length === 0) {
    return NextResponse.json({ error: "Stored request has no messages to replay" }, { status: 422 });
  }

  const body = { ...stored, model, stream: false };
  const replayRequest = new Request("http://localhost/api/dashboard/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const response = await dispatchDashboardChat(replayRequest, { model });
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") || "application/json" },
  });
}
