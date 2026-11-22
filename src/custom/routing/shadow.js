/**
 * shadow.js — shadow / A-B routing engine.
 *
 * Problem: a routing change (new model, new provider, new tier) can only be
 * judged once it has run in production. Shadowing lets us send a *copy* of a
 * request to a second provider/model while the user keeps receiving the
 * primary answer, so the two answers can be compared offline.
 *
 * Determinism is the whole point of this module: the decision for a given
 * request must be reproducible from the request id alone. Nothing here touches
 * the clock, the filesystem, the network or the database — the same request id
 * always lands in the same sampling bucket and always picks the same shadow
 * target, so retries and replays never flap.
 *
 * Pure + fail-open. Never throws.
 */

import { createHash } from "node:crypto";

/** Default number of sampling buckets. */
const DEFAULT_BUCKETS = 100;

/** Granularity of the weighted target pick (independent of the sampling bucket). */
const TARGET_BUCKETS = 10000;

/** Salt that keeps the target pick independent from the sampling decision. */
const TARGET_SALT = "::shadow-target";

/**
 * Hash a string into a bucket index.
 * @param {string} value - the value to hash
 * @param {number} [buckets=100] - number of buckets (must be a positive integer)
 * @returns {number} an integer in [0, buckets)
 */
export function hashSample(value, buckets = DEFAULT_BUCKETS) {
  try {
    const count = Number.isFinite(buckets) && buckets > 0 ? Math.floor(buckets) : DEFAULT_BUCKETS;
    const text = typeof value === "string" ? value : String(value ?? "");
    const digest = createHash("sha256").update(text).digest();
    const unsigned = digest.readUInt32BE(0);
    return unsigned % count;
  } catch {
    return 0;
  }
}

/**
 * Decide whether a request should also be dispatched to a shadow target.
 * Deterministic in `requestId`: the same id always gives the same answer.
 * @param {object} opts
 * @param {string} opts.requestId - request identifier used as the sampling key
 * @param {number} [opts.ratio=0] - share of requests to shadow, 0..1
 * @param {number} [opts.buckets=100] - sampling resolution
 * @returns {boolean} true when the request should be shadowed
 */
export function shouldShadow({ requestId, ratio = 0, buckets = DEFAULT_BUCKETS } = {}) {
  try {
    const r = Number(ratio);
    if (!Number.isFinite(r) || r <= 0) return false;
    if (r >= 1) return true;
    const count = Number.isFinite(buckets) && buckets > 0 ? Math.floor(buckets) : DEFAULT_BUCKETS;
    const bucket = hashSample(typeof requestId === "string" ? requestId : String(requestId ?? ""), count);
    return bucket < r * count;
  } catch {
    return false;
  }
}

/**
 * Normalize a comparison text: trim + lowercase.
 * @param {unknown} text
 * @returns {string}
 */
function normalizeText(text) {
  return typeof text === "string" ? text.trim().toLowerCase() : "";
}

/**
 * Character-level 3-gram set of a normalized text.
 * Texts shorter than the gram size collapse to a single gram so short
 * strings still produce a meaningful (non-empty) set.
 * @param {string} text - already normalized text
 * @returns {Set<string>}
 */
function ngrams(text) {
  const set = new Set();
  if (!text) return set;
  if (text.length < 3) {
    set.add(text);
    return set;
  }
  for (let i = 0; i + 3 <= text.length; i++) set.add(text.slice(i, i + 3));
  return set;
}

/**
 * Compare a primary answer with a shadow answer.
 * @param {string} primaryText - primary answer text
 * @param {string} shadowText - shadow answer text
 * @returns {{ matched: boolean, similarity: number }} matched is true only when
 *   both texts are non-empty and equal after trimming + lowercasing; similarity
 *   is a 0..1 character-level 3-gram Jaccard score.
 */
export function compareResponses(primaryText, shadowText) {
  try {
    const a = normalizeText(primaryText);
    const b = normalizeText(shadowText);
    if (!a || !b) return { matched: false, similarity: 0 };

    const matched = a === b;
    if (matched) return { matched: true, similarity: 1 };

    const ga = ngrams(a);
    const gb = ngrams(b);
    if (ga.size === 0 || gb.size === 0) return { matched: false, similarity: 0 };

    let intersection = 0;
    for (const gram of ga) if (gb.has(gram)) intersection++;
    const union = ga.size + gb.size - intersection;
    const similarity = union > 0 ? intersection / union : 0;
    return { matched: false, similarity: Math.min(1, Math.max(0, similarity)) };
  } catch {
    return { matched: false, similarity: 0 };
  }
}

