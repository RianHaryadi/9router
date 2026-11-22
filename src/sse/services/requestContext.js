// Per-request observability identity: a unique id and a project label that
// travel with every fallback event and usage row one inbound request produces
// (.loop/state.md — Keputusan desain 5 & 6).
//
// Pure helpers only: no DB, no network, no Request/Response objects, no side
// effects. This module must stay trivially unit-testable.

const PROJECT_HEADER = "x-9router-project";
const MAX_VALUE_LENGTH = 64;
const UNASSIGNED_PROJECT = "unassigned";

/** Trim and clamp to 64 chars. Nullish / non-strings become "". */
function normalizeHeaderValue(value) {
  if (value == null) return "";
  const str = typeof value === "string" ? value : String(value);
  return str.trim().slice(0, MAX_VALUE_LENGTH);
}

/**
 * Read one header case-insensitively from either shape the gateway carries:
 * a Headers instance (chat.js `request.headers`) or the plain header object
 * clientRawRequest stores (`Object.fromEntries(request.headers.entries())`).
 */
function readHeader(headers, name) {
  if (!headers || typeof headers !== "object") return null;
  if (typeof headers.get === "function") {
    const value = headers.get(name);
    if (value != null && value !== "") return value;
  }
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== lower) continue;
    const value = headers[key];
    if (value != null && value !== "") return value;
  }
  return null;
}

/**
 * Project attribution for a request (design decision 6):
 *   `x-9router-project` header → API key name → "unassigned".
 * Each candidate is trimmed and capped at 64 chars.
 *
 * @param {Headers|Record<string,string>|null|undefined} headers
 * @param {string|null} [apiKeyName] - display name of the key that sent it
 * @returns {string}
 */
export function resolveProjectName(headers, apiKeyName = null) {
  const fromHeader = normalizeHeaderValue(readHeader(headers, PROJECT_HEADER));
  if (fromHeader) return fromHeader;
  const fromKey = normalizeHeaderValue(apiKeyName);
  if (fromKey) return fromKey;
  return UNASSIGNED_PROJECT;
}

/**
 * Unique-enough id for one inbound request: base36 timestamp + base36 random.
 * Every fallback event of the request carries it so the chain can be replayed.
 * @returns {string}
 */
export function createRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
