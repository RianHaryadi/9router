/**
 * src/custom/guard/errorTaxonomy.js — Layer 1 provider-error taxonomy (T4).
 *
 * WHY THIS EXISTS (production evidence, 12 Nov 2026):
 *   - qoder: every model stuck on `503 queueType=p4 waitTime=60s` while the
 *     account was healthy (`isQuotaExceeded:false`, 275-281/300 credits).
 *     The queue (vendor code 10605) is PER-MODEL, not per-account — 5 healthy
 *     accounts were lock-rotated for the same model and no credit was ever
 *     consumed because the request was never processed.
 *   - muse: `402 billing_not_configured` from api.meta.ai — the key is valid
 *     (GET /v1/models works) but billing needs a HUMAN; retrying forever only
 *     burns reputation.
 *   - qoder 400 `model_config for "X" not yet known` — a LOCAL config bug:
 *     touching the provider for it is pure loss.
 *   - antigravity 404 `Requested entity was not found` — the model is not in
 *     scope for that account; the account itself is fine.
 *
 * Before this module the breaker treated every failure identically
 * (consecutiveFailures → open → escalating cooldown), so healthy accounts got
 * burned by transient/per-model/provider-level faults.
 *
 * CONTRACT (see tests/unit/error-taxonomy.test.js):
 *   classifyError({ provider, model, status, errorText, code })
 *     → { kind, scope, action, cooldownMs, reason, confidence, needsHuman }
 *   shouldCountTowardsBreaker(classified) → does this move the breaker?
 *   breakerKeyFor(classified, { connectionId, provider, model })
 *     → which key the lock lives on (model / account / provider / none)
 *   cooldownFor(classified, baseConfig) → ms to stay blocked
 *
 * PURE & DETERMINISTIC: no DB, no Date.now(), no randomness — the same input
 * always yields a deep-equal output (regression-tested).
 *
 * PRIORITY ORDER of the rules below mirrors the spec table: local-bug →
 * queue markers (incl. vendor 10605 / CALL_COUNT_LIMIT) → qoder codes →
 * status rules (402 → 403 billing → 401/auth → 404 → 429 → 502/503/504) →
 * capacity text → fallback. The queue markers run BEFORE every status rule on
 * purpose: vendor code 10605 must never classify as "billing" (upstream bug,
 * see decolua/9router#3510 / PR #5051).
 */

export const ERROR_KINDS = Object.freeze([
  "queue",
  "billing",
  "auth",
  "rate-limit",
  "model-not-found",
  "request-invalid",
  "server",
  "unknown",
]);

export const ERROR_SCOPES = Object.freeze(["model", "account", "provider", "none"]);

export const ERROR_ACTIONS = Object.freeze([
  "retry-now",
  "backoff",
  "wait-progressing",
  "exclude",
  "needs-human",
  "ignore",
]);

/** Cooldown config shape accepted by cooldownFor (mirrors breaker config). */
export const DEFAULT_COOLDOWN_CONFIG = Object.freeze({
  openAfter: 3,
  baseCooldownMs: 60_000,
  maxCooldownMs: 15 * 60_000,
  cooldownMultiplier: 2,
  defaultCooldownMs: 30_000,
});

/** Text markers that identify a per-model queue rejection (qoder 10605 family). */
const QUEUE_TEXT_MARKERS = Object.freeze([
  "queuetype", // `503 queueType=p4 waitTime=60s`
  "isqueued",
  "still queued",
  "is queued",
]);

const QUEUE_CODE = "10605";
const DAILY_LIMIT_MARKER = "call_count_limit";

/** Auth wording that means the credentials themselves are dead. */
const AUTH_TEXT_MARKERS = Object.freeze([
  "no credentials",
  "invalid_api_key",
  "invalid api key",
  "sign-in lapsed",
  "login expired",
]);

/** Wording that makes a 403 a billing problem rather than a permission one. */
const BILLING_TEXT_MARKERS = Object.freeze(["billing", "quota", "insufficient", "pricingurl"]);

const RATE_TEXT_MARKERS = Object.freeze([
  "rate limit",
  "rate_limit",
  "ratelimit",
  "too many requests",
  "quota exceeded",
]);

const CAPACITY_TEXT_MARKERS = Object.freeze(["capacity", "overloaded"]);

const LOCAL_BUG_MARKERS = Object.freeze(["model_config for", "not yet known"]);

