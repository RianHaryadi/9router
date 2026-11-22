import { NextResponse } from "next/server";
import { shadowStats, recentShadowDispatches } from "@/custom/wiring/shadowDispatch.js";
import { compareResponses } from "@/custom/routing/shadow.js";
import { getSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/shadow
 * Fork: what the shadow router has been doing.
 *
 * Shadow routing sends a sampled share of requests to a second provider and
 * compares the two answers. Until now the comparison was computed and thrown
 * away — `shadowStats()` and `recentShadowDispatches()` existed but nothing
 * called them, so there was no way to tell whether a shadow target was worth
 * keeping.
 *
 * The ANSWER TEXT is deliberately not returned. A shadow record holds the
 * primary and the shadow answer verbatim, and those are the user's own
 * conversations; only the comparison verdict and the model descriptors are
 * exposed.
 *
 * Query: limit (1..200, default 50).
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = Number(searchParams.get("limit"));
    const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.floor(rawLimit))) : 50;

    const settings = await getSettings();
    const stats = shadowStats();
    const recent = recentShadowDispatches(limit).map((entry) => ({
      requestId: entry?.requestId ?? null,
      primary: entry?.primary ?? null,
      shadow: entry?.shadow ?? null,
      matched: compareResponses(entry?.primaryText || "", entry?.shadowText || "").matched,
      similarity: compareResponses(entry?.primaryText || "", entry?.shadowText || "").similarity,
      hasPrimaryText: typeof entry?.primaryText === "string" && entry.primaryText.length > 0,
      hasShadowText: typeof entry?.shadowText === "string" && entry.shadowText.length > 0,
      latencyMs: entry?.latencyMs ?? null,
      error: entry?.error ?? null,
      at: entry?.at ?? null,
    }));

    return NextResponse.json({
      ok: true,
      enabled: settings?.shadowRoutingEnabled === true,
      ratio: Number(settings?.shadowRoutingRatio) || 0,
      targets: Array.isArray(settings?.shadowRoutingTargets) ? settings.shadowRoutingTargets : [],
      stats,
      recent,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] Failed to get shadow stats:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
