import assert from "node:assert";
import { describe, it, mock } from "vitest";
import { checkBudget, isBudgetPeriodRolledOver } from "../../src/custom/budget/check.js";

describe("src/custom/budget/check", () => {
  describe("isBudgetPeriodRolledOver", () => {
    it("false when startedAt is null", () => {
      assert.strictEqual(isBudgetPeriodRolledOver(null, "monthly", 1000), false);
      assert.strictEqual(isBudgetPeriodRolledOver(undefined, "monthly", 1000), false);
    });
    it("false when period is not monthly", () => {
      const started = new Date(0).toISOString();
      assert.strictEqual(isBudgetPeriodRolledOver(started, "yearly", Date.now()), false);
    });
    it("false before 30 days", () => {
      const started = new Date(Date.now() - 29 * 24 * 3600 * 1000).toISOString();
      assert.strictEqual(isBudgetPeriodRolledOver(started, "monthly", Date.now()), false);
    });
    it("true at exactly 30 days", () => {
      const started = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      assert.strictEqual(isBudgetPeriodRolledOver(started, "monthly", Date.now()), true);
    });
    it("true after 30 days", () => {
      const started = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
      assert.strictEqual(isBudgetPeriodRolledOver(started, "monthly", Date.now()), true);
    });
  });

  describe("checkBudget", () => {
    it("unlimited key always allowed", () => {
      const r = checkBudget({ budgetLimitCents: null, budgetSpentCents: 0 });
      assert.strictEqual(r.allowed, true);
      assert.strictEqual(r.usedPct, null);
      assert.strictEqual(r.remainingCents, null);
      assert.strictEqual(r.resetAt, null);
    });

    it("under limit allowed", () => {
      const r = checkBudget({ budgetLimitCents: 1000, budgetSpentCents: 500, costCents: 0 });
      assert.strictEqual(r.allowed, true);
      assert.strictEqual(r.usedPct, 50);
      assert.strictEqual(r.remainingCents, 500);
    });

    it("cost pushes over limit -> denied", () => {
      const r = checkBudget({ budgetLimitCents: 1000, budgetSpentCents: 950, costCents: 60 });
      assert.strictEqual(r.allowed, false);
      assert.strictEqual(r.reason, "budget-exhausted");
      assert.strictEqual(r.usedPct, 95); // based on current spend, not projected
    });

    it("at exact limit denied (no room)", () => {
      const r = checkBudget({ budgetLimitCents: 1000, budgetSpentCents: 1000, costCents: 0 });
      assert.strictEqual(r.allowed, false);
      assert.strictEqual(r.usedPct, 100);
      assert.strictEqual(r.remainingCents, 0);
    });

    it("zero limit blocks key from the start", () => {
      const r = checkBudget({ budgetLimitCents: 0, budgetSpentCents: 0, costCents: 0 });
      assert.strictEqual(r.allowed, false);
      assert.strictEqual(r.usedPct, 100);
    });

    it("negative remaining never returned", () => {
      const r = checkBudget({ budgetLimitCents: 100, budgetSpentCents: 150, costCents: 0 });
      assert.strictEqual(r.remainingCents, 0);
    });

    it("usedPct 100 when over limit (not capped)", () => {
      const r = checkBudget({ budgetLimitCents: 100, budgetSpentCents: 200, costCents: 0 });
      assert.strictEqual(r.usedPct, 100); // capped at 100 for display
    });

    it("resetAt set for monthly with startedAt", () => {
      const started = new Date(0).toISOString();
      const r = checkBudget({ budgetLimitCents: 1000, budgetStartedAt: started });
      assert.ok(r.resetAt !== null);
      const expectedReset = new Date(new Date(started).getTime() + 30 * 24 * 3600 * 1000).toISOString();
      assert.strictEqual(r.resetAt, expectedReset);
    });

    it("resetAt null when no startedAt", () => {
      const r = checkBudget({ budgetLimitCents: 1000, budgetStartedAt: null });
      assert.strictEqual(r.resetAt, null);
    });

    it("defaults: costCents=0, budgetSpentCents=0, period=monthly", () => {
      // With no args -> unlimited (null limit = unlimited), not false
      const r = checkBudget({});
      assert.strictEqual(r.allowed, true);
    });

    it("injects now for determinism", () => {
      const fixedNow = 30 * 24 * 3600 * 1000;
      const started = new Date(0).toISOString(); // 30 days before fixedNow
      const r = checkBudget({ budgetLimitCents: 1000, budgetStartedAt: started, now: fixedNow });
      // at exactly 30d mark -> rolled over, but checkBudget itself only uses now for resetAt
      assert.ok(r.resetAt !== null);
    });
  });
});
