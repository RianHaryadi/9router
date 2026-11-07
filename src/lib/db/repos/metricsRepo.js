import { getAdapter } from "../driver.js";

const DEFAULT_PERCENTILE_LIMIT = 1000;
const DAY_MS = 86400000;

// Nearest-rank percentile on an already ASC-sorted array.
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function summarize(values) {
  if (!values.length) {
    return { p50: null, p90: null, p95: null, p99: null, min: null, max: null, avg: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  return {
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: round2(sum / sorted.length),
  };
}

/**
 * Latency / TTFT percentiles over the most recent rows that carry real
 * latency. filter: { provider, model, since, limit = 1000 }.
 * Returns null-valued stats when there is no data.
 */
export async function getLatencyPercentiles(filter = {}) {
  try {
    const db = await getAdapter();
    const conds = ["latencyMs > 0"];
    const params = [];

    if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
    if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
    if (filter.since) { conds.push("timestamp >= ?"); params.push(filter.since); }

    const limit = Number.isFinite(Number(filter.limit)) && Number(filter.limit) > 0
      ? Math.floor(Number(filter.limit))
      : DEFAULT_PERCENTILE_LIMIT;

    const rows = db.all(
      `SELECT latencyMs, ttftMs FROM usageHistory WHERE ${conds.join(" AND ")} ORDER BY id DESC LIMIT ?`,
      [...params, limit]
    );

    const latencyValues = [];
    const ttftValues = [];
    for (const r of rows) {
      const lat = Number(r.latencyMs);
      if (Number.isFinite(lat) && lat > 0) latencyValues.push(lat);
      const ttft = Number(r.ttftMs);
      if (Number.isFinite(ttft) && ttft > 0) ttftValues.push(ttft);
    }

    return {
      count: latencyValues.length,
      latencyMs: summarize(latencyValues),
      ttftMs: summarize(ttftValues),
    };
  } catch (e) {
    console.error("[metricsRepo] getLatencyPercentiles failed:", e);
    return {
      count: 0,
      latencyMs: { p50: null, p90: null, p95: null, p99: null, min: null, max: null, avg: null },
      ttftMs: { p50: null, p90: null, p95: null, p99: null, min: null, max: null, avg: null },
    };
  }
}

/**
 * Spend grouped by projectName (rows without a project roll into
 * "unassigned"). filter: { since }. Sorted by cost DESC.
 */
export async function getSpendByProject(filter = {}) {
  try {
    const db = await getAdapter();
    const conds = [];
    const params = [];

    if (filter.since) { conds.push("timestamp >= ?"); params.push(filter.since); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const rows = db.all(
      `SELECT COALESCE(projectName, 'unassigned') as project,
              SUM(cost) as cost,
              SUM(promptTokens) as promptTokens,
              SUM(completionTokens) as completionTokens,
              COUNT(*) as requests
       FROM usageHistory ${where}
       GROUP BY COALESCE(projectName, 'unassigned')
       ORDER BY cost DESC`,
      params
    );

    return rows.map((r) => ({
      project: r.project,
      cost: r.cost || 0,
      promptTokens: r.promptTokens || 0,
      completionTokens: r.completionTokens || 0,
      requests: r.requests || 0,
    }));
  } catch (e) {
    console.error("[metricsRepo] getSpendByProject failed:", e);
    return [];
  }
}

/**
 * Per-provider rollup: requests, cost, average latency/TTFT and the number
 * of non-ok requests. filter: { since }. Sorted by requests DESC.
 */
export async function getProviderHealthSnapshot(filter = {}) {
  try {
    const db = await getAdapter();
    const conds = [];
    const params = [];

    if (filter.since) { conds.push("timestamp >= ?"); params.push(filter.since); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const rows = db.all(
      `SELECT provider,
              COUNT(*) as requests,
              SUM(cost) as cost,
              AVG(latencyMs) as avgLatencyMs,
              AVG(ttftMs) as avgTtftMs,
              SUM(CASE WHEN COALESCE(status, 'ok') != 'ok' THEN 1 ELSE 0 END) as errors
       FROM usageHistory ${where}
       GROUP BY provider
       ORDER BY requests DESC`,
      params
    );

    return rows.map((r) => ({
      provider: r.provider || "unknown",
      requests: r.requests || 0,
      cost: r.cost || 0,
      avgLatencyMs: r.avgLatencyMs == null ? null : round2(Number(r.avgLatencyMs)),
      avgTtftMs: r.avgTtftMs == null ? null : round2(Number(r.avgTtftMs)),
      errors: r.errors || 0,
    }));
  } catch (e) {
    console.error("[metricsRepo] getProviderHealthSnapshot failed:", e);
    return [];
  }
}
