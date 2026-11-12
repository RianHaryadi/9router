/**
 * Health circuit breaker — in-memory, synchronous, no I/O.
 *
 * Follows the strike-breaker pattern of services/antigravityQuota.js:20-29
 * (plain Maps, lazily mutated on read) but is generic across providers and
 * connections. State machine per key: closed → open → half-open → closed
 * (state.md "Keputusan desain" #3).
 *
 * Two key levels:
 *   - connection level: `${connectionId}|${model}` — gates account selection
 *   - aggregate level:   `${provider}|${model}`    — provider+model health for
 *     UI/API dumps. It is also the ONLY key used when connectionId is
 *     null/"noauth" (there is no connection to gate in that case).
 *
 * Rules:
 *   - `openAfter` consecutive account-scoped failures open the breaker with
 *     cooldown = base * multiplier^(failures - openAfter), capped at max.
 *   - Cooldown expiry moves the breaker to half-open, which admits
 *     `halfOpenProbes` probe(s). A failed probe re-opens with an escalated
 *     cooldown; a success closes it and resets everything.
 *   - Failures flagged `requestScoped: true` (400 context overflow etc, as
 *     reported by checkFallbackError) are caused by the REQUEST, not by the
 *     account/provider, and are ignored entirely.
 *   - `windowMs` bounds the word "consecutive": in closed state, a failure
 *     arriving more than `windowMs` after the previous one restarts the
 *     counter. Open/half-open counters are never window-reset — they must
 *     keep escalating.
 *
 * The aggregate is counted alongside every connection-level failure, but it
 * only gates selection for noauth connections. Letting it gate sibling
 * connections would defeat connection-level filtering: one bad connection
 * opening the aggregate would mark every connection as blocked, the healthy
 * set would go empty and auth.js would fall back to the pre-breaker list,
 * i.e. the original bad connection could be picked again.
 *
 * T4 — error taxonomy (src/custom/guard/errorTaxonomy.js):
 *   Every failure is classified BEFORE it is applied (classifyError), so the
 *   breaker stops burning healthy accounts:
 *   - scope "model" (qoder 10605 queue, 404 model-not-found) updates ONLY the
 *     `${provider}|${model}` entry; the per-connection entry gets diagnostics
 *     (lastError/lastFailureKind/…) but never counts or locks. This is why
 *     5 healthy qoder accounts no longer rotate-lock for one queued model.
 *   - action "ignore" / scope "none" (local `model_config` bug) and queue
 *     rejections that are merely waiting (queue + wait-progressing) never
 *     increment consecutiveFailures nor open anything — they only record
 *     diagnostics so the dashboard can still show them.
 *   - action "exclude" / "needs-human" use the classified cooldown (auth 5m,
 *     model 10m, billing 30m) instead of the escalating default; billing
 *     entries also get needsHuman/needsHumanSince for the UI.
 *   - scope "provider" (transient 502/503/504) locks the provider-wide key
 *     `${provider}` for the short classified cooldown (5s retry-now).
 *   Reads (isOpen/isBlockedFor/filterByHealth) are heterozygous: a lock that
 *   lives at model level applies to every account for that provider+model,
 *   while account-level locks never leak across models.
 */
import {
  breakerKeyFor,
  classifyError,
  cooldownFor,
  shouldCountTowardsBreaker,
} from "../../custom/guard/errorTaxonomy.js";

export const HEALTH_BREAKER_CONFIG = {
  openAfter: 3,
  baseCooldownMs: 60_000,
  maxCooldownMs: 15 * 60_000,
  cooldownMultiplier: 2,
  halfOpenProbes: 1,
  windowMs: 10 * 60_000,
};

// `${connectionId}|${model}` → entry (regular connections)
const connectionBreakers = new Map();
// `${provider}|${model}` → entry (aggregate; also the only key for noauth)
const providerBreakers = new Map();
// `${provider}` → entry (T4: provider-wide lock for transient 502/503/504)
const providerLevelBreakers = new Map();

