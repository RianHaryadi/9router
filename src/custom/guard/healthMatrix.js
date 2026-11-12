/**
 * Health matrix (fork T5) — health per (provider, model, account).
 *
 * The breaker is one-dimensional: a `connectionId|model` entry plus a
 * `provider|model` aggregate. That is enough to *stop* routing to a broken
 * account, but it cannot answer the question an operator actually has:
 * "for this provider and model, which accounts can serve it right now, and
 * which ones are down for a reason that needs a human?".
 *
 * This module turns the breaker snapshot into that matrix. It is pure: no DB,
 * no clock of its own (`now` is always passed in), so the dashboard, the
 * routing path and the tests all see the same answer.
 *
 * The matrix answers three questions:
 *   - buildMatrix()   which accounts are usable for a provider|model?
 *   - pickBestAccount() which one should we try first?
 *   - preflight()     can this provider|model serve at all right now?
 */

/** Account health states, ordered from best to worst. */
const STATE_RANK = Object.freeze({ closed: 0, "half-open": 1, open: 2 });

/** Cooldown of an entry that is not currently blocking. */
const NO_COOLDOWN_MS = 0;

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeState(state) {
  return state === "open" || state === "half-open" ? state : "closed";
}

function isBlocking(entry, now) {
  if (!entry) return false;
  const state = normalizeState(entry.state);
  if (state === "open") {
    const until = num(entry.blockedUntil, 0);
    return until > now;
  }
  if (state === "half-open") {
    // A half-open entry with no probes left cannot serve traffic.
    const probes = entry.probesRemaining;
    return probes === 0 || probes === undefined;
  }
  return false;
}

function isUsable(entry, now) {
  if (!entry) return false;
  if (entry.needsHuman === true) return false;
  return !isBlocking(entry, now);
}

/**
 * Rows of the matrix.
 *
 * The breaker keeps one entry per `connectionId|model` plus one aggregate per
 * `provider|model`. Both are rows here: the aggregate describes the model as
 * a whole (a model-scoped lock), the connection rows describe single
 * accounts.
 */
function rowsFromSnapshot(snapshot, now) {
  const entries = (snapshot && (snapshot.entries || snapshot)) || [];
  const rows = [];
  for (const entry of entries) {
    if (!entry) continue;
    const state = normalizeState(entry.state);
    rows.push({
      connectionId: entry.connectionId || null,
      provider: entry.provider || null,
      model: entry.model || null,
      aggregate: !entry.connectionId,
      state,
      healthy: isUsable(entry, now),
      blocked: isBlocking(entry, now),
      consecutiveFailures: num(entry.consecutiveFailures, 0),
      blockedUntil: entry.blockedUntil ?? null,
      cooldownMs: num(entry.cooldownMs, NO_COOLDOWN_MS),
      avgLatencyMs: num(entry.avgLatencyMs, null),
      lastStatus: entry.lastStatus ?? null,
      lastError: entry.lastError ?? null,
      lastFailureKind: entry.lastFailureKind ?? null,
      lastFailureScope: entry.lastFailureScope ?? null,
      lastFailureAction: entry.lastFailureAction ?? null,
      needsHuman: entry.needsHuman === true,
      needsHumanSince: entry.needsHumanSince ?? null,
    });
  }
  return rows;
}

function matchesFilter(row, provider, model) {
  if (provider && row.provider !== provider) return false;
  if (model && row.model !== model) return false;
  return true;
}

/**
 * Build the matrix for a provider/model (or everything when omitted).
 *
 * @param {object} snapshot  healthBreaker.getSnapshot() output
 * @param {object} [opts]
 * @param {string} [opts.provider]
 * @param {string} [opts.model]
 * @param {number} [opts.now]  epoch ms; defaults to Date.now()
 */
export function buildMatrix(snapshot, opts = {}) {
  const now = num(opts.now, Date.now());
  const provider = opts.provider || null;
  const model = opts.model || null;

  const all = rowsFromSnapshot(snapshot, now);
  const rows = all.filter((row) => matchesFilter(row, provider, model));

  // Connection rows are the accounts. The provider|model aggregate is not an
  // account — it is the model-wide verdict — so it is summarised separately.
  const accounts = rows.filter((row) => !row.aggregate);
  const aggregates = rows.filter((row) => row.aggregate);

  const byKind = {};
  for (const row of accounts) {
    const kind = row.lastFailureKind || "none";
    byKind[kind] = (byKind[kind] || 0) + 1;
  }

  const healthy = accounts.filter((row) => row.healthy).length;
  const open = accounts.filter((row) => row.state === "open").length;
  const halfOpen = accounts.filter((row) => row.state === "half-open").length;
  const needsHuman = accounts.filter((row) => row.needsHuman).length;

  const modelBlocked = aggregates.some((row) => row.blocked);
  const providerBlocked = all.some((row) => row.aggregate && row.provider && !row.model && row.blocked);

  let recommendation;
  if (needsHuman > 0 && healthy === 0) {
    recommendation = {
      usable: false,
      reason: `${needsHuman} account(s) need a human (billing/auth) — resolve before retrying`,
    };
  } else if (modelBlocked) {
    recommendation = { usable: false, reason: "the model is blocked for every account (model-scoped fault)" };
  } else if (providerBlocked) {
    recommendation = { usable: false, reason: "the provider is blocked provider-wide (transient upstream fault)" };
  } else if (healthy === 0) {
    recommendation = { usable: false, reason: "no healthy account for this provider|model" };
  } else {
    recommendation = { usable: true, reason: `${healthy} account(s) available` };
  }

  return {
    provider,
    model,
    now,
    accounts,
    aggregates,
    summary: {
      total: accounts.length,
      healthy,
      open,
      halfOpen,
      needsHuman,
      byKind,
    },
    recommendation,
  };
}

