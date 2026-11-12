/**
 * src/custom/budget/quotaScheduler.js
 *
 * Quota-aware account scheduler — spread load across multiple provider accounts
 * by picking the account closest to its quota reset first, while reserving
 * fresh accounts for heavy tasks that need more remaining quota.
 *
 * Design:
 *   - Pure scoring: no side effects inside pickAccount.
 *   - Fail-open: invalid / missing data degrades gracefully (returns null or
 *     falls back to any available account).
 *   - Zero external deps.
 *   - Structured returns with reason strings for observability.
 *
 * Scoring model:
 *   Base score  = proximity to reset (sooner reset → higher score, 0–100).
 *   taskWeight 'light'  → base score dominates (burn near-reset accounts first).
 *   taskWeight 'heavy'  → remaining-quota score dominates (save fresh accounts).
 *   Accounts with quotaUsed >= quotaLimit are excluded entirely.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a reset timestamp to epoch ms. Accepts ISO strings, numbers, or
 * Date-compatible values. Returns Infinity for unparseable input so those
 * accounts sort LAST (least urgent to use).
 * @param {*} resetAt
 * @returns {number} epoch ms or Infinity
 */
function parseReset(resetAt) {
  if (resetAt == null) return Infinity;
  if (typeof resetAt === "number") return resetAt;
  const t = new Date(resetAt).getTime();
  return Number.isFinite(t) ? t : Infinity;
}

/**
 * Sort accounts by reset time, soonest first.
 * Pure — returns a new array; never mutates the input.
 * @param {Array<{ id: string, resetAt: * }>} accounts
 * @param {number} [now]  injectable clock for tests (epoch ms)
 * @returns {Array} sorted copy (soonest reset first)
 */
export function sortAccountsByReset(accounts, now = Date.now()) {
  if (!Array.isArray(accounts)) return [];
  return [...accounts].sort((a, b) => {
    const ra = parseReset(a?.resetAt);
    const rb = parseReset(b?.resetAt);
    return ra - rb;
  });
}

/**
 * Remaining quota as a percentage (0–100).
 * @param {{ quotaLimit: number, quotaUsed: number }} account
 * @returns {number} 0–100; 0 when limit is missing / zero / exhausted
 */
export function calculateRemainingPct(account) {
  if (!account || typeof account !== "object") return 0;
  const limit = Number(account.quotaLimit);
  const used = Number(account.quotaUsed) || 0;
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.max(0, Math.min(100, ((limit - used) / limit) * 100));
}

// ── Scoring internals ────────────────────────────────────────────────────────

/**
 * Compute a 0–100 "reset proximity" score.
 * Accounts whose reset is NOW score 100; accounts whose reset is >= window
 * away score 0.  Infinity (no reset) → 0.
 * @param {number} resetMs   epoch ms of reset
 * @param {number} nowMs     current time
 * @param {number} windowMs  look-ahead window (default 24 h)
 * @returns {number} 0–100
 */
function resetProximityScore(resetMs, nowMs, windowMs) {
  if (!Number.isFinite(resetMs)) return 0;
  const remaining = resetMs - nowMs;
  if (remaining <= 0) return 100; // already past reset — use immediately
  if (remaining >= windowMs) return 0;
  return 100 * (1 - remaining / windowMs);
}

/**
 * Compute a 0–100 "remaining quota" score.
 * More remaining → higher score (so heavy tasks pick the freshest accounts).
 * @param {{ quotaLimit: number, quotaUsed: number }} account
 * @returns {number} 0–100
 */
