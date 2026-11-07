/**
 * src/custom/budget/check.js
 *
 * Pure budget gate — never throws, never blocks a request on internal errors.
 * Returns { allowed, reason, usedPct, remainingCents, resetAt }
 *
 * Monthly rollover: if budgetPeriod==='monthly' and startedAt + 30d <= now,
 * the key's spend should be reset by the caller (applyBudgetSpend with reset=first).
 * This module exposes isRolledOver() for the repo layer to trigger a one-time reset.
 */

const MS_30_DAYS = 30 * 24 * 3600 * 1000; // 30 days in ms

/**
 * Detect if a billing period has elapsed.
 * @param {string} startedAt   ISO timestamp or null
 * @param {string} period      'monthly' (default) or 'monthly' only for now
 * @param {number} [now]       inject for testing
 * @returns {boolean}
 */
export function isBudgetPeriodRolledOver(startedAt, period = "monthly", now = Date.now()) {
  if (!startedAt || period !== "monthly") return false;
  return now - new Date(startedAt).getTime() >= MS_30_DAYS;
}

/**
 * Check whether a key's current spend + pending cost would exceed its limit.
 * @param {object} opts
 * @param {number|null} opts.budgetLimitCents   NULL = unlimited
 * @param {string}      [opts.budgetPeriod]      default 'monthly'
 * @param {string|null} [opts.budgetStartedAt]   ISO timestamp
 * @param {number}      [opts.budgetSpentCents]  cumulative spend, default 0
 * @param {number}      [opts.costCents]         cost of this request (can be 0 for gate)
 * @param {number}      [opts.now]               inject for testing
 * @returns {{ allowed: boolean, reason?: string, usedPct: number|null, remainingCents: number|null, resetAt: string|null }}
 */
export function checkBudget({
  budgetLimitCents = null,
  budgetPeriod = "monthly",
  budgetStartedAt = null,
  budgetSpentCents = 0,
  costCents = 0,
  now = Date.now(),
} = {}) {
  const resetAt =
    budgetStartedAt && budgetPeriod === "monthly"
      ? new Date(new Date(budgetStartedAt).getTime() + MS_30_DAYS).toISOString()
      : null;

  // Unlimited — always allow
  if (budgetLimitCents === null) {
    return { allowed: true, usedPct: null, remainingCents: null, resetAt };
  }

  const spent = budgetSpentCents + costCents;
  const limit = budgetLimitCents;

  // Over (or exactly at) budget without room for this (cost>=0) request: denied.
  // With gate cost=0, spent >= limit means any higher-cost request would exceed.
  if (spent >= limit) {
    const usedPct = limit > 0 ? Math.min(100, Math.round((budgetSpentCents / limit) * 100)) : 100;
    return {
      allowed: false,
      reason: "budget-exhausted",
      usedPct,
      remainingCents: Math.max(0, limit - budgetSpentCents),
      resetAt,
    };
  }

  // Under or at limit
  const remainingCents = Math.max(0, limit - spent);
  const usedPct = limit > 0 ? Math.round((spent / limit) * 100) : null;
  return { allowed: true, usedPct, remainingCents, resetAt };
}
