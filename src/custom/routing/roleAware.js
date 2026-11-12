/**
 * roleAware.js — detect agent role (main vs subagent) and route to appropriate model.
 *
 * Coding agents (Claude Code, etc.) spawn subagents for cheap tasks (file search,
 * read, summarize). Subagents use ~48% of tokens but don't need strong models.
 * This module detects role from request signals and routes accordingly.
 *
 * Detection signals (checked in order, any hit → subagent):
 *   a) System prompt contains fingerprints: 'subagent', 'sub-agent', 'you are a helper',
 *      'exploratory', 'read-only', 'search for', 'summarize the file'
 *   b) Headers: x-role: subagent, x-agent-type: explorer, x-9router-role: subagent
 *   c) No tools defined but has user message asking to read/search/summarize
 *   d) Very short conversation (1-2 messages) with simple task keywords
 *
 * Pure + fail-open. Never throws.
 */

/** System prompt fingerprints that indicate a subagent. */
const SUBAGENT_FINGERPRINTS = [
  "subagent",
  "sub-agent",
  "you are a helper",
  "exploratory",
  "read-only",
  "search for",
  "summarize the file",
];

/** Headers that indicate a subagent role. */
const SUBAGENT_HEADERS = {
  "x-role": "subagent",
  "x-agent-type": "explorer",
  "x-9router-role": "subagent",
};

/** User message keywords that suggest a simple task (when no tools are defined). */
const SIMPLE_TASK_KEYWORDS = [
  "read",
  "search",
  "find",
  "summarize",
  "list",
  "check",
  "look for",
  "get the",
];

/**
 * Extract all text content from messages for fingerprint scanning.
 * @param {object} body - chat completions body
 * @returns {string} concatenated text
 */
function extractTextForFingerprint(body) {
  const parts = [];

  // System prompt
  if (typeof body?.system === "string") {
    parts.push(body.system.toLowerCase());
  } else if (Array.isArray(body?.system)) {
    for (const item of body.system) {
      if (typeof item?.text === "string") parts.push(item.text.toLowerCase());
    }
  }

  // Messages
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (const msg of messages) {
    if (typeof msg?.content === "string") {
      parts.push(msg.content.toLowerCase());
    } else if (Array.isArray(msg?.content)) {
      for (const part of msg.content) {
        if (typeof part?.text === "string") parts.push(part.text.toLowerCase());
      }
    }
  }

  return parts.join(" ");
}

/**
 * Check if headers contain subagent role indicators.
 * @param {object} headers - request headers
 * @returns {string[]} matched header names
 */
function checkHeaders(headers) {
  if (!headers || typeof headers !== "object") return [];
  const matched = [];
  for (const [key, expectedValue] of Object.entries(SUBAGENT_HEADERS)) {
    const actualValue = headers[key] || headers[key.toLowerCase()];
    if (typeof actualValue === "string" && actualValue.toLowerCase() === expectedValue) {
      matched.push(key);
    }
  }
  return matched;
}

/**
 * Check if system prompt contains subagent fingerprints.
 * @param {string} text - concatenated text from body
 * @returns {string[]} matched fingerprints
 */
function checkSystemFingerprints(text) {
  const matched = [];
  for (const fp of SUBAGENT_FINGERPRINTS) {
    if (text.includes(fp)) matched.push(fp);
  }
  return matched;
}

/**
 * Check if user messages contain simple task keywords (when no tools defined).
 * @param {object} body - chat completions body
 * @returns {boolean}
 */