/**
 * Pick the account to try first.
 *
 * Order: healthy before unhealthy, closed before half-open before open, then
 * fewest consecutive failures, then lowest average latency. `now` decides
 * whether a still-locked entry counts as blocked.
 */
export function pickBestAccount(matrix, opts = {}) {
  const now = num(opts.now, Date.now());
  const accounts = (matrix && matrix.accounts) || [];
  const usable = accounts.filter((row) => row.healthy && !isBlocking(row, now));
  const pool = usable.length > 0 ? usable : accounts.filter((row) => !isBlocking(row, now));

  if (pool.length === 0) {
    return { connectionId: null, reason: "no account available for this provider|model", degraded: true };
  }

  const ranked = [...pool].sort((a, b) => {
    const stateDiff = (STATE_RANK[a.state] ?? 0) - (STATE_RANK[b.state] ?? 0);
    if (stateDiff !== 0) return stateDiff;
    const failDiff = num(a.consecutiveFailures, 0) - num(b.consecutiveFailures, 0);
    if (failDiff !== 0) return failDiff;
    const aLat = Number.isFinite(a.avgLatencyMs) ? a.avgLatencyMs : Number.POSITIVE_INFINITY;
    const bLat = Number.isFinite(b.avgLatencyMs) ? b.avgLatencyMs : Number.POSITIVE_INFINITY;
    if (aLat !== bLat) return aLat - bLat;
    return String(a.connectionId || "").localeCompare(String(b.connectionId || ""));
  });

  const best = ranked[0];
  return {
    connectionId: best.connectionId,
    reason: usable.length > 0
      ? `selected a healthy account (${best.consecutiveFailures} recent failure(s))`
      : "no healthy account — selected the least recently failed one (degraded)",
    degraded: usable.length === 0,
  };
}

/**
 * Preflight a provider|model before sending traffic.
 *
 * `ok` is false when no account can serve the request. `degraded` is true
 * when a request can be served but only by an account that is not fully
 * healthy.
 */
export function preflight(matrix, opts = {}) {
  const now = num(opts.now, Date.now());
  const model = opts.model || null;
  const accounts = (matrix && matrix.accounts) || [];
  const relevant = model ? accounts.filter((row) => !row.model || row.model === model) : accounts;

  const healthy = relevant.filter((row) => row.healthy && !isBlocking(row, now));
  if (healthy.length > 0) {
    const best = pickBestAccount(matrix, { now });
    return { ok: true, connectionId: best.connectionId, reason: best.reason, degraded: false };
  }

  const usableButUnhealthy = relevant.filter((row) => !isBlocking(row, now));
  if (usableButUnhealthy.length > 0) {
    const best = pickBestAccount(matrix, { now });
    return {
      ok: true,
      connectionId: best.connectionId,
      reason: "no fully healthy account — falling back to a degraded one",
      degraded: true,
    };
  }

  const reason = (matrix && matrix.recommendation && matrix.recommendation.reason) || "no account available";
  return { ok: false, connectionId: null, reason, degraded: true };
}

/**
 * Roll the matrix up per provider — for the dashboard's provider overview.
 */
export function summaryByProvider(matrix) {
  const accounts = (matrix && matrix.accounts) || [];
  const byProvider = new Map();
  for (const row of accounts) {
    const key = row.provider || "unknown";
    if (!byProvider.has(key)) {
      byProvider.set(key, { provider: key, total: 0, healthy: 0, open: 0, halfOpen: 0, needsHuman: 0, models: new Set() });
    }
    const bucket = byProvider.get(key);
    bucket.total += 1;
    if (row.healthy) bucket.healthy += 1;
    if (row.state === "open") bucket.open += 1;
    if (row.state === "half-open") bucket.halfOpen += 1;
    if (row.needsHuman) bucket.needsHuman += 1;
    if (row.model) bucket.models.add(row.model);
  }
  return [...byProvider.values()]
    .map((bucket) => ({ ...bucket, models: [...bucket.models].sort() }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}