const CLOSED_ENTRY = Object.freeze({
  state: "closed",
  consecutiveFailures: 0,
  blockedUntil: null,
  cooldownMs: 0,
  lastError: null,
  lastStatus: null,
  lastFailureAt: null,
  lastFailureKind: null,
  lastFailureScope: null,
  lastFailureAction: null,
  needsHuman: false,
  needsHumanSince: null,
  avgLatencyMs: null,
  probesRemaining: 0,
});

function isNoAuthConnection(connectionId) {
  return !connectionId || connectionId === "noauth";
}

function connectionKey(connectionId, model) {
  return `${connectionId}|${model || "*"}`;
}

function providerKey(provider, model) {
  return `${provider}|${model || "*"}`;
}

function createEntry(connectionId, provider, model) {
  return {
    connectionId: connectionId ?? null,
    provider: provider ?? null,
    model: model ?? null,
    state: "closed",
    consecutiveFailures: 0,
    blockedUntil: null,
    cooldownMs: 0,
    lastError: null,
    lastStatus: null,
    lastFailureAt: null,
    // T4 taxonomy fields (see src/custom/guard/errorTaxonomy.js)
    lastFailureKind: null,
    lastFailureScope: null,
    lastFailureAction: null,
    needsHuman: false,
    needsHumanSince: null,
    // timestamp of the last COUNTED failure — the window check must ignore
    // diagnostics-only failures or a queue storm would keep a stale streak alive
    lastCountedAt: null,
    avgLatencyMs: null,
    probesRemaining: 0,
    // scope of the failure that opened this entry ("model"|"account"|"provider")
    lockScope: null,
  };
}

/** Lazy transition: an open breaker past its cooldown becomes half-open. */
function resolveEntry(entry, now = Date.now()) {
  if (
    entry &&
    entry.state === "open" &&
    entry.blockedUntil !== null &&
    entry.blockedUntil <= now
  ) {
    entry.state = "half-open";
    entry.probesRemaining = HEALTH_BREAKER_CONFIG.halfOpenProbes;
    entry.blockedUntil = null;
  }
  return entry;
}

/** The entry a query is about: connection key, or aggregate for noauth. */
function primaryEntry({ connectionId, provider, model } = {}) {
  if (isNoAuthConnection(connectionId)) {
    return resolveEntry(providerBreakers.get(providerKey(provider, model)));
  }
  return resolveEntry(connectionBreakers.get(connectionKey(connectionId, model)));
}

/**
 * Cooldown for an opening breaker: the taxonomy decides (classified cooldown
 * for exclude/needs-human/retry-now, escalating for backoff/unclassified) —
 * see cooldownFor in src/custom/guard/errorTaxonomy.js for the precedence.
 * The local escalating helper of pre-T4 code was replaced by that function.
 */
function openBreaker(entry, now, classified = null) {
  entry.state = "open";
  entry.cooldownMs = cooldownFor(classified, {
    ...HEALTH_BREAKER_CONFIG,
    consecutiveFailures: entry.consecutiveFailures,
  });
  entry.blockedUntil = now + entry.cooldownMs;
  entry.probesRemaining = 0;
  entry.lockScope = classified ? classified.scope ?? null : null;
}

function normalizeError(errorText) {
  if (errorText === null || errorText === undefined) return null;
  let text = errorText;
  if (typeof text !== "string") {
    try {
      text = JSON.stringify(text);
    } catch {
      text = String(text);
    }
  }
  return text.slice(0, 300);
}

/**
 * T4: record the error on the entry for the DASHBOARD without ever moving the
 * state machine (no consecutiveFailures, no open). Used for diagnostics-only
 * failures (queue/wait-progressing, local bugs) and for the per-connection
 * entry of a model-scoped fault — the account is healthy, only the model is.
 */
