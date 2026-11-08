import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { handleAntigravityQuotaError, clearAntigravityStrikes } from "../services/antigravityQuota.js";
import { recordSuccess, recordFailure } from "../services/healthBreaker.js";
import { checkFallbackError } from "open-sse/services/accountFallback.js";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { upstreamResponseHeaders } from "open-sse/utils/upstreamHeaders.js";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities } from "open-sse/services/combo.js";
import { getApiKeyBudget, resetBudgetSpend } from "@/lib/db/repos/apiKeysRepo.js";
import { checkBudget, isBudgetPeriodRolledOver } from "@/custom/budget/check.js";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from "open-sse/services/capacityAdapter.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { resolveSessionIdentity } from "open-sse/utils/sessionManager.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";
import { getKeyAccessContext, enforceKeyAccess, filterAdapterModels } from "../services/keyAccess.js";
import { resolveSmartChoice } from "../services/systemoneRouter.js";
import { createRequestId, resolveProjectName } from "../services/requestContext.js";
import { saveFallbackEvent } from "@/lib/db/repos/fallbackRepo.js";
import { getApiKeyByKey } from "@/lib/db/repos/apiKeysRepo.js";
import { getAdapterSync } from "@/lib/db/driver.js";
import { createResponseCache, captureStreamResponse, replayResponse, digestBody } from "@/custom/wiring/responseCache.js";

const responseCache = createResponseCache();

/**
 * Persist one fallback event without ever touching request latency:
 * fire-and-forget, errors swallowed — observability must not break chat.
 * The adapter check keeps a log line from being the thing that OPENS the
 * database (a test process with no DATA_DIR would otherwise create/touch the
 * real ~/.9router DB); in the app getSettings() has it up long before a
 * request can fail over, so no event is ever dropped there.
 */
function logFallbackEvent(payload) {
  try {
    getAdapterSync();
    Promise.resolve(saveFallbackEvent(payload)).catch(() => { });
  } catch { /* a failed write must never reach the request */ }
}

/** apiKeys.name for project attribution; null when the key is unknown/local. */
async function lookupApiKeyName(apiKey) {
  if (!apiKey) return null;
  try {
    const record = await getApiKeyByKey(apiKey);
    return record?.name || null;
  } catch {
    return null;
  }
}

/**
 * Build the combo `onFallback` callback (option A): open-sse stays DB-free and
 * this layer owns persistence + request attribution. Every event also bumps the
 * per-request fallback counter that lands in usageHistory.fallbackCount.
 */
