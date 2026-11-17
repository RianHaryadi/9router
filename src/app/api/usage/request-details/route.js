import { NextResponse } from "next/server";
import { getRequestDetails } from "@/lib/usageDb";
import { getSettings } from "@/lib/localDb";
import { isAuthenticated } from "@/dashboardGuard";

/**
 * GET /api/usage/request-details
 * Query parameters: page, pageSize (1-100), provider, model, connectionId, status, startDate, endDate,
 *                   includeContent ("1" → return the stored prompt/response bodies)
 *
 * includeContent is owner-only: it needs BOTH an authenticated dashboard
 * session AND the `promptInspectionEnabled` setting. The stored content is
 * every user's conversation history (prompts, tool calls, provider answers) —
 * without both gates it stays redacted, so a teammate who reaches the
 * dashboard (or a remote session) can never read it.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const pageRaw = parseInt(searchParams.get("page"));
    const page = Number.isNaN(pageRaw) ? 1 : pageRaw;
    const pageSizeRaw = parseInt(searchParams.get("pageSize"));
    const pageSize = Number.isNaN(pageSizeRaw) ? 20 : pageSizeRaw;
    const provider = searchParams.get("provider");
    const model = searchParams.get("model");
    const connectionId = searchParams.get("connectionId");
    const status = searchParams.get("status");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const wantsContent = searchParams.get("includeContent") === "1";

    if (page < 1) {
      return NextResponse.json(
        { error: "Page must be >= 1" },
        { status: 400 }
      );
    }

    if (pageSize < 1 || pageSize > 100) {
      return NextResponse.json(
        { error: "PageSize must be between 1 and 100" },
        { status: 400 }
      );
    }

    const filter = {
      page,
      pageSize
    };

    if (provider) filter.provider = provider;
    if (model) filter.model = model;
    if (connectionId) filter.connectionId = connectionId;
    if (status) filter.status = status;
    if (startDate) filter.startDate = startDate;
    if (endDate) filter.endDate = endDate;

    const result = await getRequestDetails(filter);

    // Owner-only content gate. Fails CLOSED: a settings read error keeps the
    // content redacted.
    let includeContent = false;
    if (wantsContent) {
      try {
        const settings = await getSettings();
        if (settings?.promptInspectionEnabled === true && (await isAuthenticated(request))) {
          includeContent = true;
        }
      } catch {
        includeContent = false;
      }
    }

    // Redact conversation payloads: the stored details include full request
    // bodies (user prompts, tool calls) and provider responses. Returning them
    // wholesale lets any dashboard-authenticated user (or, if requireLogin is
    // disabled, anyone) read every user's conversation history. Keep the
    // metadata (model, tokens, latency, status) but drop message content.
    const redactedDetails = (result.details || []).map((d) => {
      if (includeContent) return d;
      const redacted = { ...d };
      for (const key of ["request", "providerRequest", "providerResponse", "response"]) {
        if (redacted[key] !== undefined) {
          redacted[key] = { redacted: true };
        }
      }
      return redacted;
    });

    return NextResponse.json({ ...result, details: redactedDetails, contentIncluded: includeContent });
  } catch (error) {
    console.error("[API] Failed to get request details:", error);
    return NextResponse.json(
      { error: "Failed to fetch request details" },
      { status: 500 }
    );
  }
}