function applyDiagnostic(entry, now, status, errorText, classified) {
  entry.lastStatus = status ?? null;
  entry.lastError = normalizeError(errorText);
  entry.lastFailureAt = now;
  if (classified) {
    entry.lastFailureKind = classified.kind ?? null;
    entry.lastFailureScope = classified.scope ?? null;
    entry.lastFailureAction = classified.action ?? null;
    if (classified.needsHuman === true || classified.action === "needs-human") {
      entry.needsHuman = true;
      if (entry.needsHumanSince === null || entry.needsHumanSince === undefined) {
        entry.needsHumanSince = now;
      }
    }
  }
}

function applyFailure(entry, now, status, errorText, classified = null) {
  // Make the state machine independent of prior reads: an open breaker whose
  // cooldown already expired counts the failure as a half-open probe.
  resolveEntry(entry, now);

  // Only closed-state streaks age out; open/half-open must keep escalating.
  // Uses lastCountedAt (not lastFailureAt) so diagnostics-only records —
  // which must not count — cannot keep a stale streak alive either.
  if (
    entry.state === "closed" &&
    entry.lastCountedAt !== null &&
    now - entry.lastCountedAt > HEALTH_BREAKER_CONFIG.windowMs
  ) {
    entry.consecutiveFailures = 0;
  }

  entry.consecutiveFailures += 1;
  entry.lastCountedAt = now;
  applyDiagnostic(entry, now, status, errorText, classified);

  if (entry.state === "half-open") {
    // A probe was allowed through and it failed: consume it.
    entry.probesRemaining = Math.max(0, entry.probesRemaining - 1);
    if (entry.probesRemaining > 0) return; // more probes allowed, keep probing
    openBreaker(entry, now, classified); // probe failed → re-open with escalated cooldown
    return;
  }

  if (entry.consecutiveFailures >= HEALTH_BREAKER_CONFIG.openAfter) {
    openBreaker(entry, now, classified);
  }
}

function applySuccess(entry, latencyMs) {
  entry.state = "closed";
  entry.blockedUntil = null;
  entry.cooldownMs = 0;
  entry.consecutiveFailures = 0;
  entry.probesRemaining = 0;
  entry.lockScope = null;
  // T4: a success proves the entry works again — drop the human flag.
  entry.needsHuman = false;
  entry.needsHumanSince = null;
  if (typeof latencyMs === "number" && Number.isFinite(latencyMs)) {
    entry.avgLatencyMs =
      entry.avgLatencyMs === null ? latencyMs : Math.round((entry.avgLatencyMs + latencyMs) / 2);
  }
}

function publicEntry(entry) {
  return {
    connectionId: entry.connectionId,
    provider: entry.provider,
    model: entry.model,
    state: entry.state,
    blockedUntil: entry.blockedUntil,
    consecutiveFailures: entry.consecutiveFailures,
    lastError: entry.lastError,
    lastStatus: entry.lastStatus,
    // T4 taxonomy fields (additive — safe for existing dashboard clients)
    lastFailureKind: entry.lastFailureKind ?? null,
    lastFailureScope: entry.lastFailureScope ?? null,
    lastFailureAction: entry.lastFailureAction ?? null,
    needsHuman: entry.needsHuman === true,
    needsHumanSince: entry.needsHumanSince ?? null,
  };
}

function stateOf(entry) {
  if (!entry) return { ...CLOSED_ENTRY };
  return {
    state: entry.state,
    consecutiveFailures: entry.consecutiveFailures,
    blockedUntil: entry.blockedUntil,
    cooldownMs: entry.cooldownMs,
    lastError: entry.lastError,
    lastStatus: entry.lastStatus,
    lastFailureAt: entry.lastFailureAt,
    lastFailureKind: entry.lastFailureKind ?? null,
    lastFailureScope: entry.lastFailureScope ?? null,
    lastFailureAction: entry.lastFailureAction ?? null,
    needsHuman: entry.needsHuman === true,
    needsHumanSince: entry.needsHumanSince ?? null,
    avgLatencyMs: entry.avgLatencyMs,
    probesRemaining: entry.probesRemaining,
  };
}

