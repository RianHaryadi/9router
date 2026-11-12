import { NextResponse } from "next/server";
import { getSnapshot } from "@/sse/services/healthBreaker.js";
import { buildMatrix, pickBestAccount, preflight, summaryByProvider } from "@/custom/guard/healthMatrix.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/matrix
 * Fork (T5): health per provider|model|account. Answers "which accounts can
 * serve this provider|model right now, and which ones are down for a reason
 * that needs a human?".
 *
 * Query: provider, model — both optional. Without them the whole matrix is
 * returned, grouped per provider.
 *
 * Internal health probe: in-memory breaker state (no auth, no DB).
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") || undefined;
    const model = searchParams.get("model") || undefined;

    const snapshot = getSnapshot();
    const matrix = buildMatrix(snapshot, { provider, model });
    const best = pickBestAccount(matrix);
    const pre = preflight(matrix, { model });

    return NextResponse.json({
      ok: true,
      matrix,
      best: best.connectionId ? best : null,
      preflight: pre,
      providers: summaryByProvider(matrix),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] Failed to build health matrix:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
