/**
 * chat-completion complexity classifier.
 *
 * `classifyComplexity(body, { now } = {})` reduces a request's *content*
 * surface (bare ESM, no dependencies) to a { level, score, reasons }
 * classification — simple | medium | complex — so the router can prefer a
 * cheap model for simple requests and a strong model for complex ones. This
 * is classification only; model selection / wiring is orchestrator-owned.
 *
 * Fail-open: unknown / unparseable input returns
 * { level: 'medium', score: 0.5, reasons: ['default'] }.
 *
 * Weights are designed so: heavy signals alone reach >= 0.66 (complex),
 * medium signals land in (0.33, 0.66) (medium), the default tiny request
 * lands <= 0.33 (simple).
 */

/** Keys admitted into the fingerprint of a reason set (in fixed order). */
const LEVELS = ["simple", "medium", "complex"];
const THRESHOLDS = { simple: 0.33, complex: 0.66 };

/** Length thresholds per the routing spec */
const BIG_MESSAGE_CHARS = 6000;
const LONG_CONV_CHARS = 12000;
const MANY_MESSAGES = 40;
const BIG_SYSTEM_CHARS = 2000;
const MANY_TOOLS = 4;
const MEDIUM_MESSAGES = 12;
const MEDIUM_CONV_CHARS = 3000;

/** Signal token for each rule (they are the documented reasons). */
const R = {
  manyMessages: "many-messages",
  mediumMessages: "medium-messages",
  longConversation: "long-conversation",
  mediumConversation: "medium-conversation",
  bigSystem: "big-system",
  bigSingleMessage: "big-single-message",
  manyTools: "many-tools",
  mediumTools: "medium-tools",
  forcedToolChoice: "forced-tool-choice",
  jsonSchema: "json-schema",
  codeFence: "code-fence",
  imageParts: "image-parts",
  documentParts: "document-parts",
};

/** Media part: image, image_url, document, file, pdf (document/cache rules). */
const MEDIA_TYPES = new Set(["image", "image_url", "document", "file", "pdf"]);

/** Scalar text (chars) in one message, order-preserving. null-safe. */
function messageChars(message) {
  if (!message) return 0;
  if (typeof message.content === "string") return message.content.length;
  let total = 0;
  for (const part of message?.content ?? []) {
    if (typeof part?.text === "string") total += part.text.length;
  }
  return total;
}

/** Message text parts as an array (content may be a string). */
function messageContent(message) {
  if (typeof message?.content === "string") return [];
  return Array.isArray(message?.content) ? message.content : [];
}

/** Deep-safe media check for a single part. */
function isMedia(part) {
  return typeof part?.type === "string" && MEDIA_TYPES.has(part.type);
}

/** All weighted signals, in fixed order so reasons are deterministic. */
function signals(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const totalChars = messages.reduce((n, m) => n + messageChars(m), 0);
  const userChars = messages
    .filter((m) => m?.role === "user")
    .reduce((n, m) => n + messageChars(m), 0);
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  const parts = (m) => messageContent(m);

  const resulting = [];

  // heavy: total characters > 12000
  if (totalChars > LONG_CONV_CHARS) resulting.push([0.7, R.longConversation]);
  // heavy: > 40 messages
  else if (messages.length > MANY_MESSAGES) resulting.push([0.7, R.manyMessages]);
  // medium: 3000-12000 chars
  else if (totalChars >= MEDIUM_CONV_CHARS) resulting.push([0.35, R.mediumConversation]);
  // medium: 12-40 messages
  else if (messages.length >= MEDIUM_MESSAGES) resulting.push([0.35, R.mediumMessages]);

  // heavy: system prompt present AND > 2000 chars
  if (typeof body?.system === "string" && body.system.length > BIG_SYSTEM_CHARS)
    resulting.push([0.7, R.bigSystem]);
  // heavy: any single user message > 6000 chars
  else if (userChars > BIG_MESSAGE_CHARS) resulting.push([0.25, R.bigSingleMessage]);

  // heavy: > 4 tools
  if (tools.length > MANY_TOOLS) resulting.push([0.7, R.manyTools]);
  // medium: 1-4 tools
  else if (tools.length > 0) resulting.push([0.2, R.mediumTools]);
  // heavy: tool_choice forced (string != auto/none, or object)
  if (typeof body?.tool_choice === "string" && body.tool_choice !== "auto" && body.tool_choice !== "none")
    resulting.push([0.7, R.forcedToolChoice]);
  else if (body?.tool_choice && typeof body.tool_choice === "object") resulting.push([0.7, R.forcedToolChoice]);

  // medium: response_format json_schema
  if (Boolean(body?.response_format?.json_schema)) resulting.push([0.35, R.jsonSchema]);
  // medium: any message contains a fenced code block ```
  if (messages.some((m) => typeof m?.content === "string" && m.content.includes("```")))
    resulting.push([0.35, R.codeFence]);
  // medium: any message contains image parts
  if (messages.some((m) => parts(m).some((p) => isMedia(p) && p.type.startsWith("image"))))
    resulting.push([0.35, R.imageParts]);
  // heavy: any message content part is a document/pdf/file
  if (messages.some((m) => parts(m).some((p) => isMedia(p) && (p.type === "document" || p.type === "file" || p.type === "pdf"))))
    resulting.push([0.7, R.documentParts]);
  // simple: exactly one short user message, no extra surface
  if (messages.length === 1 && !body?.tools?.length && !body?.system)
    resulting.push([0.2, "tiny-request"]);

  return resulting;
}

export function classifyComplexity(body, { now } = {}) {
  try {
    if (!body || typeof body !== "object") return { level: "medium", score: 0.5, reasons: ["default"] };
    const signalsList = signals(body);
    if (signalsList.length === 0) return { level: "medium", score: 0.5, reasons: ["default"] };
    let score = 0;
    const reasons = [];
    for (const [weight, token] of signalsList) {
      score += weight;
      reasons.push(token);
    }
    const level = score >= THRESHOLDS.complex ? "complex" : score <= THRESHOLDS.simple ? "simple" : "medium";
    return { level, score: Math.min(1, Math.max(0, score)), reasons };
  } catch {
    return { level: "medium", score: 0.5, reasons: ["default"] };
  }
}

const VALID_LEVELS = new Set(["simple", "medium", "complex"]);

/** Route tier selection: null-safe, tier missing -> null, invalid -> null. */
export function pickRouteTier(classification, tiers) {
  try {
    if (!classification || typeof classification !== "object") return null;
    const { level } = classification;
    if (typeof level !== "string" || !VALID_LEVELS.has(level)) return null;
    const tier = tiers?.[level] ?? null;
    return tier == null ? null : tier;
  } catch {
    return null;
  }
}
