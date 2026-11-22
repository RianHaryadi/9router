// Stable, non-reversible identifier for an API key.
//
// Usage rows used to store the RAW key in usageHistory.apiKey, usageDaily
// (as a JSON map key) and fallbackEvents.apiKey. A DB file, a backup or an
// export then carried every team's secret in plain text — and a leaked
// backup would hand a teammate the owner's key (and with it every provider
// account the owner owns).
//
// The fingerprint replaces the raw key in every persisted row: it is stable
// (same key -> same id, so daily aggregates keep grouping correctly) and it
// cannot be turned back into the key. The raw key is still needed at request
// time (budget lookups, key policy enforcement) — it just never reaches disk.
//
// ponytail: a plain SHA-256 prefix is enough here because the input space is
// high-entropy generated keys. Upgrade to HMAC(API_KEY_SECRET) if keys ever
// become user-chosen low-entropy strings.
import crypto from "node:crypto";

const FINGERPRINT_LENGTH = 16;

/** Sentinel used by the usage aggregate for requests sent without any key. */
export const LOCAL_NO_KEY = "local-no-key";

/**
 * @param {string|null|undefined} key
 * @returns {string|null} hex fingerprint, or null when there is no key.
 */
export function apiKeyFingerprint(key) {
  if (!key || typeof key !== "string") return null;
  const trimmed = key.trim();
  if (!trimmed || trimmed === LOCAL_NO_KEY) return null;
  return crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, FINGERPRINT_LENGTH);
}

/**
 * The value that must be persisted for a key: the fingerprint, or the
 * LOCAL_NO_KEY sentinel when the request carried no key at all.
 * @param {string|null|undefined} key
 * @returns {string}
 */
export function apiKeyRef(key) {
  return apiKeyFingerprint(key) || LOCAL_NO_KEY;
}
