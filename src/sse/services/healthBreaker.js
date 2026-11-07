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
 */

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

const CLOSED_ENTRY = Object.freeze({
  state: "closed",
  consecutiveFailures: 0,
  blockedUntil: null,
  cooldownMs: 0,
  lastError: null,
  lastStatus: null,
  lastFailureAt: null,
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
    avgLatencyMs: null,
    probesRemaining: 0,
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

function cooldownFor(consecutiveFailures) {
  const { openAfter, baseCooldownMs, maxCooldownMs, cooldownMultiplier } = HEALTH_BREAKER_CONFIG;
  const over = Math.max(0, consecutiveFailures - openAfter);
  return Math.min(baseCooldownMs * Math.pow(cooldownMultiplier, over), maxCooldownMs);
}

function openBreaker(entry, now) {
  entry.state = "open";
  entry.cooldownMs = cooldownFor(entry.consecutiveFailures);
  entry.blockedUntil = now + entry.cooldownMs;
  entry.probesRemaining = 0;
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

function applyFailure(entry, now, status, errorText) {
  // Make the state machine independent of prior reads: an open breaker whose
  // cooldown already expired counts the failure as a half-open probe.
  resolveEntry(entry, now);

  // Only closed-state streaks age out; open/half-open must keep escalating.
  if (
    entry.state === "closed" &&
    entry.lastFailureAt !== null &&
    now - entry.lastFailureAt > HEALTH_BREAKER_CONFIG.windowMs
  ) {
    entry.consecutiveFailures = 0;
  }

  entry.consecutiveFailures += 1;
  entry.lastStatus = status ?? null;
  entry.lastError = normalizeError(errorText);
  entry.lastFailureAt = now;

  if (entry.state === "half-open") {
    // A probe was allowed through and it failed: consume it.
    entry.probesRemaining = Math.max(0, entry.probesRemaining - 1);
    if (entry.probesRemaining > 0) return; // more probes allowed, keep probing
    openBreaker(entry, now); // probe failed → re-open with escalated cooldown
    return;
  }

  if (entry.consecutiveFailures >= HEALTH_BREAKER_CONFIG.openAfter) {
    openBreaker(entry, now);
  }
}

function applySuccess(entry, latencyMs) {
  entry.state = "closed";
  entry.blockedUntil = null;
  entry.cooldownMs = 0;
  entry.consecutiveFailures = 0;
  entry.probesRemaining = 0;
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

  for (const entry of targets) applySuccess(entry, latencyMs);

  return getState({ connectionId, provider, model });
}

/**
 * Record a failed request. `requestScoped: true` errors are caused by the
 * request itself (400 context overflow etc) and are NOT counted.
 * The connection-level failure also increments the provider+model aggregate.
 * @returns {{ state: string, blockedUntil: number|null, consecutiveFailures: number }}
 */
export function recordFailure({ connectionId, provider, model, status, errorText, requestScoped } = {}) {
  if (requestScoped) {
    return getStateFields({ connectionId, provider, model });
  }

  const now = Date.now();

  if (!isNoAuthConnection(connectionId)) {
    const key = connectionKey(connectionId, model);
    let conn = connectionBreakers.get(key);
    if (!conn) {
      conn = createEntry(connectionId, provider, model);
      connectionBreakers.set(key, conn);
    }
    applyFailure(conn, now, status, errorText);
  }

  const aggKey = providerKey(provider, model);
  let agg = providerBreakers.get(aggKey);
  if (!agg) {
    agg = createEntry(null, provider, model);
    providerBreakers.set(aggKey, agg);
  }
  applyFailure(agg, now, status, errorText);

  return getStateFields({ connectionId, provider, model });
}

/** Destructure helper so recordFailure returns exactly the documented shape. */
function getStateFields(params) {
  const { state, blockedUntil, consecutiveFailures } = getState(params);
  return { state, blockedUntil, consecutiveFailures };
}

/**
 * State snapshot for a key. Non-existent keys read as a closed breaker.
 * @returns {{ state: "closed"|"open"|"half-open", consecutiveFailures: number,
 *   blockedUntil: number|null, cooldownMs: number, lastError: string|null,
 *   lastStatus: number|null, lastFailureAt: number|null, avgLatencyMs: number|null,
 *   probesRemaining: number }}
 */
export function getState({ connectionId, provider, model } = {}) {
  return stateOf(primaryEntry({ connectionId, provider, model }));
}

/** True while the breaker for this key is open with a future blockedUntil. */
export function isOpen({ connectionId, provider, model } = {}) {
  const entry = primaryEntry({ connectionId, provider, model });
  if (!entry || entry.state !== "open") return false;
  return entry.blockedUntil !== null && entry.blockedUntil > Date.now();
}

/**
 * True when the key must not be tried: open with a future blockedUntil, or
 * half-open with all allowed probes already consumed. Half-open with probes
 * still available returns false — that is the probe window.
 */
export function isBlockedFor({ connectionId, provider, model } = {}) {
  const entry = primaryEntry({ connectionId, provider, model });
  if (!entry) return false;
  if (entry.state === "open") {
    return entry.blockedUntil !== null && entry.blockedUntil > Date.now();
  }
  if (entry.state === "half-open") {
    return entry.probesRemaining <= 0;
  }
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
  return { tracked: entries.length, open, halfOpen, entries };
}

/**
 * Clear one breaker (manual unblock / tests). Removes the connection entry
 * AND the provider+model aggregate, so the pair starts fully clean — the
 * aggregate is derived from these same failure records.
 */
export function resetBreaker({ connectionId, provider, model } = {}) {
  if (isNoAuthConnection(connectionId)) {
    providerBreakers.delete(providerKey(provider, model));
    return;
  }
  connectionBreakers.delete(connectionKey(connectionId, model));
  if (provider) providerBreakers.delete(providerKey(provider, model));
}

/** Clear every breaker (tests). */
export function resetAll() {
  connectionBreakers.clear();
  providerBreakers.clear();
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
