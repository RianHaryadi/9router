import { v4 as uuidv4 } from "uuid";
import { randomBytes } from "node:crypto";
import { getAdapter } from "../driver.js";
import { keyAccessFromColumns, keyAccessToColumns } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";
import { apiKeyFingerprint } from "@/shared/utils/apiKeyFingerprint.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    // Non-reversible id of the key. Usage rows store this instead of the raw
    // key, so a DB file or backup never carries a team's secret in plain text.
    keyRef: row.keyRef || apiKeyFingerprint(row.key),
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    access: keyAccessFromColumns(row.accessRestricted, row.accessAllow),
    // Per-key budget (additive; older rows read as unlimited/monthly/0)
    budgetLimitCents: row.budgetLimitCents != null ? row.budgetLimitCents : null,
    budgetPeriod: row.budgetPeriod || "monthly",
    budgetStartedAt: row.budgetStartedAt || null,
    budgetSpentCents: row.budgetSpentCents != null ? row.budgetSpentCents : 0,
    rpmLimit: row.rpmLimit != null ? row.rpmLimit : 0,
    tpmLimit: row.tpmLimit != null ? row.tpmLimit : 0,
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

// Used by the /v1 handlers to read the presented key's access settings.
export async function getApiKeyByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

/** One server-managed key: keep dashboard usage separate from client projects. */
export async function getDashboardChatApiKey() {
  const db = await getAdapter();
  const id = "dashboard-basic-chat";
  let row = db.get(`SELECT key, isActive FROM apiKeys WHERE id = ?`, [id]);
  if (!row) {
    // A fixed primary key makes concurrent first-use creation atomic.
    const key = `sk-${randomBytes(32).toString("hex")}`;
    db.run(
      `INSERT OR IGNORE INTO apiKeys(id, key, keyRef, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, 1, ?)`,
      [id, key, apiKeyFingerprint(key), "Dashboard Basic Chat", "dashboardchat001", new Date().toISOString()]
    );
    row = db.get(`SELECT key, isActive FROM apiKeys WHERE id = ?`, [id]);
  }
  // Never silently rotate/reactivate a disabled key or reset its policies.
  return row && (row.isActive === 1 || row.isActive === true) ? row.key : null;
}