/**
 * Record a successful request: reset the consecutive-failure counter and
 * close the breaker for this connection+model AND the provider+model
 * aggregate (the aggregate is derived from these same failures). Updates the
 * simple EWMA latency average when `latencyMs` is a finite number.
 * @returns {object} state snapshot for the primary key (see getState)
 */
export function recordSuccess({ connectionId, provider, model, latencyMs } = {}) {
  const trackLatency = typeof latencyMs === "number" && Number.isFinite(latencyMs);
  const targets = [];

  if (!isNoAuthConnection(connectionId)) {
    const key = connectionKey(connectionId, model);
    let conn = connectionBreakers.get(key);
    if (!conn && trackLatency) {
      conn = createEntry(connectionId, provider, model);
      connectionBreakers.set(key, conn);
    }
    if (conn) targets.push(conn);
  }

  const aggKey = providerKey(provider, model);
  let agg = providerBreakers.get(aggKey);
  if (!agg && trackLatency) {
    agg = createEntry(null, provider, model);
    providerBreakers.set(aggKey, agg);
  }
  if (agg) targets.push(agg);

  // T4: a success also closes a provider-wide lock (transient 5xx recovered).
  // Only cleared when it already exists — successes never create that entry.
  const providerLevel = provider ? providerLevelBreakers.get(provider) : null;
  if (providerLevel) targets.push(providerLevel);

  for (const entry of targets) applySuccess(entry, latencyMs);

  return getState({ connectionId, provider, model });
}

/**
 * Record a failed request. `requestScoped: true` errors are caused by the
 * request itself (400 context overflow etc) and are NOT counted.
 *
 * T4 (error taxonomy): the failure is first classified (classifyError) so
 * only faults that are really the account's/provider's problem move the
 * breaker — see the header comment for the full matrix. The per-connection
 * failure still increments the provider+model aggregate for account-scoped
 * errors, exactly as before (backward compatible: same arguments, same
 * return shape).
 * @returns {{ state: string, blockedUntil: number|null, consecutiveFailures: number }}
 */
export function recordFailure({
  connectionId,
  provider,
  model,
  status,
  errorText,
  requestScoped,
  code,
} = {}) {
  if (requestScoped) {
    return getStateFields({ connectionId, provider, model });
  }

  const now = Date.now();
  const classified = classifyError({ provider, model, status, errorText, code });
  const counts = shouldCountTowardsBreaker(classified);
  const hasConnection = !isNoAuthConnection(connectionId);
  const aggKey = providerKey(provider, model);

  const getConnection = () => {
    if (!hasConnection) return null;
    let conn = connectionBreakers.get(connectionKey(connectionId, model));
    if (!conn) {
      conn = createEntry(connectionId, provider, model);
      connectionBreakers.set(connectionKey(connectionId, model), conn);
    }
    return conn;
  };

  const getAggregate = () => {
    let agg = providerBreakers.get(aggKey);
    if (!agg) {
      agg = createEntry(null, provider, model);
      providerBreakers.set(aggKey, agg);
    }
    return agg;
  };

  // --- Diagnostics only: local bugs and queue rejections that are merely
  // waiting must never burn a healthy account (no counting, no lock).
  if (!counts) {
    const conn = getConnection();
    if (conn) applyDiagnostic(conn, now, status, errorText, classified);
    applyDiagnostic(getAggregate(), now, status, errorText, classified);
    return getStateFields({ connectionId, provider, model });
  }

  // --- scope "model": the fault belongs to the model, not to any account
  // (qoder 10605 CALL_COUNT_LIMIT, 404 model-not-found). Only the
  // `${provider}|${model}` entry counts/locks; the per-connection entry only
  // records diagnostics so 5 healthy accounts are not all locked for it.
  if (classified.scope === "model") {
    applyFailure(getAggregate(), now, status, errorText, classified);
    const conn = getConnection();
    if (conn) applyDiagnostic(conn, now, status, errorText, classified);
    return getStateFields({ connectionId, provider, model });
  }

  // --- scope "provider": transient upstream 5xx. Lock the provider-wide key
  // `${provider}` (breakerKeyFor) for the short classified cooldown; accounts
  // only get diagnostics. Read side (isOpen/isBlockedFor) honours that lock.
  if (classified.scope === "provider") {
    const providerKeyOnly = breakerKeyFor(classified, { connectionId, provider, model });
    let providerLevel = providerLevelBreakers.get(providerKeyOnly);
    if (!providerLevel) {
      providerLevel = createEntry(null, provider, null);
      providerLevelBreakers.set(providerKeyOnly, providerLevel);
    }
    applyFailure(providerLevel, now, status, errorText, classified);
    const conn = getConnection();
    if (conn) applyDiagnostic(conn, now, status, errorText, classified);
    applyDiagnostic(getAggregate(), now, status, errorText, classified);
    return getStateFields({ connectionId, provider, model });
  }

  // --- scope "account" (default): unchanged legacy behaviour — the
  // connection+model entry AND the aggregate both count (breakerKeyFor's
  // account key is connectionId-only; healthBreaker keeps the model-qualified
  // key so account locks stay per-model, an existing contract).
  const conn = getConnection();
  if (conn) applyFailure(conn, now, status, errorText, classified);
  applyFailure(getAggregate(), now, status, errorText, classified);

  return getStateFields({ connectionId, provider, model });
}

