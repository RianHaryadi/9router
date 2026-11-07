import { NextResponse } from "next/server";
import { getFallbackEvents, getFallbackSummary } from "@/lib/db/index.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_OFFSET = 0;

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
 * GET /api/usage/fallbacks
 * Query parameters: limit (1-500, default 100), offset (default 0),
 * provider, model, requestId, since (ISO-8601), summary ("1" → include aggregates).
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
      offset: clampInt(searchParams.get("offset"), { fallback: DEFAULT_OFFSET, min: 0, max: Number.MAX_SAFE_INTEGER }),
    };

    const provider = searchParams.get("provider");
    const model = searchParams.get("model");
    const requestId = searchParams.get("requestId");
    if (provider) filter.provider = provider;
    if (model) filter.model = model;
    if (requestId) filter.requestId = requestId;
    if (since.value) filter.since = since.value;

    // The summary is always computed because `total` comes from it; `summary=1`
    // is accepted for explicit requests and the aggregates are returned either
    // way (the panel needs them alongside the event page).
    const [events, summary] = await Promise.all([
      getFallbackEvents(filter),
      getFallbackSummary(filter),
    ]);

    return NextResponse.json({
      ok: true,
      events: Array.isArray(events) ? events : [],
      total: summary?.total ?? 0,
      summary,
    });
  } catch (error) {
    console.error("[API] Failed to get fallback events:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch fallback events" },
      { status: 500 }
    );
  }
}