function remainingQuotaScore(account) {
  return calculateRemainingPct(account);
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a quota-aware scheduler.
 *
 * @param {object} opts
 * @param {Array<{ id: string, quotaLimit: number, quotaUsed: number, resetAt: *, weight?: number }>} opts.accounts
 * @param {number} [opts.resetWindowMs]  look-ahead window for reset proximity (default 24 h)
 * @param {() => number} [opts.now]      injectable clock for tests
 * @returns {{
 *   pickAccount:  (opts?: { taskWeight?: 'light'|'medium'|'heavy', preferredId?: string }) => { account: object|null, reason: string, score: number },
 *   reportUsage:  (accountId: string, costCents: number, tokens: number) => void,
 *   getAccounts:  () => Array,
 *   resetStats:   () => void,
 *   stats:        () => { totalPicks: number, byAccount: Object<string,number>, totalCost: number },
 * }}
 */
export function createQuotaScheduler({
  accounts: initialAccounts = [],
  resetWindowMs = 24 * 60 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  // Internal mutable state — copies of accounts so callers can't corrupt us.
  let accounts = (Array.isArray(initialAccounts) ? initialAccounts : []).map((a) => ({
    id: a?.id ?? "unknown",
    quotaLimit: Number(a?.quotaLimit) || 0,
    quotaUsed: Number(a?.quotaUsed) || 0,
    resetAt: a?.resetAt ?? null,
    weight: Number(a?.weight) || 1,
  }));

  // Stats tracking
  let totalPicks = 0;
  let totalCost = 0;
  /** @type {Object<string,number>} */
  const picksByAccount = {};

  // ── pickAccount ──────────────────────────────────────────────────────

  /**
   * Pick the best account for a task.
   *
   * @param {object} [pickOpts]
   * @param {'light'|'medium'|'heavy'} [pickOpts.taskWeight='medium']
   * @param {string} [pickOpts.preferredId]  when available & eligible, prefer this account
   * @returns {{ account: object|null, reason: string, score: number }}
   */
  function pickAccount({ taskWeight = "medium", preferredId } = {}) {
    try {
      const nowMs = typeof now === "function" ? now() : Date.now();

      // Filter to eligible accounts (still have quota remaining).
      const eligible = accounts.filter(
        (a) => a.quotaLimit > 0 && a.quotaUsed < a.quotaLimit,
      );

      if (eligible.length === 0) {
        return { account: null, reason: "no-eligible-accounts", score: 0 };
      }

      // Weight multipliers for taskWeight → (resetScore, remainingScore)
      const WEIGHTS = {
        light:  { reset: 0.8, remaining: 0.2 },
        medium: { reset: 0.5, remaining: 0.5 },
        heavy:  { reset: 0.2, remaining: 0.8 },
      };
      const w = WEIGHTS[taskWeight] ?? WEIGHTS.medium;

      // Score every eligible account.
      const scored = eligible.map((a) => {
        const resetScore = resetProximityScore(parseReset(a.resetAt), nowMs, resetWindowMs);
        const remScore = remainingQuotaScore(a);
        const composite = resetScore * w.reset + remScore * w.remaining;
        // Apply per-account weight multiplier.
        const weighted = composite * (a.weight || 1);
        return { account: a, score: weighted, resetScore, remScore };
      });

      // Sort descending by score; equal scores tie-break by soonest reset
      // (the module's canonical order — mirrors sortAccountsByReset), so the
      // result is deterministic regardless of input order.
      scored.sort((a, b) => (b.score - a.score)
        || (parseReset(a.account.resetAt) - parseReset(b.account.resetAt)));

      // If a preferredId is given AND it is eligible, check if it is close
      // enough to the top to honour the preference (within 10 % of best score).
      if (typeof preferredId === "string") {
        const bestScore = scored[0]?.score ?? 0;
        const preferred = scored.find((s) => s.account.id === preferredId);
        if (preferred && preferred.score >= bestScore * 0.9) {
          const acct = { ...preferred.account };
          totalPicks++;
          picksByAccount[acct.id] = (picksByAccount[acct.id] || 0) + 1;
          return {
            account: acct,
            reason: `preferred:${preferredId}`,
            score: Math.round(preferred.score * 100) / 100,
          };
        }
      }

      const best = scored[0];
      const acct = { ...best.account };
      totalPicks++;
      picksByAccount[acct.id] = (picksByAccount[acct.id] || 0) + 1;

      // Build a human-readable reason string.
      const parts = [];
      if (taskWeight === "light") parts.push("light→reset-proximity");
      else if (taskWeight === "heavy") parts.push("heavy→remaining-quota");
      else parts.push("balanced");
      parts.push(`reset=${Math.round(best.resetScore)}`);
      parts.push(`remaining=${Math.round(best.remScore)}`);

      return {
        account: acct,
        reason: parts.join(","),
        score: Math.round(best.score * 100) / 100,
      };
    } catch {
      // Fail-open: never throw.
      return { account: null, reason: "error", score: 0 };
    }
  }

  // ── reportUsage ──────────────────────────────────────────────────────

  /**
   * Report that an account was consumed.
   * @param {string} accountId
   * @param {number} costCents
   * @param {number} tokens
   */
  function reportUsage(accountId, costCents, tokens) {
    try {
      const acct = accounts.find((a) => a.id === accountId);
      if (!acct) return;
      acct.quotaUsed += Number(costCents) || 0;
      totalCost += Number(costCents) || 0;
      // tokens is tracked for observability but does not affect quota math
      // in this module — callers may extend as needed.
    } catch {
      // fail-open
    }
  }

  // ── getAccounts ──────────────────────────────────────────────────────

  /**
   * Return a snapshot of current account states.
   * @returns {Array<{ id: string, quotaLimit: number, quotaUsed: number, resetAt: *, weight: number }>}
   */
  function getAccounts() {
    return accounts.map((a) => ({ ...a }));
  }

  // ── stats / resetStats ───────────────────────────────────────────────

  /**
   * Reset all accumulated statistics.
   */
  function resetStats() {
    totalPicks = 0;
    totalCost = 0;
    for (const k of Object.keys(picksByAccount)) delete picksByAccount[k];
  }

  /**
   * @returns {{ totalPicks: number, byAccount: Object<string,number>, totalCost: number }}
   */
  function stats() {
    return {
      totalPicks,
      byAccount: { ...picksByAccount },
      totalCost,
    };
  }

  return { pickAccount, reportUsage, getAccounts, resetStats, stats };
}
