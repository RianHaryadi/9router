/**
 * Similarity cache — near-duplicate lookup layer over cached chat bodies.
 *
 * The exact-match cache (`semantic.js`) answers "same request?". This module
 * answers "nearly the same request?": a body whose token set overlaps the
 * stored one by `threshold` (default 0.85) can be served from cache instead
 * of hitting the provider.
 *
 * Tokenization: text is lowercased, punctuation becomes whitespace and runs
 * of whitespace collapse. Tokens shorter than 2 characters are dropped; the
 * set holds the remaining words plus the bigrams of consecutive words (joined
 * by a space) so word order still matters somewhat.
 *
 * Scoring: Jaccard index over the two token sets
 * (|A n B| / |A u B|). Identical bodies score 1, disjoint bodies score 0.
 *
 * `createSimilarityIndex()` is an in-memory LRU index (factory, not a module
 * singleton). Ordering uses a monotonic counter instead of the clock so a
 * frozen clock still yields a well-defined LRU order. Never throws on
 * malformed input: a body that yields no tokens is neither stored nor matched.
 *
 * Pure ESM, no external deps, no network. Wiring into the request pipeline
 * happens elsewhere (orchestrator-owned).
 */

/** Hard cap on the number of tokens kept per document. */
const MAX_TOKENS = 20000;

/** Shortest word that survives tokenization. */
const MIN_TOKEN_LENGTH = 2;

/**
 * Normalize text: lowercase, punctuation -> spaces, whitespace collapsed.
 * Non-strings normalize to an empty string.
 */
export function normalizeText(text) {
  if (typeof text !== "string" || text.length === 0) return "";
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Token set of a text: normalized words (length >= 2) plus the bigrams of
 * consecutive words. Capped at MAX_TOKENS entries.
 */
export function tokenSet(text) {
  const normalized = normalizeText(text);
  if (!normalized) return new Set();
  const words = normalized.split(" ").filter((w) => w.length >= MIN_TOKEN_LENGTH);
  const tokens = new Set();
  for (const word of words) {
    if (tokens.size >= MAX_TOKENS) return tokens;
    tokens.add(word);
  }
  for (let i = 0; i + 1 < words.length; i += 1) {
    if (tokens.size >= MAX_TOKENS) break;
    tokens.add(`${words[i]} ${words[i + 1]}`);
  }
  return tokens;
}

/**
 * Jaccard similarity of two token sets, in [0, 1].
 * Non-set or empty inputs score 0.
 */
export function similarityScore(a, b) {
  if (!(a instanceof Set) || !(b instanceof Set)) return 0;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) {
    if (large.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

/**
 * Collect raw text fragments out of an arbitrary value (string, array of
 * strings, `{ text }` part, `{ content }` message). Depth-limited so a
 * cyclic/malformed value can never hang the collector.
 */
function collectText(value, out, depth = 0) {
  if (value === null || value === undefined || depth > 4) return;
  if (typeof value === "string") {
    if (value.trim()) out.push(value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  if (typeof value.text === "string") {
    out.push(value.text);
    return;
  }
  if (value.content !== undefined) {
    collectText(value.content, out, depth + 1);
    return;
  }
  if (value.input !== undefined) {
    collectText(value.input, out, depth + 1);
  }
}

/**
 * Token set of a chat-completions-style body. Collects text from
 * `messages` (string content or array of parts with `.text`), `input`
 * (string or array of `{ text }`), `instructions`, `system` and `prompt`.
 * Returns an empty set when the body carries no usable text.
 */
export function fingerprintTokens(body) {
  const texts = [];
  if (!body || typeof body !== "object") return new Set();
  if (body.messages !== undefined) {
    const messages = Array.isArray(body.messages) ? body.messages : [body.messages];
    for (const message of messages) {
      if (!message || typeof message !== "object") {
        collectText(message, texts);
        continue;
      }
      collectText(message.content, texts);
    }
  }
  collectText(body.input, texts);
  collectText(body.instructions, texts);
  collectText(body.system, texts);
  collectText(body.prompt, texts);

  const tokens = new Set();
  for (const text of texts) {
    for (const token of tokenSet(text)) {
      if (tokens.size >= MAX_TOKENS) return tokens;
      tokens.add(token);
    }
  }
  return tokens;
}

/**
 * In-memory near-duplicate index over cached bodies.
 *
 * `add(body, entry)` stores the entry with its token set (computed once) and
 * returns the internal id (null when the body has no tokens).
 * `find(body)` returns `{ entry, score }` for the best match scoring at least
 * `threshold`, or null. Ties: higher score wins, then most recently added.
 */
export function createSimilarityIndex({ maxEntries = 256, threshold = 0.85 } = {}) {
  const map = new Map(); // id -> { id, body, entry, tokens, addedAt, lastAccess }
  let hits = 0;
  let misses = 0;

  // Monotonic counter, not the clock: identical `now` values would still
  // give every add/find a total order so LRU ordering is well-defined.
  let seq = 0;
  const word = () => ++seq;

  let nextId = 0;

  function evictIfNeeded() {
    while (map.size > maxEntries) {
      let oldestId = null;
      let oldestAt = Infinity;
      for (const [id, record] of map) {
        if (record.lastAccess < oldestAt) {
          oldestAt = record.lastAccess;
          oldestId = id;
        }
      }
      if (oldestId === null) break;
      map.delete(oldestId);
    }
  }

  function add(body, entry) {
    const tokens = fingerprintTokens(body);
    if (tokens.size === 0) return null;
    const id = `sim-${++nextId}`;
    const stamp = word();
    map.set(id, { id, body, entry, tokens, addedAt: stamp, lastAccess: stamp });
    evictIfNeeded();
    return id;
  }

  function find(body) {
    const query = fingerprintTokens(body);
    if (query.size === 0) {
      misses += 1;
      return null;
    }
    let best = null;
    let bestRecord = null;
    for (const record of map.values()) {
      const score = similarityScore(query, record.tokens);
      if (score < threshold) continue;
      if (
        !best ||
        score > best.score ||
        (score === best.score && record.addedAt > bestRecord.addedAt)
      ) {
        best = { entry: record.entry, score };
        bestRecord = record;
      }
    }
    if (!best) {
      misses += 1;
      return null;
    }
    bestRecord.lastAccess = word();
    hits += 1;
    return best;
  }

  function remove(id) {
    return map.delete(id);
  }

  function clear() {
    map.clear();
  }

  function stats() {
    return { size: map.size, hits, misses };
  }

  return { add, find, remove, clear, stats };
}
