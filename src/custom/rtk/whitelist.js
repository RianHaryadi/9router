/**
 * whitelist.js — per-tool policy for RTK tool_result compression.
 *
 * Upstream RTK compresses EVERY tool_result it can, chosen purely by content
 * heuristics (autodetectFilter). That is fine for most tools but lossy for
 * tools whose output is small/structural or must stay complete (e.g. a diff,
 * a search index, an exact API response the model parses). This module adds a
 * per-tool allow/deny policy so compression can be scoped.
 *
 * Modes:
 *   { mode: "allow-all" }              (default) -> no restriction (upstream behavior)
 *   { mode: "deny", tools: [...] }     -> skip compression for these tool names
 *   { mode: "allow", tools: [...] }    -> ONLY compress these tool names
 *
 * Pure + fail-open. Never throws. The decision is a predicate the caller
 * (the RTK pass in src/custom) can use; this module itself does NOT mutate.
 */

/** Resolve an effective policy object from a possibly-undefined config. */
export function normalizePolicy(policy) {
  if (!policy || typeof policy !== "object") return { mode: "allow-all", tools: [] };
  const mode = ["allow", "deny", "allow-all"].includes(policy.mode) ? policy.mode : "allow-all";
  const tools = Array.isArray(policy.tools)
    ? policy.tools.filter((t) => typeof t === "string" && t.length > 0)
    : [];
  return { mode, tools };
}

/**
 * Should a given tool_result (or tool message) be compressed under this policy?
 * @param {object} policy  normalized policy (or undefined -> allow-all)
 * @param {string|null} toolName  the tool's name (may be unknown)
 * @returns {boolean} true when compression is permitted
 */
export function shouldCompressTool(policy, toolName) {
  const { mode, tools } = normalizePolicy(policy);
  if (mode === "allow-all") return true;
  if (!toolName) return mode === "allow-all" || mode === "deny"; // unknown name
  if (mode === "deny") return !tools.includes(toolName);
  // allow mode: only listed tools
  return tools.includes(toolName);
}

/**
 * Filter a set of tool messages — given the raw request body and a policy,
 * return the array of tool_message indices (or tool_result blocks) whose
 * compression is allowed. Kept separate from mutation so the caller decides
 * how to map it back onto their concrete shapes.
 */
export function collectCompressibleToolIndices(body, policy) {
  if (!body || typeof body !== "object") return [];
  const items = Array.isArray(body.messages) ? body.messages
    : (Array.isArray(body.input) ? body.input : null);
  if (!items) return [];

  const indices = [];
  for (let i = 0; i < items.length; i++) {
    const msg = items[i];
    if (!msg || typeof msg !== "object") continue;

    // OpenAI tool message: role === "tool" (name may be at msg.name)
    if (msg.role === "tool") {
      if (shouldCompressTool(policy, msg.name || null)) indices.push(i);
      continue;
    }
    // OpenAI Responses function_call_output
    if (msg.type === "function_call_output") {
      if (shouldCompressTool(policy, msg.call_id || msg.name || null)) indices.push(i);
      continue;
    }
    // Claude blocks with tool_result
    if (Array.isArray(msg.content)) {
      let hasToolResult = false;
      for (const block of msg.content) {
        if (block && block.type === "tool_result") { hasToolResult = true; break; }
      }
      if (hasToolResult) {
        const toolName = (msg.content.find((b) => b && b.type === "tool_result") || {})?.tool_use_id
          || null;
        if (shouldCompressTool(policy, toolName)) indices.push(i);
      }
    }
  }
  return indices;
}