function checkSimpleTaskKeywords(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const hasTools = Array.isArray(body?.tools) && body.tools.length > 0;

  // Only check if no tools are defined
  if (hasTools) return false;

  // Look at user messages
  const userMessages = messages.filter((m) => m?.role === "user");
  if (userMessages.length === 0) return false;

  const lastUser = userMessages[userMessages.length - 1];
  const text = typeof lastUser?.content === "string"
    ? lastUser.content.toLowerCase()
    : Array.isArray(lastUser?.content)
      ? lastUser.content.map((p) => (typeof p?.text === "string" ? p.text.toLowerCase() : "")).join(" ")
      : "";

  return SIMPLE_TASK_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * Check if conversation is very short (1-2 messages) with simple task keywords.
 * @param {object} body - chat completions body
 * @returns {boolean}
 */
function checkShortConversation(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (messages.length > 2) return false;

  // Check if any message contains simple task keywords
  const text = extractTextForFingerprint(body);
  return SIMPLE_TASK_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * Detect the role of the requesting agent.
 * @param {object} body - chat completions body
 * @param {object} [headers] - request headers
 * @returns {{ role: 'main'|'subagent'|'unknown', confidence: number, signals: string[] }}
 */
export function detectRole(body, headers = {}) {
  try {
    if (!body || typeof body !== "object") {
      return { role: "unknown", confidence: 0, signals: [] };
    }

    const signals = [];
    const text = extractTextForFingerprint(body);

    // a) System prompt fingerprints
    const fpMatches = checkSystemFingerprints(text);
    if (fpMatches.length > 0) {
      signals.push(...fpMatches.map((fp) => `system-fingerprint:${fp}`));
    }

    // b) Headers
    const headerMatches = checkHeaders(headers);
    if (headerMatches.length > 0) {
      signals.push(...headerMatches.map((h) => `header:${h}`));
    }

    // c) No tools + simple task keywords
    if (checkSimpleTaskKeywords(body)) {
      signals.push("no-tools-simple-task");
    }

    // d) Short conversation with simple keywords
    if (checkShortConversation(body)) {
      signals.push("short-conversation-simple-task");
    }

    // Determine role and confidence
    if (signals.length === 0) {
      // No subagent signals detected → likely main agent
      return { role: "main", confidence: 0.8, signals: [] };
    }

    // Any signal → subagent with confidence based on signal count
    const confidence = Math.min(1.0, 0.6 + signals.length * 0.1);
    return { role: "subagent", confidence, signals };
  } catch {
    return { role: "unknown", confidence: 0, signals: [] };
  }
}

/**
 * Pick a model based on detected role.
 * @param {'main'|'subagent'|'unknown'} role - detected role
 * @param {object} opts
 * @param {string} [opts.mainModel] - model for main agents
 * @param {string} [opts.subagentModel] - model for subagents (deprecated, use cheapModels)
 * @param {string[]} [opts.cheapModels] - list of cheap models for subagents
 * @returns {{ model: string|null, reason: string }}
 */
export function pickRoleModel(role, { mainModel, subagentModel, cheapModels } = {}) {
  try {
    if (role === "subagent") {
      // Prefer cheapModels array, fall back to subagentModel
      if (Array.isArray(cheapModels) && cheapModels.length > 0) {
        return { model: cheapModels[0], reason: "subagent-cheap-model" };
      }
      if (typeof subagentModel === "string") {
        return { model: subagentModel, reason: "subagent-dedicated-model" };
      }
    }

    if (role === "main" && typeof mainModel === "string") {
      return { model: mainModel, reason: "main-model" };
    }

    // Fallback: no model change
    return { model: null, reason: "no-preference" };
  } catch {
    return { model: null, reason: "error" };
  }
}

/**
 * Apply role-aware routing: detect role + pick model in one call.
 * Mutates body.model if role suggests a different model.
 * @param {object} body - chat completions body (mutated in place)
 * @param {object} [headers] - request headers
 * @param {object} opts - { mainModel, subagentModel, cheapModels }
 * @returns {{ body: object, decision: { role: string, confidence: number, signals: string[], model: string|null, reason: string } }}
 */
export function applyRoleRouting(body, headers = {}, opts = {}) {
  try {
    if (!body || typeof body !== "object") {
      return {
        body,
        decision: { role: "unknown", confidence: 0, signals: [], model: null, reason: "invalid-body" },
      };
    }

    // Detect role
    const { role, confidence, signals } = detectRole(body, headers);

    // Pick model
    const { model, reason } = pickRoleModel(role, opts);

    // Mutate body.model if a model was selected
    if (model !== null) {
      body.model = model;
    }

    return {
      body,
      decision: { role, confidence, signals, model, reason },
    };
  } catch {
    return {
      body,
      decision: { role: "unknown", confidence: 0, signals: [], model: null, reason: "error" },
    };
  }
}