/**
 * Keys whose value is a vendor error code. `statuscode`/`httpcode`/`exitcode`
 * are explicitly excluded — they are transport metadata, not vendor codes
 * (collecting them would make e.g. `"statusCode":110` look like qoder 110).
 */
function isCodeKey(key) {
  const k = String(key).toLowerCase();
  if (k === "statuscode" || k === "httpstatus" || k === "httpcode" || k === "exitcode") {
    return false;
  }
  return (
    k === "code" ||
    k === "errcode" ||
    k === "errorcode" ||
    k === "err_code" ||
    k === "error_code" ||
    k === "vendorcode" ||
    k === "codevalue" ||
    k.endsWith("_code")
  );
}

/**
 * Raw-text fallback for non-JSON bodies such as `code=110` or `{"code":110}`
 * embedded in a bigger message. Captures the value right after a code-ish key.
 */
const RAW_CODE_RE =
  /(?:^|[^\w-])(?:code|errcode|errorcode|err_code|error_code)["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{1,24})/g;

const MAX_CODE_DEPTH = 4;
const MAX_JSON_PARSE_LEN = 100_000;

function toText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Collect every vendor-code-ish value from `errorText`, walking NESTED JSON
 * (JSON string inside a JSON string inside a JSON string — the exact shape
 * qoder/muse wrap their errors in) up to MAX_CODE_DEPTH. Codes are only
 * harvested from code KEYS (or raw `code=…` assignments), never from bare
 * numbers, so latency/ids cannot produce false positives.
 * @returns {Set<string>}
 */
function collectCodes(errorText, explicitCode) {
  const out = new Set();
  if (explicitCode !== null && explicitCode !== undefined && explicitCode !== "") {
    out.add(String(explicitCode).trim());
  }

  const visit = (value, depth) => {
    if (value === null || value === undefined || depth > MAX_CODE_DEPTH) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (
        trimmed.length <= MAX_JSON_PARSE_LEN &&
        (trimmed.startsWith("{") || trimmed.startsWith("["))
      ) {
        try {
          visit(JSON.parse(trimmed), depth + 1);
        } catch {
          /* not JSON — the raw-text pass below still covers it */
        }
      }
      return;
    }
    if (typeof value !== "object") return; // numbers/booleans are not keyed codes
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if ((typeof child === "string" || typeof child === "number") && isCodeKey(key)) {
        out.add(String(child).trim());
      }
      visit(child, depth + 1);
    }
  };
  visit(errorText, 0);

  const text = toText(errorText);
  if (text) {
    RAW_CODE_RE.lastIndex = 0;
    let match;
    while ((match = RAW_CODE_RE.exec(text)) !== null) {
      out.add(match[1]);
    }
  }
  return out;
}

function makeResult(kind, scope, action, cooldownMs, reason, needsHuman = false) {
  return {
    kind,
    scope,
    action,
    cooldownMs,
    reason,
    confidence: "rule",
    needsHuman: needsHuman === true,
  };
}

function fallbackResult() {
  return {
    kind: "unknown",
    scope: "account",
    action: "backoff",
    cooldownMs: DEFAULT_COOLDOWN_CONFIG.defaultCooldownMs, // 30s advisory default
    reason: "no rule matched → conservative account-scoped backoff",
    confidence: "fallback",
    needsHuman: false,
  };
}

/**
 * Classify one provider failure.
 *
 * @param {object} [input]
 * @param {string} [input.provider]   provider id (e.g. "qoder", "muse")
 * @param {string} [input.model]      model id the request was for
 * @param {number|string} [input.status] HTTP status of the failure
 * @param {string|object} [input.errorText] error body — may be nested JSON-in-JSON
 * @param {string|number} [input.code] optional pre-extracted vendor code
 * @returns {{ kind: string, scope: string, action: string,
 *            cooldownMs: number|null, reason: string,
 *            confidence: "rule"|"fallback", needsHuman: boolean }}
 */
