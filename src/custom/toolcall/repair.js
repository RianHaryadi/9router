/**
 * repair.js — generic tool-call repair for cheap models.
 *
 * Cheap models frequently emit malformed tool_calls: truncated JSON arguments,
 * an unclosed array/brace, an unquoted key, or a trailing comma. Upstream
 * deepseek-web / kiro implement repair inside their OWN executor. This module
 * is the GENERIC version — a pure repairer plus a retry decision — so any
 * provider can reuse it without forking its executor.
 *
 * Repair strategy (all fail-open, pure):
 *   1. If arguments parse -> leave as-is.
 *   2. Try to auto-close obvious truncation (unbalanced braces/brackets/quotes).
 *   3. Strip trailing stray commas / fix single-quoted to double quotes.
 *   4. If still unparseable, return null -> caller may retry on another model.
 *
 * NEVER logs or prints model output. This is middleware, not a sink.
 */

/**
 * Attempt to parse a possibly-malformed JSON string into an object.
 * Returns a result { ok, value, repaired } or { ok:false }.
 */
export function repairToolArguments(raw) {
  if (typeof raw !== "string") return { ok: false };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false };

  // Fast path: already valid.
  try {
    return { ok: true, value: JSON.parse(trimmed), repaired: false };
  } catch { /* fall through to repair */ }

  // Attempts, from least to most invasive.
  const candidates = [];

  // 1. Auto-close unbalanced braces/brackets/quotes.
  candidates.push(autoCloseJson(trimmed));

  // 2. Strip trailing commas — both before structural chars and at end-of-string
  //    (a truncated call often ends mid-list: `{"a":1,`).
  const noTrailingCommas = trimmed.replace(/,\s*(?=[}\]])/g, "").replace(/,\s*$/, "");
  candidates.push(noTrailingCommas);
  candidates.push(autoCloseJson(noTrailingCommas));

  // 3. Replace single-quoted keys/values with double quotes (naive, JSON-only).
  const singleToDouble = trimmed
    .replace(/'([^']*)'\s*:/g, '"$1":')
    .replace(/:\s*'([^']*)'/g, ':"$1"');
  candidates.push(singleToDouble);
  candidates.push(autoCloseJson(singleToDouble));
  candidates.push(autoCloseJson(singleToDouble.replace(/,\s*(?=[}\]])/g, "")));

  for (const c of candidates) {
    try {
      const value = JSON.parse(c);
      return { ok: true, value, repaired: c !== trimmed };
    } catch { /* try next */ }
  }

  return { ok: false };
}

/** Auto-close a JSON-looking string by counting delimiters. Pure. */
export function autoCloseJson(src) {
  let depth = 0;       // net (braces + brackets)
  let inString = false;
  let quote = null;
  let out = "";
  const stack = [];

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (ch === "\\") { out += src[++i] ?? ""; continue; }
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true; quote = ch; out += ch; continue;
    }
    out += ch;
    if (ch === "{" || ch === "[") { depth++; stack.push(ch === "{" ? "}" : "]"); }
    else if (ch === "}" || ch === "]") { depth = Math.max(0, depth - 1); stack.pop(); }
  }

  // Rebalance only if still in string (unterminated) or unbalanced open.
  if (inString) out += quote;
  while (depth > 0 && stack.length) {
    out += stack.pop();
    depth--;
  }
  return out;
}

/**
 * Decide whether to retry this failed tool call on ANOTHER model.
 * @param {object} toolCall - { id?, type?, function:{name, arguments} }
 * @param {object} opts - { repairsLeft, retryableModels }
 * @returns {boolean}
 */
export function shouldRetryToolCall(toolCall, { repairsLeft = 1, retryableModels = [] } = {}) {
  try {
    if (!toolCall || typeof toolCall !== "object") return false;
    if (typeof toolCall.function?.arguments !== "string") return true; // no args = broken
    const parsed = repairToolArguments(toolCall.function.arguments);
    if (parsed.ok) return false; // model did fine, no retry
    // Only retry when we still have budget AND a target model exists.
    return repairsLeft > 0 && Array.isArray(retryableModels) && retryableModels.length > 0;
  } catch {
    return false;
  }
}
