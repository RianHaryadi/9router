/**
 * engine.js — declarative policy engine for routing, budget, transform, and guardrail decisions.
 *
 * Unifies multiple decision types (combo selection, transform injection,
 * notifications, blocking, throttling, route-tier overrides) into a single
 * rule-based evaluator. Rules are plain objects with `when` (conditions) and
 * `then` (actions). Conditions support exact match, prefix match, numeric
 * comparisons (">90", "<50"), and regex.
 *
 * Built-in default rules handle common cases (e.g. budget >90 % → free-only
 * combo). Additional rules can be added at runtime via `addRule`.
 *
 * Pure + fail-open: never throws, never breaks a request. Returns an array of
 * decisions the caller can apply. Zero external deps.
 */

// ---------------------------------------------------------------------------
// Condition parsing & matching
// ---------------------------------------------------------------------------

/**
 * Parse a condition value into a matcher function.
 *
 * Supported forms:
 *   - Numeric comparison: ">90", "<50", ">=100", "<=10"
 *   - Regex:              "/^subagent/", "/.*-premium$/"
 *   - Prefix match:       "prefix:freelance"
 *   - Exact match:        "freelance" (string), 42 (number), true (boolean)
 *
 * @param {string} key     the context key this condition tests
 * @param {*} value        the condition value (string/number/boolean)
 * @returns {function}     matcher(ctx) → boolean
 */
export function parseCondition(key, value) {
  try {
    if (typeof value === "string") {
      // Numeric comparison: >90, <50, >=100, <=10
      const numMatch = value.match(/^([<>]=?)(\d+(?:\.\d+)?)$/);
      if (numMatch) {
        const [, op, numStr] = numMatch;
        const num = parseFloat(numStr);
        return (ctx) => {
          const v = ctx[key];
          if (typeof v !== "number") return false;
          switch (op) {
            case ">":  return v > num;
            case "<":  return v < num;
            case ">=": return v >= num;
            case "<=": return v <= num;
            default:   return false;
          }
        };
      }

      // Regex: /^pattern/ or /pattern$/
      if (value.startsWith("/") && value.endsWith("/")) {
        const re = new RegExp(value.slice(1, -1));
        return (ctx) => {
          const v = ctx[key];
          return typeof v === "string" && re.test(v);
        };
      }

      // Prefix match: prefix:value
      if (value.startsWith("prefix:")) {
        const prefix = value.slice(7);
        return (ctx) => {
          const v = ctx[key];
          return typeof v === "string" && v.startsWith(prefix);
        };
      }
    }

    // Exact match (string, number, boolean)
    return (ctx) => ctx[key] === value;
  } catch {
    return () => false;
  }
}

/**
 * Evaluate a single parsed condition against a context.
 * @param {object} ctx     the evaluation context
 * @param {string} key     the context key
 * @param {function} parsed the parsed condition (from parseCondition)
 * @returns {boolean}
 */
export function matchCondition(ctx, key, parsed) {
  try {
    return parsed(ctx);
  } catch {
    return false;
  }
}

/**
 * Evaluate all conditions of a rule against a context (AND logic).
 * @param {object} ctx   the evaluation context
 * @param {object} rule  { when: { key: value, ... }, then: { ... } }
 * @returns {boolean}    true when ALL conditions match
 */
export function matchRule(ctx, rule) {
  try {
    if (!rule || typeof rule !== "object") return false;
    const when = rule.when;
    if (!when || typeof when !== "object") return false;

    for (const key of Object.keys(when)) {
      const parsed = parseCondition(key, when[key]);
      if (!matchCondition(ctx, key, parsed)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Default rules
// ---------------------------------------------------------------------------

/**
 * Built-in default rules. These are always evaluated first; user-added rules
 * are appended and evaluated after.
 */
const DEFAULT_RULES = [
  {
    when: { monthlySpendPct: ">90" },
    then: { combo: "free-only", notify: "budget-warning" },
  },
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a policy engine instance.
 *
 * @param {object} [opts]
 * @param {object[]} [opts.rules]   additional rules to seed the engine
 * @returns {{ evaluate: Function, addRule: Function, removeRule: Function, getRules: Function, stats: Function }}
 */
export function createPolicyEngine(opts = {}) {
  /** @type {object[]} mutable rule list (defaults + user-added). */
  const rules = [...DEFAULT_RULES];

  // Seed with user-provided rules if any
  if (Array.isArray(opts.rules)) {
    for (const r of opts.rules) {
      if (r && typeof r === "object" && r.when && r.then) rules.push(r);
    }
  }

  // Stats
  let evaluations = 0;
  let matches = 0;

  /**
   * Add a rule to the engine.
   * @param {object} rule  { when: { ... }, then: { ... } }
   * @returns {boolean}    true when added successfully
   */
  function addRule(rule) {
    try {
      if (!rule || typeof rule !== "object") return false;
      if (!rule.when || typeof rule.when !== "object") return false;
      if (!rule.then || typeof rule.then !== "object") return false;
      rules.push(rule);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove a rule by reference equality.
   * @param {object} rule  the exact rule object to remove
   * @returns {boolean}    true when removed
   */
  function removeRule(rule) {
    try {
      const idx = rules.indexOf(rule);
      if (idx < 0) return false;
      rules.splice(idx, 1);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get a shallow copy of all rules (defaults + user-added).
   * @returns {object[]}
   */
  function getRules() {
    return [...rules];
  }

  /**
   * Aggregate statistics.
   * @returns {{ evaluations: number, matches: number, rules: number }}
   */
  function stats() {
    return { evaluations, matches, rules: rules.length };
  }

  /**
   * Evaluate all rules against a context and collect decisions.
   *
   * @param {object} ctx  evaluation context (keyGroup, task, complexity,
   *                      monthlySpendPct, provider, model, clientTool,
   *                      endUserFacing, ...)
   * @returns {{ decisions: Array<{ action: string, combo?: string, transforms?: object, notify?: string, reason: string }> }}
   */
  function evaluate(ctx = {}) {
    const decisions = [];
    try {
      evaluations++;
      if (!ctx || typeof ctx !== "object") return { decisions };

      for (const rule of rules) {
        if (!matchRule(ctx, rule)) continue;
        matches++;

        const then = rule.then;
        const decision = {
          action: "apply",
          reason: `rule-matched:${JSON.stringify(rule.when)}`,
        };

        // combo override
        if (typeof then.combo === "string") decision.combo = then.combo;

        // transforms (caveman, ponytail, etc.)
        if (then.transforms && typeof then.transforms === "object") {
          decision.transforms = { ...then.transforms };
        }

        // notification tag
        if (typeof then.notify === "string") decision.notify = then.notify;

        // block / throttle / routeTier
        if (then.block === true)   decision.action = "block";
        if (then.throttle === true) decision.action = "throttle";
        if (typeof then.routeTier === "string") decision.routeTier = then.routeTier;

        decisions.push(decision);
      }
    } catch {
      // fail-open: return whatever decisions were collected so far
    }
    return { decisions };
  }

  return { evaluate, addRule, removeRule, getRules, stats };
}