export function classifyError({ provider, model, status, errorText, code } = {}) {
  const text = toText(errorText);
  const lower = text.toLowerCase();
  const providerId = String(provider ?? "").toLowerCase();
  const numericStatus =
    status === null || status === undefined || status === "" ? NaN : Number(status);
  const codes = collectCodes(errorText, code);
  const has = (needle) => lower.includes(needle);
  const hasQueueMarker =
    QUEUE_TEXT_MARKERS.some(has) ||
    new RegExp(`\\b${QUEUE_CODE}\\b`).test(text) ||
    codes.has(QUEUE_CODE);

  // 1. LOCAL config bug — must not touch the provider at all, whatever else
  //    the message contains (qoder 400 `model_config for "X" not yet known`).
  if ((numericStatus === 400 || Number.isNaN(numericStatus)) &&
      LOCAL_BUG_MARKERS.some(has)) {
    return makeResult(
      "request-invalid",
      "none",
      "ignore",
      0,
      `local config bug (model_config not known) — never touch the provider${model ? ` for ${model}` : ""}`
    );
  }

  // 2. QUEUE — vendor 10605 family. Checked BEFORE every status rule so a
  //    queued 503/429 can never be mistaken for billing or rate-limiting
  //    (regression guard for decolua/9router#3510). Scope=model: the queue is
  //    per-model, so it must never lock the account.
  const isDailyLimit = has(DAILY_LIMIT_MARKER);
  if (hasQueueMarker || isDailyLimit) {
    if (isDailyLimit) {
      return makeResult(
        "queue",
        "model",
        "exclude",
        30 * 60_000,
        `daily CALL_COUNT_LIMIT (10605 family) for ${model ?? "*"} — exclude the model for 30m`
      );
    }
    return makeResult(
      "queue",
      "model",
      "wait-progressing",
      60_000,
      `per-model queue (vendor 10605 / queueType) for ${model ?? "*"} — wait, not an account fault`
    );
  }

  // 3. QODER vendor codes 110 (billing daily count) / 112 (quota exhausted).
  //    These are account-level usage limits: exclude long + flag needs-human.
  if (providerId.includes("qoder") && (codes.has("110") || codes.has("112"))) {
    return makeResult(
      "billing",
      "account",
      "exclude",
      30 * 60_000,
      `qoder vendor code ${codes.has("110") ? "110" : "112"} — daily count/quota exhausted`,
      true
    );
  }

  // 4. HTTP 402 — payment required (muse `billing_not_configured`): the key
  //    works, billing needs a human; retrying can never succeed.
  if (numericStatus === 402) {
    return makeResult(
      "billing",
      "account",
      "needs-human",
      30 * 60_000,
      "HTTP 402 payment/billing required — human must configure billing",
      true
    );
  }

  // 5. HTTP 403 with billing/quota wording — same class as 402.
  if (numericStatus === 403 && BILLING_TEXT_MARKERS.some(has)) {
    return makeResult(
      "billing",
      "account",
      "needs-human",
      30 * 60_000,
      "HTTP 403 with billing/quota wording — account needs a human",
      true
    );
  }

  // 6. AUTH — dead credentials: exclude the account (5m) instead of hammering.
  if (numericStatus === 401 || AUTH_TEXT_MARKERS.some(has)) {
    return makeResult(
      "auth",
      "account",
      "exclude",
      5 * 60_000,
      "credentials rejected or sign-in lapsed — exclude the account"
    );
  }

  // 7. HTTP 404 — model not in scope for this account (antigravity
  //    "Requested entity was not found"): exclude at MODEL scope.
  if (numericStatus === 404) {
    return makeResult(
      "model-not-found",
      "model",
      "exclude",
      10 * 60_000,
      `HTTP 404 — ${model ?? "model"} not available in this scope`
    );
  }

  // 8. RATE LIMIT — throttling is account-scoped; back off with escalation.
  if (numericStatus === 429 || RATE_TEXT_MARKERS.some(has)) {
    return makeResult(
      "rate-limit",
      "account",
      "backoff",
      null, // escalating cooldown, see cooldownFor
      "rate limited / quota exceeded — account-scoped backoff"
    );
  }

  // 9. TRANSIENT UPSTREAM 5xx — fault is at provider level, retry quickly.
  if (numericStatus === 502 || numericStatus === 503 || numericStatus === 504) {
    return makeResult(
      "server",
      "provider",
      "retry-now",
      5_000,
      "transient upstream 5xx — provider-level, retry now"
    );
  }

  // 10. CAPACITY wording — the provider is shedding load: wait, don't retry.
  if (CAPACITY_TEXT_MARKERS.some(has)) {
    return makeResult(
      "queue",
      "provider",
      "wait-progressing",
      null,
      "provider capacity/overload — wait while it drains"
    );
  }

  // 11. Fallback.
  return fallbackResult();
}

