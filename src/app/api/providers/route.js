import { NextResponse } from "next/server";
import {
  getProviderConnections,
  createProviderConnection,
  getProviderNodeById,
  getProviderNodes,
  getProxyPoolById,
} from "@/models";
import { APIKEY_PROVIDERS } from "@/shared/constants/config";
import { AI_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider } from "@/shared/constants/providers";
import { normalizeProviderId, normalizeProviderSpecificData } from "@/lib/providerNormalization";
import { toProviderConnectionResponse } from "@/lib/providerConnectionResponse";
import { isMemberSession, getSession } from "@/dashboardGuard";
import { getApiKeys } from "@/lib/localDb";

export const dynamic = "force-dynamic";

function normalizeProxyConfig(body = {}) {
  const enabled = body?.connectionProxyEnabled === true;
  const url = typeof body?.connectionProxyUrl === "string" ? body.connectionProxyUrl.trim() : "";
  const noProxy = typeof body?.connectionNoProxy === "string" ? body.connectionNoProxy.trim() : "";

  if (enabled && !url) {
    return { error: "Connection proxy URL is required when connection proxy is enabled" };
  }

  return {
    connectionProxyEnabled: enabled,
    connectionProxyUrl: url,
    connectionNoProxy: noProxy,
  };
}

async function normalizeProxyPoolId(proxyPoolId) {
  if (proxyPoolId === undefined || proxyPoolId === null || proxyPoolId === "" || proxyPoolId === "__none__") {
    return { proxyPoolId: null };
  }

  const normalizedId = String(proxyPoolId).trim();
  if (!normalizedId) {
    return { proxyPoolId: null };
  }

  const proxyPool = await getProxyPoolById(normalizedId);
  if (!proxyPool) {
    return { error: "Proxy pool not found" };
  }

  return { proxyPoolId: normalizedId };
}

/**
 * The connections a key may reach.
 *
 * The key's allow-list is the same list that gates /v1 calls, so the model
 * picker and the router agree: a member sees exactly what their key allows.
 * A combo name expands to the providers of its members.
 */
async function filterConnectionsForKey(connections, apiKey) {
  if (!apiKey) return [];
  try {
    const { accessContextForKey } = await import("@/sse/services/keyAccess.js");
    const { getCombos } = await import("@/lib/localDb.js");
    const { resolveProviderId } = await import("@/shared/constants/providers.js");
    const ctx = await accessContextForKey(apiKey);
    // An unrestricted key sees everything (same rule as the router).
    if (!ctx) return connections;

    const combos = await getCombos();
    // Provider IDs the key may reach. An allow-list entry names a combo, a
    // "provider/model" pair or a bare provider — and a combo's seats are
    // written with the transport ALIAS ("oc/…"), while a connection row
    // carries the provider ID ("opencode-go"). Both sides are resolved to the
    // provider ID so the two meet.
    const providers = new Set();
    const addProvider = (name) => {
      if (!name) return;
      providers.add(String(resolveProviderId(name)).toLowerCase());
      providers.add(String(name).toLowerCase());
    };

    for (const entry of ctx.allow) {
      const lower = String(entry).toLowerCase();
      // A combo name → its members' providers.
      const combo = combos.find((c) => String(c.name).toLowerCase() === lower);
      if (combo) {
        for (const seat of combo.models || []) {
          const slash = seat.indexOf("/");
          if (slash > 0) addProvider(seat.slice(0, slash));
        }
        continue;
      }
      // "provider/model" → that provider.
      const slash = entry.indexOf("/");
      if (slash > 0) {
        addProvider(entry.slice(0, slash));
        continue;
      }
      // A bare provider id or alias.
      addProvider(lower);
    }

    return connections.filter((c) => {
      const provider = String(c.provider || "").toLowerCase();
      return providers.has(provider) || providers.has(String(resolveProviderId(c.provider || "")).toLowerCase());
    });
  } catch {
    return [];
  }
}