export async function createApiKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    keyRef: apiKeyFingerprint(result.key),
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    access: { restricted: false, allow: [] },
    rpmLimit: 0,
    tpmLimit: 0,
  };
  const cols = keyAccessToColumns(KEY_ACCESS_UNRESTRICTED);
  db.run(
    `INSERT INTO apiKeys(id, key, keyRef, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.keyRef, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, cols.accessRestricted, cols.accessAllow]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    const cols = keyAccessToColumns(merged.access);

    // Budget fields. The client may set budgetLimitCents (number >= 0 or null =
    // unlimited) and budgetPeriod ('monthly'). Spent/startedAt are server-owned:
    // ignore any client writes to them (counter bumps flow via usageRepo; admin
    // reset flows via reset-budget endpoint). RPM is admin-configurable; 0 means unlimited.
    let budgetLimitCents = data.budgetLimitCents !== undefined ? data.budgetLimitCents : row.budgetLimitCents;
    let budgetPeriod = data.budgetPeriod !== undefined ? data.budgetPeriod : row.budgetPeriod || "monthly";
    if (budgetLimitCents == null) budgetLimitCents = null; // null literal stays NULL (unlimited)
    const rpmLimit = data.rpmLimit !== undefined ? data.rpmLimit : (row.rpmLimit ?? 0);
    if (!Number.isInteger(rpmLimit) || rpmLimit < 0 || rpmLimit > 1_000_000) throw new RangeError("rpmLimit must be an integer between 0 and 1000000");
    // TPM (tokens per minute) policy: admin-configurable; 0 means unlimited.
    const tpmLimit = data.tpmLimit !== undefined ? data.tpmLimit : (row.tpmLimit ?? 0);
    if (!Number.isInteger(tpmLimit) || tpmLimit < 0 || tpmLimit > 1_000_000_000) throw new RangeError("tpmLimit must be an integer between 0 and 1000000000");
    let budgetStartedAt = row.budgetStartedAt || null;
    // unlimited -> finite transition seeds the period start if not already set
    if (budgetLimitCents != null && budgetStartedAt == null) {
      budgetStartedAt = new Date().toISOString();
    }
    const budgetSpentCents = row.budgetSpentCents != null ? row.budgetSpentCents : 0;

    db.run(
      `UPDATE apiKeys SET key = ?, keyRef = ?, name = ?, machineId = ?, isActive = ?, accessRestricted = ?, accessAllow = ?, budgetLimitCents = ?, budgetPeriod = ?, budgetStartedAt = ?, budgetSpentCents = ?, rpmLimit = ?, tpmLimit = ? WHERE id = ?`,
      [merged.key, apiKeyFingerprint(merged.key), merged.name, merged.machineId, merged.isActive ? 1 : 0, cols.accessRestricted, cols.accessAllow, budgetLimitCents, budgetPeriod, budgetStartedAt, budgetSpentCents, rpmLimit, tpmLimit, id]
    );
    result = rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}

/** Read-only budget row for a presented API key (fail-open -> unlimited defaults). */
export async function getApiKeyBudget(key) {
  if (!key) return null;
  try {
    const db = await getAdapter();
    return rowToKey(
      db.get(
        `SELECT budgetLimitCents, budgetPeriod, budgetStartedAt, budgetSpentCents, rpmLimit FROM apiKeys WHERE key = ?`,
        [key]
      )
    );
  } catch {
    return null; // fail-open on DB error: treat as no budget row
  }
}

export async function enforceApiKeyRateLimit(key, now = Date.now()) {
  if (!key) return null;
  const db = await getAdapter();
  const record = rowToKey(db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]));
  if (!record || !record.rpmLimit) return null;
  const result = await consumeApiKeyRateLimit(key, { limit: record.rpmLimit, windowMs: 60_000, now });
  if (result.allowed) return null;
  const retryAfter = Math.max(1, Math.ceil((result.resetAt - now) / 1000));
  return new Response(JSON.stringify({ error: { message: "API key request rate limit exceeded", type: "rate_limit_error" } }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
      "X-RateLimit-Limit": String(record.rpmLimit),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
    },
  });
}

export const __apiKeyRepoTest__ = { rowToKey };

/**
 * Increment a key's cumulative monthly spend. Optionally resets the counter
 * first when the period has rolled over (single atomic UPDATE, not a read-modify-write).
 * Returns the new spent value, or null on failure (fail-open).
 * @param {string} key
 * @param {number} costCents  non-negative integer
 * @param {{resetIfRolledOver?: boolean, period?: string, startedAt?: string|null, now?: number}} [opts]
 */
export async function applyBudgetSpend(key, costCents, opts = {}) {
  if (!key || !(costCents > 0)) return null;
  try {
    const db = await getAdapter();
    const { resetIfRolledOver = false, period = "monthly", startedAt = null, now = Date.now() } = opts;
    const rollover = resetIfRolledOver && startedAt && period === "monthly"
        ? now - new Date(startedAt).getTime() >= 30 * 24 * 3600 * 1000
        : false;
    if (rollover) {
      db.run(
        `UPDATE apiKeys SET budgetSpentCents = ?, budgetStartedAt = ? WHERE key = ?`,
        [costCents, new Date(now).toISOString(), key]
      );
    } else {
      db.run(`UPDATE apiKeys SET budgetSpentCents = budgetSpentCents + ? WHERE key = ?`, [
        Math.max(0, Math.round(costCents)),
        key,
      ]);
    }
    const row = db.get(`SELECT budgetSpentCents FROM apiKeys WHERE key = ?`, [key]);
    return row ? row.budgetSpentCents : null;
  } catch {
    return null; // fail-open on DB error
  }
}

/** Explicitly reset a key's budget spend by its id (admin "reset" button). */
export async function resetApiKeyBudgetById(id, startedAt = new Date().toISOString()) {
  if (!id) return false;
  try {
    const db = await getAdapter();
    db.run(`UPDATE apiKeys SET budgetSpentCents = 0, budgetStartedAt = ? WHERE id = ?`, [startedAt, id]);
    return true;
  } catch {
    return false;
  }
}

/** Explicitly reset a key's budget spend (manual admin reset or new billing period). */
export async function resetBudgetSpend(key, startedAt = new Date().toISOString()) {
  if (!key) return false;
  try {
    const db = await getAdapter();
    db.run(`UPDATE apiKeys SET budgetSpentCents = 0, budgetStartedAt = ? WHERE key = ?`, [startedAt, key]);
    return true;
  } catch {
    return false;
  }
}

/** Fixed-window counter on the authenticated API key row. */
export async function consumeApiKeyRateLimit(key, { limit, windowMs, now = Date.now() }) {
  if (!key || !Number.isInteger(limit) || limit <= 0) {
    return { allowed: true, remaining: null, resetAt: null };
  }
  if (!Number.isInteger(windowMs) || windowMs <= 0 || !Number.isFinite(now)) {
    throw new TypeError("Invalid API key rate limit window");
  }
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;
  const db = await getAdapter();
  const row = db.get(
    `UPDATE apiKeys SET
       rpmRequestCount = CASE
         WHEN rpmWindowStart != ? THEN 1
         WHEN rpmRequestCount <= ? THEN rpmRequestCount + 1
         ELSE rpmRequestCount
       END,
       rpmWindowStart = ?
     WHERE key = ?
     RETURNING rpmRequestCount`,
    [windowStart, limit, windowStart, key],
  );
  if (!row) return { allowed: false, remaining: 0, resetAt };
  const allowed = row.rpmRequestCount <= limit;
  return { allowed, remaining: Math.max(0, limit - row.rpmRequestCount), resetAt };
}

/**
 * Fixed-window token counter on the authenticated API key row. Single atomic
 * UPDATE: resets the counter when the window rolls over, otherwise adds the
 * requested tokens, saturating at limit+1 so a burst can never overshoot the
 * limit by more than one request.
 */
export async function consumeApiKeyTokenLimit(key, { limit, windowMs = 60_000, tokens, now = Date.now() }) {
  if (!key || !Number.isInteger(limit) || limit <= 0) {
    return { allowed: true, remaining: null, resetAt: null };
  }
  if (!Number.isInteger(windowMs) || windowMs <= 0 || !Number.isFinite(now)) {
    throw new TypeError("Invalid API key token rate limit window");
  }
  const amount = Number.isFinite(tokens) && tokens > 0 ? Math.round(tokens) : 0;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;
  const db = await getAdapter();
  const row = db.get(
    `UPDATE apiKeys SET
       tpmTokenCount = MIN(
         CASE WHEN COALESCE(tpmWindowStart, 0) != ? THEN 0 ELSE COALESCE(tpmTokenCount, 0) END + ?,
         ?
       ),
       tpmWindowStart = ?
     WHERE key = ?
     RETURNING tpmTokenCount`,
    [windowStart, amount, limit + 1, windowStart, key],
  );
  if (!row) return { allowed: false, remaining: 0, resetAt };
  const allowed = row.tpmTokenCount <= limit;
  return { allowed, remaining: Math.max(0, limit - row.tpmTokenCount), resetAt };
}

/**
 * Enforce the key's own TPM policy. Reads tpmLimit from the row; returns null
 * when allowed (or when no limit is configured). Fails CLOSED on DB errors by
 * throwing — the caller decides how to answer.
 */
export async function enforceApiKeyTokenLimit(key, tokens, now = Date.now()) {
  if (!key) return null;
  const db = await getAdapter();
  const record = rowToKey(db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]));
  if (!record || !record.tpmLimit) return null;
  const result = await consumeApiKeyTokenLimit(key, { limit: record.tpmLimit, windowMs: 60_000, tokens, now });
  if (result.allowed) return null;
  const retryAfter = Math.max(1, Math.ceil((result.resetAt - now) / 1000));
  return new Response(JSON.stringify({ error: { message: "API key token rate limit exceeded", type: "rate_limit_error" } }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
      "X-RateLimit-Limit": String(record.tpmLimit),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
    },
  });
}