/**
 * Does this failure move the breaker (count + potentially open a lock)?
 *
 * `false` for: local bugs (action ignore / scope none) and queue rejections
 * that are only waiting (kind queue + wait-progressing) — an antrean is NOT an
 * account fault. `true` for queue + exclude (a daily limit really does need a
 * long lock), and for everything else (billing/auth/rate-limit/model/…).
 *
 * @param {{ kind: string, scope: string, action: string }|null} classified
 * @returns {boolean}
 */
export function shouldCountTowardsBreaker(classified) {
  if (!classified) return true; // unclassified → legacy behaviour (counts)
  if (classified.action === "ignore") return false;
  if (classified.scope === "none") return false;
  if (classified.kind === "queue" && classified.action === "wait-progressing") {
    return false; // antrean bukan fault akun
  }
  if (classified.kind === "queue" && classified.action === "exclude") {
    return true; // daily limit: exclude lama
  }
  return true;
}

/**
 * The key a lock lives on, per the fault's scope.
 *
 *   model    → `${provider}|${model}`   (NOT per connectionId — this is the
 *              core fix: qoder's queue is per-model, so 5 healthy accounts
 *              must not all get locked for the same model)
 *   account  → `${connectionId}` (or `${provider}|account` when there is no
 *              connection: null / "noauth")
 *   provider → `${provider}`
 *   none     → null (no lock at all — local bugs)
 *
 * NOTE (backward compatibility): healthBreaker keeps gating regular accounts
 * on its legacy `${connectionId}|${model}` key for scope=account so that a
 * lock stays model-specific (existing contract: "ignores breaker state for
 * other models"). This function is the taxonomy-level contract used for
 * model/provider routing and by future callers.
 *
 * @param {{ scope: string }|null} classified
 * @param {{ connectionId?: string|null, provider?: string|null, model?: string|null }} [ctx]
 * @returns {string|null}
 */
export function breakerKeyFor(classified, { connectionId, provider, model } = {}) {
  const scope = classified ? classified.scope : "account"; // no classification → legacy account scope
  if (scope === "model") {
    return `${provider ?? "unknown"}|${model || "*"}`;
  }
  if (scope === "account") {
    const noConnection = !connectionId || connectionId === "noauth";
    return noConnection ? `${provider ?? "unknown"}|account` : `${connectionId}`;
  }
  if (scope === "provider") {
    return `${provider ?? "unknown"}`;
  }
  return null; // scope "none" → no lock
}

/**
 * Cooldown for a classified failure, in ms.
 *
 * PRECEDENCE (important, regression-tested):
 *   1. action "backoff" (rate-limit, unknown/default) → the breaker's
 *      ESCALATING cooldown base*multiplier^(failures-openAfter) capped at max.
 *      The default classification carries an advisory 30s cooldownMs, but the
 *      breaker must keep escalating (health-breaker.test.js contract: 60s →
 *      15m cap), so backoff wins over a non-null cooldownMs.
 *   2. otherwise, when classified.cooldownMs != null → that value
 *      (queue 60s, auth 5m, model-not-found 10m, billing 30m, server 5s, …).
 *   3. otherwise → escalating cooldown (nothing else to go on).
 *
 * @param {{ action: string, cooldownMs: number|null }|null} classified
 * @param {{ openAfter?: number, baseCooldownMs?: number, maxCooldownMs?: number,
 *           cooldownMultiplier?: number, consecutiveFailures?: number }} [baseConfig]
 * @returns {number}
 */
export function cooldownFor(classified, baseConfig = {}) {
  const cfg = { ...DEFAULT_COOLDOWN_CONFIG, ...(baseConfig || {}) };
  if (classified && classified.action !== "backoff" && classified.cooldownMs != null) {
    return classified.cooldownMs;
  }
  const failures =
    typeof cfg.consecutiveFailures === "number" && Number.isFinite(cfg.consecutiveFailures)
      ? cfg.consecutiveFailures
      : cfg.openAfter;
  const over = Math.max(0, failures - cfg.openAfter);
  return Math.min(
    cfg.baseCooldownMs * Math.pow(cfg.cooldownMultiplier, over),
    cfg.maxCooldownMs
  );
}