/** Destructure helper so recordFailure returns exactly the documented shape. */
function getStateFields(params) {
  const { state, blockedUntil, consecutiveFailures } = getState(params);
  return { state, blockedUntil, consecutiveFailures };
}

/**
 * State snapshot for a key. Non-existent keys read as a closed breaker.
 * T4: includes lastFailureKind/lastFailureScope/lastFailureAction/needsHuman
 * (additive fields — existing consumers only read the old keys).
 * @returns {{ state: "closed"|"open"|"half-open", consecutiveFailures: number,
 *   blockedUntil: number|null, cooldownMs: number, lastError: string|null,
 *   lastStatus: number|null, lastFailureAt: number|null, avgLatencyMs: number|null,
 *   probesRemaining: number, lastFailureKind: string|null,
 *   lastFailureScope: string|null, lastFailureAction: string|null,
 *   needsHuman: boolean, needsHumanSince: number|null }}
 */
export function getState({ connectionId, provider, model } = {}) {
  return stateOf(primaryEntry({ connectionId, provider, model }));
}

/** True while the breaker for this key is open with a future blockedUntil. */
export function isOpen({ connectionId, provider, model } = {}) {
  const entry = primaryEntry({ connectionId, provider, model });
  if (entry && entry.state === "open" && entry.blockedUntil !== null && entry.blockedUntil > Date.now()) {
    return true;
  }
  return crossScopeBlocked(provider, model, openWithFutureLock);
}

/**
 * True when the key must not be tried: open with a future blockedUntil, or
 * half-open with all allowed probes already consumed. Half-open with probes
 * still available returns false — that is the probe window.
 */
export function isBlockedFor({ connectionId, provider, model } = {}) {
  const entry = primaryEntry({ connectionId, provider, model });
  if (blockedEntry(entry)) return true;
  return crossScopeBlocked(provider, model, blockedEntry);
}

/** Open with a future blockedUntil (isOpen semantics). */
function openWithFutureLock(entry) {
  return (
    !!entry &&
    entry.state === "open" &&
    entry.blockedUntil !== null &&
    entry.blockedUntil > Date.now()
  );
}

