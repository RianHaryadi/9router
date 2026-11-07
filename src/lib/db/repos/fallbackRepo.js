import { getAdapter } from "../driver.js";

const DEFAULT_LIMIT = 100;
const DEFAULT_OFFSET = 0;
const DEFAULT_RECENT_LIMIT = 20;
const REASON_MAX_LEN = 500;
const DEFAULT_KEEP_DAYS = 30;
const DAY_MS = 86400000;

function generateEventId() {
  const ts = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `fe-${ts}-${random}`;
}

function toNumberOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Shared WHERE builder for the read paths below.
function buildWhere(filter) {
  const conds = [];
  const params = [];
  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.requestId) { conds.push("requestId = ?"); params.push(filter.requestId); }
  if (filter.since) { conds.push("timestamp >= ?"); params.push(filter.since); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return { where, params };
}

/**
 * Insert one fallback event row. Never throws — a failed write is logged and
 * reported as null so the request path is never slowed down by observability.
 */
export async function saveFallbackEvent(event = {}) {
  try {
    const db = await getAdapter();
    const row = {
      id: event.id || generateEventId(),
      timestamp: event.timestamp || new Date().toISOString(),
      requestId: event.requestId || null,
      provider: event.provider || null,
      model: event.model || null,
      connectionId: event.connectionId || null,
      apiKey: event.apiKey || null,
      projectName: event.projectName || null,
      fromProvider: event.fromProvider || null,
      fromModel: event.fromModel || null,
      status: toNumberOrNull(event.status),
      reason: event.reason ? String(event.reason).slice(0, REASON_MAX_LEN) : null,
      cooldownMs: toNumberOrNull(event.cooldownMs),
      latencyMs: toNumberOrNull(event.latencyMs),
    };

    db.run(
      `INSERT INTO fallbackEvents(id, timestamp, requestId, provider, model, connectionId, apiKey, projectName, fromProvider, fromModel, status, reason, cooldownMs, latencyMs) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.timestamp, row.requestId, row.provider, row.model,
        row.connectionId, row.apiKey, row.projectName, row.fromProvider,
        row.fromModel, row.status, row.reason, row.cooldownMs, row.latencyMs,
      ]
    );
    return row;
  } catch (e) {
    console.error("[fallbackRepo] saveFallbackEvent failed:", e);
    return null;
  }
}

/**
 * List fallback events, newest first.
 * filter: { limit = 100, offset = 0, provider, model, requestId, since }
 */
export async function getFallbackEvents(filter = {}) {
  try {
    const db = await getAdapter();
    const limit = Number.isFinite(Number(filter.limit)) && Number(filter.limit) > 0
      ? Math.floor(Number(filter.limit))
      : DEFAULT_LIMIT;
    const offset = Number.isFinite(Number(filter.offset)) && Number(filter.offset) > 0
      ? Math.floor(Number(filter.offset))
      : DEFAULT_OFFSET;

    const { where, params } = buildWhere(filter);
    return db.all(
      `SELECT * FROM fallbackEvents ${where} ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
  } catch (e) {
    console.error("[fallbackRepo] getFallbackEvents failed:", e);
    return [];
  }
}

/**
 * Aggregated view for the fallbacks panel: totals, per-provider and
 * per-reason counts (both sorted descending by count) plus recent rows.
 * filter: { provider, model, requestId, since }
 */
export async function getFallbackSummary(filter = {}) {
  try {
    const db = await getAdapter();
    const { where, params } = buildWhere(filter);

    const totalRow = db.get(`SELECT COUNT(*) as c FROM fallbackEvents ${where}`, params);
    const providerRows = db.all(
      `SELECT COALESCE(provider, 'unknown') as provider, COUNT(*) as count FROM fallbackEvents ${where} GROUP BY provider ORDER BY count DESC`,
      params
    );
    const reasonRows = db.all(
      `SELECT COALESCE(reason, 'unknown') as reason, COUNT(*) as count FROM fallbackEvents ${where} GROUP BY reason ORDER BY count DESC`,
      params
    );
    const recent = db.all(
      `SELECT * FROM fallbackEvents ${where} ORDER BY timestamp DESC, id DESC LIMIT ?`,
      [...params, DEFAULT_RECENT_LIMIT]
    );

    const byProvider = {};
    for (const r of providerRows) byProvider[r.provider] = r.count;
    const byReason = {};
    for (const r of reasonRows) byReason[r.reason] = r.count;

    return {
      total: totalRow ? totalRow.c : 0,
      byProvider,
      byReason,
      recent,
    };
  } catch (e) {
    console.error("[fallbackRepo] getFallbackSummary failed:", e);
    return { total: 0, byProvider: {}, byReason: {}, recent: [] };
  }
}

/**
 * Drop events older than keepDays. Returns the number of rows removed.
 */
export async function pruneFallbackEvents(keepDays = DEFAULT_KEEP_DAYS) {
  try {
    const db = await getAdapter();
    const days = Number.isFinite(Number(keepDays)) && Number(keepDays) > 0
      ? Number(keepDays)
      : DEFAULT_KEEP_DAYS;
    const cutoff = new Date(Date.now() - days * DAY_MS).toISOString();
    const res = db.run(`DELETE FROM fallbackEvents WHERE timestamp < ?`, [cutoff]);
    return res?.changes ?? 0;
  } catch (e) {
    console.error("[fallbackRepo] pruneFallbackEvents failed:", e);
    return 0;
  }
}