function makeComboFallbackReporter({ requestId, projectName, apiKey, clientRawRequest }) {
  return (evt) => {
    if (!evt) return;
    if (clientRawRequest) {
      clientRawRequest.fallbackCount = (clientRawRequest.fallbackCount || 0) + 1;
    }
    logFallbackEvent({
      requestId: evt.requestId ?? requestId,
      projectName: evt.projectName ?? projectName,
      apiKey: evt.apiKey ?? apiKey ?? null,
      connectionId: evt.connectionId ?? null,
      provider: evt.provider ?? null,
      model: evt.model ?? null,
      fromProvider: evt.fromProvider ?? null,
      fromModel: evt.fromModel ?? null,
      status: evt.status ?? null,
      reason: evt.reason == null ? null : String(evt.reason).slice(0, 500),
      cooldownMs: evt.cooldownMs ?? null,
      latencyMs: evt.latencyMs ?? null,
    });
  };
}

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }
  // Claude Code marks a 1M-context request as `<model>[1m]`; the marker matches
  // no combo, alias or provider/model pair, so it must not reach resolution.
  // The capability travels in the anthropic-beta header, forwarded as-is.
  const { model: modelStr, contextMarker } = stripModelContextMarker(body.model);
  if (contextMarker) body.model = modelStr;

  const session = resolveSessionIdentity({ headers: clientRawRequest?.headers, body });
  const sessionId = session?.sessionId || null;

  // Request summary is emitted as the unified "▶" line in chatCore (has fmt/thinking/account)

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Per-key access control: a restricted key may call only its listed combos and
  // models. Checked once on the requested target, before bypass, combo expansion
  // and any credential lookup; an allowed combo grants the members it routes to.
  const keyAccess = await getKeyAccessContext(request);
  const keyAccessDenied = await enforceKeyAccess(keyAccess, modelStr);
  if (keyAccessDenied) return keyAccessDenied;

  // ── Per-key monthly budget gate (Fase 2) ──────────────────────────────
  // Only enforce when a key is presented (unauthenticated requests are unlimited).
  // Gate uses cost=0 (pre-flight); actual cost attribution happens in usageRepo
  // after the upstream response, so the counter is always behind by one request.
  if (apiKey) {
    try {
      const budget = await getApiKeyBudget(apiKey);
      if (budget && budget.budgetLimitCents !== null) {
        const now = Date.now();
        // Detect and one-time-reset rollover before gate evaluation.
        if (isBudgetPeriodRolledOver(budget.budgetStartedAt, budget.budgetPeriod, now)) {
          await resetBudgetSpend(apiKey, new Date(now).toISOString());
        }
        const result = checkBudget({
          budgetLimitCents: budget.budgetLimitCents,
          budgetPeriod: budget.budgetPeriod,
          budgetStartedAt: budget.budgetStartedAt,
          budgetSpentCents: budget.budgetSpentCents,
          costCents: 0, // pre-flight gate
          now,
        });
        if (!result.allowed) {
          log.warn("BUDGET", `API key over limit`, {
            remaining: result.remainingCents,
            usedPct: result.usedPct,
          });
          return errorResponse(HTTP_STATUS.PAYMENT_REQUIRED, "budget exhausted for this key");
        }
        if (result.usedPct !== null && result.usedPct >= 80) {
          log.warn("BUDGET", `API key at ${result.usedPct}% budget`, {
            remaining: result.remainingCents,
          });
        }
      }
    } catch {
      // fail-open: DB or logic error never blocks a request
    }
  }
  // ── End budget gate ────────────────────────────────────────────────────

  // ── Idempotency Gate (pre-flight) ──────────────────────────────────────
  const idempotencyKey = request?.headers?.get?.("idempotency-key") || clientRawRequest?.headers?.["idempotency-key"] || null;
  const bodyDigest = idempotencyKey ? digestBody(body) : null;
  let idempotencyClaim = null;
  if (idempotencyKey) {
    try {
      idempotencyClaim = responseCache.claimIdempotency(idempotencyKey, bodyDigest);
      if (idempotencyClaim?.status === "completed" && idempotencyClaim.value) {
        const cached = idempotencyClaim.value;
        return replayResponse({
          bodyText: cached.bodyText,
          status: cached.status || 200,
          headers: cached.headers || {},
          cacheType: "idempotency",
        });
      }
      if (idempotencyClaim?.status === "in-progress" && idempotencyClaim.seq > 1) {
        return errorResponse(HTTP_STATUS.CONFLICT || 409, "concurrent request in progress with this idempotency key");
      }
      if (idempotencyClaim?.status === "conflict") {
        return errorResponse(422, "idempotency key reused with different request payload");
      }
    } catch {
      // fail-open
    }
  }

  // ── Semantic Cache Gate (pre-flight) ───────────────────────────────────
  if (settings.semanticCacheEnabled) {
    try {
      const cached = responseCache.getSemantic(body);
      if (cached?.value) {
        log.info("CACHE", "Semantic cache HIT");
        return replayResponse({
          bodyText: cached.value,
          status: cached.status || 200,
          headers: cached.headers || {},
          cacheType: "semantic",
        });
      }
    } catch {
      // fail-open
    }
  }

  // Per-request observability identity (design decisions 5 & 6): ONE id and
  // ONE project label shared by every fallback event and usage row of this
  // request. apiKeyName comes from the access context for restricted keys,
  // otherwise from the apiKeys row itself.
  const requestId = createRequestId();
  const projectName = resolveProjectName(
    request?.headers || clientRawRequest?.headers || null,
    keyAccess?.keyName || await lookupApiKeyName(apiKey)
  );
  // clientRawRequest is the object that travels into chatCore's shared context
  // (the same path apiKey takes), so the usage-saving handlers read this meta
  // straight off it — no chatCore signature change needed downstream.
  clientRawRequest.requestId = requestId;
  clientRawRequest.projectName = projectName;
  clientRawRequest.fallbackCount = 0;
  const reportComboFallback = makeComboFallbackReporter({ requestId, projectName, apiKey, clientRawRequest });

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  const requiredCapabilities = detectRequiredCapabilities(body);

  let responsePromise;

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
    const augmentedModels = await filterAdapterModels(keyAccess, augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, settings), comboModels);
    const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
      responsePromise = handleFusionChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m, isPanel) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, null, requestId, projectName);
        },
        log,
        comboName: modelStr,
        judgeModel: comboStrategies[modelStr]?.judgeModel,
        tuning: comboStrategies[modelStr]?.fusionTuning,
      });
    } else {
      const comboStickyLimit = settings.comboStickyRoundRobinLimit;
      const comboCfg = comboStrategies[modelStr] || {};
      log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      responsePromise = handleComboChat({
        body,
        models: augmentedModels,
        handleSingleModel: withCapacityAdapterStripping(
          (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, null, requestId, projectName),
          adapterAdded
        ),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit,
        sessionId,
        // Observability (T3): one id/label per inbound request + combo switch log
        requestId,
        projectName,
        apiKey,
        onFallback: reportComboFallback,
        smartPolicy: comboCfg.smartPolicy || "smart",
        sessionSticky: comboCfg.sessionSticky !== false,
        confidenceThreshold: typeof comboCfg.confidenceThreshold === "number" ? comboCfg.confidenceThreshold : 0.8,
        resolveSmartChoice: comboStrategy === "smart"
          ? (b, m) => resolveSmartChoice({
              body: b,
              models: m,
              routerModel: comboCfg.routerModel,
              log,
            })
          : null,
      });
    }
  } else {
    // Single model request — may still switch to a capacity-adapter model if the
    // target lacks a capability the request needs (e.g. no vision, request has an image).
    const soloAugmented = await filterAdapterModels(keyAccess, augmentModelsWithCapacityAdapter([modelStr], requiredCapabilities, settings), [modelStr]);
    if (soloAugmented.length > 1) {
      const adapterAdded = soloAugmented.filter((m) => m !== modelStr);
      log.info("CHAT", `Capacity adapter for [${[...requiredCapabilities].join(",")}] on "${modelStr}" → trying ${soloAugmented.join(", ")}`);
      responsePromise = handleComboChat({
        body,
        models: soloAugmented,
        handleSingleModel: withCapacityAdapterStripping(
          (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, null, requestId, projectName),
          adapterAdded
        ),
        log,
        comboName: modelStr,
        comboStrategy: getActiveAdapterStrategy(requiredCapabilities, settings),
        // Observability (T3): one id/label per inbound request + combo switch log
        requestId,
        projectName,
        apiKey,
        onFallback: reportComboFallback,
      });
    } else {
      responsePromise = handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey, contextMarker ? `${modelStr.slice(modelStr.indexOf("/") + 1)}[${contextMarker}]` : null, requestId, projectName);
    }
  }

  const res = await responsePromise;

  // ── Post-flight response capture for Idempotency & Semantic Cache ──────
  if (res && res.status >= 200 && res.status < 400) {
    return captureStreamResponse(res, (capturedText, meta) => {
      try {
        if (idempotencyKey && idempotencyClaim?.status === "in-progress" && idempotencyClaim.seq === 1) {
          responseCache.completeIdempotency(idempotencyKey, bodyDigest, {
            bodyText: capturedText,
            headers: meta.headers,
            status: meta.status,
          });
        }
        if (settings.semanticCacheEnabled && meta.status >= 200 && meta.status < 300) {
          responseCache.setSemantic(body, capturedText, {
            headers: meta.headers,
            status: meta.status,
            model: modelStr,
          });
        }
      } catch {
        // fail-open: caching failure never throws
      }
    });
  }

  return res;
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, requestedModel = null, requestId = null, projectName = null) {
  // Start of this attempt — feeds latencyMs on any fallback event below.
  const requestStart = Date.now();
  const modelInfo = await getModelInfo(modelStr);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      const chatSettings = await getSettings();
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";
      const requiredCapabilities = detectRequiredCapabilities(body);
      // Nested combo (a combo member that is itself a combo): the access decision
      // was made on the outer target; only drop adapter models the key may not call.
      const keyAccess = await getKeyAccessContext(request);
      const augmentedModels = await filterAdapterModels(keyAccess, augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, chatSettings), comboModels);
      const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
        return handleFusionChat({
          body,
          models: comboModels,
          handleSingleModel: (b, m, isPanel) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, null, requestId, projectName);
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      const comboCfg = comboStrategies[modelStr] || {};
      const nestedSession = resolveSessionIdentity({ headers: clientRawRequest?.headers, body });
      const nestedSessionId = nestedSession?.sessionId || null;
      log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: augmentedModels,
        handleSingleModel: withCapacityAdapterStripping(
          (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, null, requestId, projectName),
          adapterAdded
        ),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit,
        sessionId: nestedSessionId,
        requestId,
        projectName,
        apiKey,
        onFallback: makeComboFallbackReporter({ requestId, projectName, apiKey, clientRawRequest }),
        smartPolicy: comboCfg.smartPolicy || "smart",
        sessionSticky: comboCfg.sessionSticky !== false,
        confidenceThreshold: typeof comboCfg.confidenceThreshold === "number" ? comboCfg.confidenceThreshold : 0.8,
        resolveSmartChoice: comboStrategy === "smart"
          ? (b, m) => resolveSmartChoice({
              body: b,
              models: m,
              routerModel: comboCfg.routerModel,
              log,
            })
          : null,
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;
  // Canonical provider id so breaker keys match the ones auth.js filters on.
  const breakerProvider = resolveProviderId(provider);

  // Routing shown in the unified "▶" line (client model → provider/model)

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let lastHeaders = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, { requestedModel: requestedModel || model });

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman, lastHeaders);
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable", lastHeaders);
    }

    // Account selection shown in the unified "▶" line (acc:...)
    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken, provider);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // Use shared chatCore
    const chatSettings = await getSettings();
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    const result = await handleChatCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: !!chatSettings.rtkEnabled,
      headroomEnabled: !!chatSettings.headroomEnabled,
      headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
      headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
      headroomTimeoutMs: chatSettings.headroomTimeoutMs,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: !!chatSettings.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      customPromptEnabled: !!chatSettings.customPromptEnabled,
      customPrompt: chatSettings.customPrompt || "",
      pxpipeEnabled: !!chatSettings.pxpipeEnabled,
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      // Lazily warms the in-process module on first use; null when not installed (fail-open)
      pxpipeTransform: chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null,
      onPxpipeEvent: appendPxpipeEvent,
      providerThinking,
      // Per-provider user overrides (custom headers / connect timeout) from settings
      providerOverrides: (chatSettings.providerOverrides || {})[provider] || null,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
        // "Consecutive" strikes: a success clears the breaker for this pair.
        clearAntigravityStrikes(credentials.connectionId, model);
        // Health breaker: a success closes connection+model (and the
        // provider+model aggregate) and resets their failure counters.
        recordSuccess({ connectionId: credentials.connectionId, provider: breakerProvider, model });
      }
    });

    if (result.success) return result.response;

    // Antigravity 409/429: refresh live quota to get exact resetAt before locking
    let quotaResetMs = null;
    let resetsAtMs = result.resetsAtMs;
    if (provider === "antigravity" && (result.status === 409 || result.status === 429)) {
      quotaResetMs = await handleAntigravityQuotaError(
        credentials.connectionId, result.status, model,
        refreshedCredentials.accessToken, credentials.providerSpecificData
      );
      if (quotaResetMs) resetsAtMs = quotaResetMs;
    }

    // Health breaker: request-scoped rejections (400 context overflow etc,
    // flagged by checkFallbackError) are caused by the request, not the
    // account/provider, and must NOT count as breaker failures.
    // markAccountUnavailable does not report requestScoped, so classify the
    // error here. Antigravity quota exhaustion (409/429 with a precise
    // resetAt) is account-scoped by definition and always counts.
    const requestScoped = !quotaResetMs
      && checkFallbackError(result.status, result.error, 0, breakerProvider).requestScoped === true;
    recordFailure({
      connectionId: credentials.connectionId,
      provider: breakerProvider,
      model,
      status: result.status,
      errorText: result.error,
      requestScoped,
    });

    // Exhausted Antigravity model is blocked only in RAM cache until upstream resetAt.
    // Do not persist a modelLock_* for this path.
    // The cooldown is kept: it is recorded on the fallback event below.
    let shouldFallback;
    let fallbackCooldownMs = null;
    if (provider === "antigravity" && quotaResetMs) {
      shouldFallback = true;
      fallbackCooldownMs = quotaResetMs;
    } else {
      ({ shouldFallback, cooldownMs: fallbackCooldownMs } =
        await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, resetsAtMs));
    }

    if (shouldFallback) {
      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      lastHeaders = upstreamResponseHeaders(result.response?.headers);
      // Per-request fallback counter. It lives on clientRawRequest (the object
      // chatCore passes to the usage handlers) so combo members accumulate into
      // the same request total → usageHistory.fallbackCount.
      if (clientRawRequest) {
        clientRawRequest.fallbackCount = (clientRawRequest.fallbackCount || 0) + 1;
      }
      // Fallback chain log — fire-and-forget so it never adds request latency.
      logFallbackEvent({
        requestId,
        projectName,
        provider,
        model,
        connectionId: credentials.connectionId || null,
        apiKey: apiKey || null,
        fromProvider: provider,
        fromModel: model,
        status: result.status ?? null,
        reason: result.error == null ? null : String(result.error).slice(0, 500),
        cooldownMs: fallbackCooldownMs ?? null,
        latencyMs: Date.now() - requestStart,
      });
      continue;
    }

    return result.response;
  }
}
