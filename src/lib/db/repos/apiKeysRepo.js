import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { keyAccessFromColumns, keyAccessToColumns } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
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

export async function createApiKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    access: { restricted: false, allow: [] },
  };
  const cols = keyAccessToColumns(KEY_ACCESS_UNRESTRICTED);
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, cols.accessRestricted, cols.accessAllow]
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
    // reset flows via reset-budget endpoint).
    let budgetLimitCents = data.budgetLimitCents !== undefined ? data.budgetLimitCents : row.budgetLimitCents;
    let budgetPeriod = data.budgetPeriod !== undefined ? data.budgetPeriod : row.budgetPeriod || "monthly";
    if (budgetLimitCents == null) budgetLimitCents = null; // null literal stays NULL (unlimited)
    let budgetStartedAt = row.budgetStartedAt || null;
    // unlimited -> finite transition seeds the period start if not already set
    if (budgetLimitCents != null && budgetStartedAt == null) {
      budgetStartedAt = new Date().toISOString();
    }
    const budgetSpentCents = row.budgetSpentCents != null ? row.budgetSpentCents : 0;

    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, accessRestricted = ?, accessAllow = ?, budgetLimitCents = ?, budgetPeriod = ?, budgetStartedAt = ?, budgetSpentCents = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, cols.accessRestricted, cols.accessAllow, budgetLimitCents, budgetPeriod, budgetStartedAt, budgetSpentCents, id]
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
        `SELECT budgetLimitCents, budgetPeriod, budgetStartedAt, budgetSpentCents FROM apiKeys WHERE key = ?`,
        [key]
      )
    );
  } catch {
    return null; // fail-open on DB error: treat as no budget row
  }
}

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
