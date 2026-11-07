/**
 * index.js — transform guard wrapper for Caveman/Ponytail injection.
 *
 * Roadmap guard: "Jangan terapkan Caveman ke output yang dibaca end-user
 * (commit message, review, chatbot customer-facing)".
 *
 * Caveman & Ponytail change OUTPUT style. When the caller signals that the
 * response goes straight to a human end-user, injection must be skipped.
 * Detection sources (checked in order, any hit -> skip):
 *   1. Explicit context flag `endUserFacing` passed by the caller (dashboard
 *      playground, API surface that knows the consumer).
 *   2. Client tool heuristics — surfaces whose whole output is user-visible:
 *      chat UIs & non-coding CLIs. Coding agents (claude, codex, ...) are NOT
 *      end-user-facing: output goes into a diff/editor.
 *
 * Fail-open: on any error we ALLOW injection (matches upstream default-on
 * semantics for explicitly enabled savers).
 */
import { injectCaveman } from "../../../open-sse/rtk/caveman.js";
import { injectPonytail } from "../../../open-sse/rtk/ponytail.js";

/**
 * Client tools whose output is consumed directly by an end user.
 * Keep this list SHORT and obvious: only tools where every token of output is
 * shown to a human as-is.
 */
const END_USER_TOOLS = new Set([
  "chat-ui",
  "web-chat",
  "basic-chat",
  "deepseek-tui",
]);

/**
 * Decide if the response of this request is read directly by an end user.
 * @param {object} ctx - { clientTool, endUserFacing }
 * @returns {boolean}
 */
export function isEndUserFacing({ clientTool, endUserFacing } = {}) {
  try {
    if (endUserFacing === true) return true;
    if (typeof clientTool === "string" && END_USER_TOOLS.has(clientTool)) return true;
    return false;
  } catch {
    return false; // fail-open: treat as agent output (injection allowed)
  }
}

/**
 * Guarded Caveman injection. Skips end-user-facing requests.
 * @returns {boolean} true when injection was applied
 */
export function guardedInjectCaveman(body, format, level, guard = {}) {
  if (isEndUserFacing(guard)) return false;
  try {
    injectCaveman(body, format, level);
    return true;
  } catch {
    return false;
  }
}

/**
 * Guarded Ponytail injection. Skips end-user-facing requests.
 * @returns {boolean} true when injection was applied
 */
export function guardedInjectPonytail(body, format, level, guard = {}) {
  if (isEndUserFacing(guard)) return false;
  try {
    injectPonytail(body, format, level);
    return true;
  } catch {
    return false;
  }
}
