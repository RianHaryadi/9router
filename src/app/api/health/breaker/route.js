import { NextResponse } from "next/server";
import { getSnapshot, listBlocked } from "@/sse/services/healthBreaker.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/breaker
 * Internal health probe: in-memory circuit-breaker state (no auth, no DB).
 */
export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      snapshot: getSnapshot(),
      blocked: listBlocked(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] Failed to get breaker snapshot:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
