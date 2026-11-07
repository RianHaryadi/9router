/**
 * tokenMeter.js — estimate token deltas for the transform pipeline.
 *
 * The upstream RTK counts BYTES (before/after chars). TokenMeter estimates
 * TOKENS so savers can report "~N tok saved" instead of just bytes, and so a
 * per-key policy can gate a saver by projected token savings.
 *
 * Heuristics are intentionally cheap & provider-agnostic (no tiktoken dep):
 *   - English/ASCII-heavy text  -> ~chars / 4
 *   - CJK-heavy text            -> ~chars (roughly 1 token/char)
 *   - code/mixed                -> ~chars / 3.5
 * This matches the ~4-char-per-token convention used by most OpenAI-compatible
 * cost estimators. It is an ESTIMATE, never an exact count.
 *
 * Pure + fail-open: never throws, always returns a number >= 0.
 */

// Soft cap on text inspected for token estimation (avoid pathological inputs).
const MAX_SCAN_CHARS = 1_000_000;

function cjkRatio(text) {
  if (!text) return 0;
  let cjk = 0;
  let n = 0;
  const scan = text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text;
  for (let i = 0; i < scan.length; i++) {
    const code = scan.charCodeAt(i);
    // CJK Unified Ideographs (4E00-9FFF), Hiragana/Katakana, Hangul, fullwidth
    if ((code >= 0x4e00 && code <= 0x9fff)
      || (code >= 0x3040 && code <= 0x30ff)
      || (code >= 0xac00 && code <= 0xd7af)
      || (code >= 0xff00 && code <= 0xffef)) {
      cjk++;
    }
    n++;
  }
  return n > 0 ? cjk / n : 0;
}

/** Rough per-token divisor by content mix. */
function divisorFor(text) {
  const cjk = cjkRatio(text);
  if (cjk > 0.3) return 1;            // heavily CJK: ~1 token/char
  if (cjk > 0.1) return 2;            // mixed
  return 4;                           // mostly latin/ascii
}

/**
 * Estimate tokens for a single string.
 * @param {string} text
 * @returns {number} estimated token count (float, >= 0)
 */
export function estimateTokens(text) {
  if (typeof text !== "string" || text.length === 0) return 0;
  const scan = text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text;
  const divisor = divisorFor(scan);
  // Reserve a small fixed overhead for structural tokens around the text.
  return scan.length / divisor + 1;
}

/**
 * Collect all estimable text from a body (messages/input/blocks/tool results),
 * mirroring the shapes RTK compresses so savings are comparable.
 * Pure — does NOT mutate.
 * @param {object} body
 * @returns {string[]} text segments found
 */
export function collectBodyText(body) {
  if (!body || typeof body !== "object") return [];

  const out = [];
  const pushText = (v) => { if (typeof v === "string" && v) out.push(v); };
  const pushContent = (content) => {
    if (typeof content === "string") { pushText(content); return; }
    if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part === "string") { pushText(part); continue; }
        if (part && typeof part === "object") {
          pushText(part.text);
          if (typeof part.content === "string") pushText(part.content);
          else if (Array.isArray(part.content)) pushContent(part.content);
        }
      }
    }
  };

  const items = Array.isArray(body.messages) ? body.messages
    : (Array.isArray(body.input) ? body.input : null);
  if (items) {
    for (const msg of items) {
      if (!msg || typeof msg !== "object") continue;
      if (msg.type === "function_call_output") {
        if (typeof msg.output === "string") pushText(msg.output);
        else if (Array.isArray(msg.output)) pushContent(msg.output);
        continue;
      }
      pushText(msg.content_text);
      pushContent(msg.content);
    }
  }
  if (typeof body.instructions === "string") pushText(body.instructions);
  if (typeof body.system === "string") pushText(body.system);

  return out;
}

/**
 * Estimate total tokens for a body by summing per-text-segment estimates.
 * @param {object} body
 * @returns {number}
 */
export function estimateBodyTokens(body) {
  let total = 0;
  for (const seg of collectBodyText(body)) total += estimateTokens(seg);
  return total;
}

/**
 * Convenience delta helper: tokensBefore - tokensAfter.
 * @param {object} bodyBefore
 * @param {object} bodyAfter
 * @returns {{ before: number, after: number, saved: number, savedPct: number|null }}
 */
export function tokenDelta(bodyBefore, bodyAfter) {
  const before = estimateBodyTokens(bodyBefore);
  const after = estimateBodyTokens(bodyAfter);
  const saved = Math.max(0, before - after);
  return {
    before,
    after,
    saved,
    savedPct: before > 0 ? (saved / before) * 100 : null,
  };
}
