import { NextResponse } from "next/server";
import { getSpendByTask } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

/**
 * Parse an ISO-8601 `since` query value.
 * Returns { ok: false } when present but unparseable, { ok: true, value }
 * otherwise (value is undefined when the param is absent).
 */
function parseSince(raw) {
  if (raw == null || raw === "") return { ok: true, value: undefined };
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return { ok: false };
  return { ok: true, value: new Date(ms).toISOString() };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * GET /api/usage/tasks
 * Fork: spend grouped by the task the client named (x-task-id header, or
 * metadata.taskId in the body). Rows without a task roll into "unassigned".
 *
 * Query parameters: since (ISO-8601), task (exact task id).
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const since = parseSince(searchParams.get("since"));
    if (!since.ok) {
      return NextResponse.json(
        { ok: false, error: "Invalid `since` query parameter: expected an ISO-8601 date" },
        { status: 400 }
      );
    }

    const filter = {};
    if (since.value) filter.since = since.value;
    const task = searchParams.get("task");
    if (task) filter.taskId = task;

    const tasks = await getSpendByTask(filter);
    const rows = Array.isArray(tasks) ? tasks : [];

    const total = rows.reduce(
      (acc, row) => ({
        cost: acc.cost + toNumber(row?.cost),
        requests: acc.requests + toNumber(row?.requests),
      }),
      { cost: 0, requests: 0 }
    );

    return NextResponse.json({ ok: true, tasks: rows, total });
  } catch (error) {
    console.error("[API] Failed to get spend by task:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch spend by task" },
      { status: 500 }
    );
  }
}
