// API key fingerprint (keyRef). Usage rows store this non-reversible id
// instead of the raw key, so a DB file or backup never carries a team's
// secret in plain text.
//
// Backfills keyRef for existing apiKeys rows and rewrites the raw keys that
// were already persisted into usageHistory.apiKey / fallbackEvents.apiKey.
// Idempotent: rows that already hold a fingerprint are skipped.
import crypto from "node:crypto";

const FINGERPRINT_LENGTH = 16;

function fingerprint(key) {
  if (!key || typeof key !== "string") return null;
  const trimmed = key.trim();
  if (!trimmed) return null;
  return crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, FINGERPRINT_LENGTH);
}

const migration = {
  version: 9,
  name: "api-key-fingerprint",
  up(db) {
    const cols = new Set(db.all(`PRAGMA table_info(apiKeys)`).map((r) => r.name));
    if (!cols.has("keyRef")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN keyRef TEXT`);
    }

    // Backfill apiKeys.keyRef from the raw key.
    const keys = db.all(`SELECT id, key FROM apiKeys WHERE key IS NOT NULL AND key <> ''`);
    for (const row of keys) {
      const ref = fingerprint(row.key);
      if (!ref) continue;
      db.run(`UPDATE apiKeys SET keyRef = ? WHERE id = ?`, [ref, row.id]);
    }

    // Rewrite raw keys already written into usageHistory / fallbackEvents.
    const tables = ["usageHistory", "fallbackEvents"];
    for (const table of tables) {
      let exists = true;
      try {
        db.all(`SELECT 1 FROM ${table} LIMIT 1`);
      } catch {
        exists = false;
      }
      if (!exists) continue;
      const rows = db.all(`SELECT id, apiKey FROM ${table} WHERE apiKey IS NOT NULL AND apiKey <> ''`);
      for (const row of rows) {
        const ref = fingerprint(row.apiKey);
        // Not a fingerprint yet (a raw key): replace it. A value that already
        // looks like a fingerprint is left alone.
        if (!ref) continue;
        if (row.apiKey.length === FINGERPRINT_LENGTH && row.apiKey === ref) continue;
        db.run(`UPDATE ${table} SET apiKey = ? WHERE id = ?`, [ref, row.id]);
      }
    }
  },
};

export default migration;