/** isOpen semantics + half-open with no probes left (isBlockedFor semantics). */
function blockedEntry(entry) {
  if (!entry) return false;
  if (entry.state === "open") {
    return entry.blockedUntil !== null && entry.blockedUntil > Date.now();
  }
  if (entry.state === "half-open") return entry.probesRemaining <= 0;
  return false;
}

/**
 * T4 heterozygous read: a lock recorded at MODEL scope (`${provider}|${model}`
 * opened by a model-classified failure) or at PROVIDER scope (`${provider}`)
 * applies to every account for that provider+model — that is the whole point
 * of scoping the fault. Account-scope locks live on the connection entry and
 * never leak here (aggregate entries opened by account failures carry
 * lockScope "account" and are skipped), so sibling accounts stay selectable.
 */
function crossScopeBlocked(provider, model, predicate) {
  if (!provider) return false;
  const aggregate = resolveEntry(providerBreakers.get(providerKey(provider, model)));
  if (aggregate && aggregate.lockScope === "model" && predicate(aggregate)) return true;
  const providerLevel = resolveEntry(providerLevelBreakers.get(provider));
  if (providerLevel && predicate(providerLevel)) return true;
  return false;
}

/** Dump of every non-closed breaker (open + half-open), connection and aggregate. */
export function listBlocked() {
  const out = [];
  for (const entry of connectionBreakers.values()) {
    resolveEntry(entry);
    if (entry.state !== "closed") out.push(publicEntry(entry));
  }
  for (const entry of providerBreakers.values()) {
    resolveEntry(entry);
    if (entry.state !== "closed") out.push(publicEntry(entry));
  }
  for (const entry of providerLevelBreakers.values()) {
    resolveEntry(entry);
    if (entry.state !== "closed") out.push(publicEntry(entry));
  }
  return out;
}

/** Full snapshot for the UI/API: counts plus every tracked entry. */
export function getSnapshot() {
  const entries = [];
  let open = 0;
  let halfOpen = 0;
  const visit = (entry) => {
    resolveEntry(entry);
    entries.push(publicEntry(entry));
    if (entry.state === "open") open += 1;
    else if (entry.state === "half-open") halfOpen += 1;
  };
  for (const entry of connectionBreakers.values()) visit(entry);
  for (const entry of providerBreakers.values()) visit(entry);
  for (const entry of providerLevelBreakers.values()) visit(entry);
  return { tracked: entries.length, open, halfOpen, entries };
}

/**
 * Clear one breaker (manual unblock / tests). Removes the connection entry
 * AND the provider+model aggregate, so the pair starts fully clean — the
 * aggregate is derived from these same failure records. Also clears the
 * provider-wide T4 lock for that provider (manual unblock means "try again").
 */
export function resetBreaker({ connectionId, provider, model } = {}) {
  if (isNoAuthConnection(connectionId)) {
    providerBreakers.delete(providerKey(provider, model));
    if (provider) providerLevelBreakers.delete(provider);
    return;
  }
  connectionBreakers.delete(connectionKey(connectionId, model));
  if (provider) {
    providerBreakers.delete(providerKey(provider, model));
    providerLevelBreakers.delete(provider);
  }
}

/** Clear every breaker (tests). */
export function resetAll() {
  connectionBreakers.clear();
  providerBreakers.clear();
  providerLevelBreakers.clear();
}

/**
 * Pure partition helper for auth.js: split a candidate connection list into
 * breaker-healthy vs breaker-blocked for this provider+model. Callers must
 * fall back to the original list when `healthy` is empty (breaker is
 * informational, never a total deadlock — state.md "Keputusan desain" #4).
 * @param {Array<{id: string}>} connections
 * @returns {{ healthy: Array, blocked: Array }}
 */
export function filterByHealth(connections, provider, model) {
  const healthy = [];
  const blocked = [];
  for (const conn of connections || []) {
    if (conn && isOpen({ connectionId: conn.id, provider, model })) blocked.push(conn);
    else healthy.push(conn);
  }
  return { healthy, blocked };
}