/**
 * Create a bounded in-memory store of shadow comparison records.
 * Records are keyed by request id: a later record for the same id replaces the
 * earlier one (and moves to the end). When full, the oldest record is evicted.
 * @param {object} [opts]
 * @param {number} [opts.maxRecords=500] - maximum number of retained records
 * @returns {{ add: Function, get: Function, list: Function, clear: Function }}
 */
export function createShadowStore({ maxRecords = 500 } = {}) {
  const limit = Number.isFinite(maxRecords) && maxRecords > 0 ? Math.floor(maxRecords) : 500;
  /** @type {Map<string, object>} */
  const records = new Map();

  /**
   * Add (or replace) a record.
   * @param {string|object} idOrRecord - request id, or a record carrying one
   * @param {object} [maybeRecord] - the record when an id is passed separately
   * @returns {object|null} the stored record
   */
  function add(idOrRecord, maybeRecord) {
    try {
      const hasRecord = maybeRecord !== undefined;
      const id = hasRecord ? idOrRecord : idOrRecord?.requestId;
      const record = hasRecord ? maybeRecord : idOrRecord;
      if (id === undefined || id === null) return null;
      const key = String(id);
      records.delete(key);
      records.set(key, record);
      while (records.size > limit) {
        const oldest = records.keys().next();
        if (oldest.done) break;
        records.delete(oldest.value);
      }
      return record;
    } catch {
      return null;
    }
  }

  /**
   * Fetch a record by request id.
   * @param {string} requestId
   * @returns {object|null}
   */
  function get(requestId) {
    try {
      const key = String(requestId);
      return records.get(key) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * List records, oldest first.
   * @returns {object[]}
   */
  function list() {
    try {
      return Array.from(records.values());
    } catch {
      return [];
    }
  }

  /** Drop all records. */
  function clear() {
    try {
      records.clear();
    } catch {
      /* fail-open */
    }
  }

  return { add, get, list, clear };
}

/**
 * Normalize a configured shadow target.
 * @param {object} target - { provider, model, weight? }
 * @returns {{ provider: string, model: string, weight: number }|null}
 */
function normalizeTarget(target) {
  try {
    const provider = typeof target?.provider === "string" ? target.provider : "";
    const model = typeof target?.model === "string" ? target.model : "";
    if (!provider || !model) return null;
    const raw = Number(target?.weight);
    const weight = Number.isFinite(raw) && raw > 0 ? raw : 0;
    return { provider, model, weight };
  } catch {
    return null;
  }
}

/**
 * Pick one shadow target, weighted by `target.weight` (default 1), using a
 * deterministic hash of the request id so the choice is stable across retries.
 * @param {{provider: string, model: string, weight: number}[]} targets - normalized targets
 * @param {string} requestId - request identifier
 * @returns {{provider: string, model: string}|null}
 */
function pickTarget(targets, requestId) {
  try {
    if (!Array.isArray(targets) || targets.length === 0) return null;
    if (targets.length === 1) return { provider: targets[0].provider, model: targets[0].model };

    const total = targets.reduce((sum, t) => sum + t.weight, 0);
    if (total <= 0) return { provider: targets[0].provider, model: targets[0].model };

    const key = `${typeof requestId === "string" ? requestId : String(requestId ?? "")}${TARGET_SALT}`;
    const point = (hashSample(key, TARGET_BUCKETS) / TARGET_BUCKETS) * total;
    let acc = 0;
    for (const target of targets) {
      acc += target.weight;
      if (point < acc) return { provider: target.provider, model: target.model };
    }
    const last = targets[targets.length - 1];
    return { provider: last.provider, model: last.model };
  } catch {
    return null;
  }
}

/**
 * Create a shadow router: decides whether to also dispatch a request to a
 * shadow target, records the primary/shadow comparison, and reports stats.
 * @param {object} [opts]
 * @param {object} [opts.config] - { enabled: boolean, ratio: number, targets: [{ provider, model, weight? }] }
 * @param {Function} [opts.sample] - sampler, defaults to shouldShadow
 * @returns {{ plan: Function, record: Function, stats: Function }}
 */
export function createShadowRouter({ config = {}, sample = shouldShadow } = {}) {
  const store = createShadowStore();

  /**
   * Plan the shadow dispatch for a request.
   * @param {object} opts
   * @param {string} opts.requestId - request identifier (the sampling key)
   * @param {object} [opts.modelInfo] - info about the primary model (unused, kept for call-site symmetry)
   * @param {object} [opts.ctx] - extra context (unused, kept for call-site symmetry)
   * @returns {{ shadow: {provider: string, model: string}|null, reason: string }}
   */
  function plan({ requestId, modelInfo, ctx = {} } = {}) {
    try {
      if (!config?.enabled) return { shadow: null, reason: "disabled" };

      const targets = (Array.isArray(config?.targets) ? config.targets : [])
        .map(normalizeTarget)
        .filter(Boolean);
      if (targets.length === 0) return { shadow: null, reason: "no-targets" };

      const rawRatio = Number(config?.ratio);
      const ratio = Number.isFinite(rawRatio) ? Math.min(1, Math.max(0, rawRatio)) : 0;
      if (ratio <= 0) return { shadow: null, reason: "not-sampled" };

      let sampled = false;
      try {
        sampled = Boolean(sample({ requestId, ratio, buckets: DEFAULT_BUCKETS }));
      } catch {
        sampled = false;
      }
      if (!sampled) return { shadow: null, reason: "not-sampled" };

      const target = pickTarget(targets, requestId);
      if (!target) return { shadow: null, reason: "no-targets" };
      return { shadow: target, reason: "sampled" };
    } catch {
      return { shadow: null, reason: "disabled" };
    }
  }

  /**
   * Record the outcome of one primary/shadow comparison.
   * A later record for the same request id replaces the earlier one.
   * Never throws.
   * @param {object} opts
   * @param {string} opts.requestId - request identifier
   * @param {object} [opts.primary] - primary provider/model descriptor
   * @param {object} [opts.shadow] - shadow provider/model descriptor
   * @param {string} [opts.primaryText] - primary answer text
   * @param {string} [opts.shadowText] - shadow answer text
   * @param {number} [opts.latencyMs] - primary latency in ms
   * @param {Error|string} [opts.error] - error carried by the comparison
   * @returns {void}
   */
  function record({ requestId, primary, shadow, primaryText, shadowText, latencyMs, error } = {}) {
    try {
      if (requestId === undefined || requestId === null) return;
      const hasText = typeof primaryText === "string" && typeof shadowText === "string"
        && primaryText.trim() !== "" && shadowText.trim() !== "";
      const comparison = hasText ? compareResponses(primaryText, shadowText) : { matched: false, similarity: 0 };
      store.add(String(requestId), {
        requestId: String(requestId),
        primary: primary ?? null,
        shadow: shadow ?? null,
        primaryText: typeof primaryText === "string" ? primaryText : "",
        shadowText: typeof shadowText === "string" ? shadowText : "",
        latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
        error: error ?? null,
        matched: comparison.matched,
        similarity: comparison.similarity,
      });
    } catch {
      /* fail-open: recording must never break the request path */
    }
  }

  /**
   * Aggregate stats over the recorded comparisons.
   * @returns {{ total: number, compared: number, matched: number, errors: number, byTarget: Record<string, number> }}
   */
  function stats() {
    try {
      const records = store.list();
      const byTarget = {};
      let compared = 0;
      let matched = 0;
      let errors = 0;
      for (const entry of records) {
        if (entry?.primaryText && entry?.shadowText) {
          compared++;
          if (entry.matched) matched++;
        }
        if (entry?.error !== null && entry?.error !== undefined && entry?.error !== false) errors++;
        const shadow = entry?.shadow;
        if (shadow && typeof shadow.provider === "string" && typeof shadow.model === "string") {
          const key = `${shadow.provider}/${shadow.model}`;
          byTarget[key] = (byTarget[key] ?? 0) + 1;
        }
      }
      return { total: records.length, compared, matched, errors, byTarget };
    } catch {
      return { total: 0, compared: 0, matched: 0, errors: 0, byTarget: {} };
    }
  }

  return { plan, record, stats };
}
