/**
 * src/custom/policy/index.js — barrel re-exports for the policy module.
 */
export {
  createPolicyEngine,
  parseCondition,
  matchCondition,
  matchRule,
} from "./engine.js";
