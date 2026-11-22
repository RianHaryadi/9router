import { NextResponse } from "next/server";
import { getLatencyPercentiles, getProviderHealthSnapshot } from "@/lib/db/index.js";

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10000;

export const dynamic = "force-dynamic";

function clampInt(value, { fallback, min, max }) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

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

/**
 * GET /api/usage/latency
 * Query parameters: provider, model, since (ISO-8601), limit (1-10000, default 1000).
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

    const filter = {
      limit: clampInt(searchParams.get("limit"), { fallback: DEFAULT_LIMIT, min: 1, max: MAX_LIMIT }),
    };

    const provider = searchParams.get("provider");
    const model = searchParams.get("model");
    if (provider) filter.provider = provider;
    if (model) filter.model = model;
    if (since.value) filter.since = since.value;

    const [percentiles, providers] = await Promise.all([
      getLatencyPercentiles(filter),
      getProviderHealthSnapshot(filter),
    ]);

    return NextResponse.json({
      ok: true,
      ...percentiles,
      providers,
    });
  } catch (error) {
    console.error("[API] Failed to get latency percentiles:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch latency percentiles" },
      { status: 500 }
    );
  }
}
