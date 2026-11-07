import { NextResponse } from "next/server";
import { getSpendByProject } from "@/lib/db/index.js";

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
 * GET /api/usage/projects
 * Query parameters: since (ISO-8601).
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

    const projects = await getSpendByProject(filter);
    const rows = Array.isArray(projects) ? projects : [];

    const total = rows.reduce(
      (acc, row) => ({
        cost: acc.cost + toNumber(row?.cost),
        requests: acc.requests + toNumber(row?.requests),
      }),
      { cost: 0, requests: 0 }
    );

    return NextResponse.json({ ok: true, projects: rows, total });
  } catch (error) {
    console.error("[API] Failed to get spend by project:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch spend by project" },
      { status: 500 }
    );
  }
}