// GET /api/providers - List all connections
export async function GET(request) {
  try {
    const connections = await getProviderConnections();

    // Build nodeNameMap for compatible providers (id → name)
    let nodeNameMap = {};
    try {
      const nodes = await getProviderNodes();
      for (const node of nodes) {
        if (node.id && node.name) nodeNameMap[node.id] = node.name;
      }
    } catch { }

    // A teammate member may read the connection list (the chat model picker
    // needs it) but must not learn anything about the owner's accounts:
    // no email, no status, no errors, no ids beyond the provider id.
    //
    // They also only see the PROVIDERS their own key may reach — the key's
    // allow-list decides what the picker offers, exactly like it decides
    // what the key may call.
    const isMember = await isMemberSession(request);
    let memberKey = null;
    if (isMember) {
      const session = await getSession(request);
      const ref = session?.keyRef || null;
      if (ref) {
        try {
          const keys = await getApiKeys();
          memberKey = keys.find((k) => k.keyRef === ref && k.isActive !== false)?.key || null;
        } catch { memberKey = null; }
      }
    }

    // A member only sees the providers their key may reach. The allow-list
    // holds either "provider/model" entries or combo names; a combo expands to
    // its members' providers.
    let visibleConnections = connections;
    if (isMember) {
      visibleConnections = await filterConnectionsForKey(connections, memberKey);
    }

    // Hide sensitive fields, enrich name for compatible providers
    const safeConnections = visibleConnections.map(c => {
      const isCompatible = isOpenAICompatibleProvider(c.provider) || isAnthropicCompatibleProvider(c.provider);
      const name = isCompatible
        ? (c.name || nodeNameMap[c.provider] || c.providerSpecificData?.nodeName || c.provider)
        : c.name;
      const safe = {
        ...toProviderConnectionResponse(c),
        name,
      };
      if (!isMember) return safe;
      // A member must not learn anything about the owner's accounts: no
      // account name, no email, no status, no errors. The connection ID stays
      // because the chat picker fetches that connection's live model catalog
      // with it — it is an opaque handle, not an account identity.
      const { email, displayName, testStatus, lastError, lastErrorAt, errorCode, lastUsedAt, consecutiveUseCount, rateLimitedUntil, expiresAt, expiresIn, defaultModel, globalPriority, priority, projectId, providerSpecificData, ...rest } = safe;
      return {
        ...rest,
        provider: safe.provider,
        // The provider's display name, never the account's name (for OAuth
        // connections that IS the email).
        name: AI_PROVIDERS[safe.provider]?.name || safe.provider,
        authType: safe.authType,
        isActive: safe.isActive,
      };
    });

    return NextResponse.json({ connections: safeConnections });
  } catch (error) {
    console.log("Error fetching providers:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}

// POST /api/providers - Create new connection (API Key only, OAuth via separate flow)
export async function POST(request) {
  try {
    const body = await request.json();
    const provider = normalizeProviderId(body.provider);
    const { apiKey, name, displayName, priority, globalPriority, defaultModel, testStatus } = body;
    const proxyConfig = normalizeProxyConfig(body);
    if (proxyConfig.error) {
      return NextResponse.json({ error: proxyConfig.error }, { status: 400 });
    }

    const proxyPoolResult = await normalizeProxyPoolId(body.proxyPoolId);
    if (proxyPoolResult.error) {
      return NextResponse.json({ error: proxyPoolResult.error }, { status: 400 });
    }
    const proxyPoolId = proxyPoolResult.proxyPoolId;

    // Validation
    const isWebCookieProvider = !!WEB_COOKIE_PROVIDERS[provider];
    // Dual-auth providers (e.g. codebuddy-cn, xai) live under category "oauth" but also
    // accept an API key via authModes — they aren't in APIKEY_PROVIDERS, so allow them here.
    const supportsApiKeyMode = !!AI_PROVIDERS[provider]?.authModes?.includes("apikey");
    const isValidProvider = APIKEY_PROVIDERS[provider] ||
      FREE_TIER_PROVIDERS[provider] ||
      supportsApiKeyMode ||
      isWebCookieProvider ||
      isOpenAICompatibleProvider(provider) ||
      isAnthropicCompatibleProvider(provider) ||
      isCustomEmbeddingProvider(provider);

    if (!provider || !isValidProvider) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
    // A provider may declare a providerSpecificData field that stands in for an API key — e.g.
    // Bedrock's `profile`, where the credential lives in the local AWS config and there is no
    // key to paste. Without this, following such a provider's own setup notice returns 400.
    const apiKeySubstitute = AI_PROVIDERS[provider]?.apiKeyOptionalWith;
    const hasApiKeySubstitute = !!(apiKeySubstitute && body.providerSpecificData?.[apiKeySubstitute]);
    if (!apiKey && provider !== "ollama-local" && !hasApiKeySubstitute) {
      return NextResponse.json({ error: `${isWebCookieProvider ? "Cookie value" : "API Key"} is required` }, { status: 400 });
    }
    const connectionName = name || displayName || AI_PROVIDERS[provider]?.name;
    if (!connectionName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    let providerSpecificData = normalizeProviderSpecificData(provider, body, body.providerSpecificData);

    // Compatible LLM nodes support multiple API-key connections (key pool); runtime
    // rotates/fails over via getProviderCredentials. Embedding nodes stay single-connection.
    if (isOpenAICompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "OpenAI Compatible node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        apiType: node.apiType,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    } else if (isAnthropicCompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "Anthropic Compatible node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    } else if (isCustomEmbeddingProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "Custom Embedding node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    }

    const mergedProviderSpecificData = {
      ...(providerSpecificData || {}),
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled,
      connectionProxyUrl: proxyConfig.connectionProxyUrl,
      connectionNoProxy: proxyConfig.connectionNoProxy,
    };

    if (proxyPoolId !== null) {
      mergedProviderSpecificData.proxyPoolId = proxyPoolId;
    }

    const newConnection = await createProviderConnection({
      provider,
      authType: isWebCookieProvider ? "cookie" : "apikey",
      name: connectionName,
      apiKey: apiKey || "",
      priority: priority || 1,
      globalPriority: globalPriority || null,
      defaultModel: defaultModel || null,
      providerSpecificData: mergedProviderSpecificData,
      isActive: true,
      testStatus: testStatus || "unknown",
      // POST with an id is an explicit edit of that connection; without one, a
      // name collision is refused rather than silently overwriting a key. #4311
      allowOverwrite: body.id ? true : (body.allowOverwrite === true || body.overwrite === true),
    });

    return NextResponse.json(
      { connection: toProviderConnectionResponse(newConnection) },
      { status: 201 },
    );
  } catch (error) {
    if (error?.code === "PROVIDER_NAME_CONFLICT") {
      return NextResponse.json(
        { error: error.message, code: error.code, existingId: error.existingId, existingName: error.existingName },
        { status: 409 }
      );
    }
    console.log("Error creating provider:", error);
    return NextResponse.json({ error: "Failed to create provider" }, { status: 500 });
  }
}
