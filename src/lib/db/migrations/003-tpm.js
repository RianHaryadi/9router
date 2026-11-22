// Per-key token rate limit (TPM). Adds the fixed-window token counter columns
// to apiKeys. Idempotent: each column is only added when missing.
const migration = {
  version: 8,
  name: "tpm-limit",
  up(db) {
    const existing = new Set(db.all(`PRAGMA table_info(apiKeys)`).map((r) => r.name));
    const columns = [
      ["tpmLimit", "INTEGER DEFAULT 0"],
      ["tpmWindowStart", "INTEGER DEFAULT 0"],
      ["tpmTokenCount", "INTEGER DEFAULT 0"],
    ];
    for (const [name, def] of columns) {
      if (existing.has(name)) continue;
      db.exec(`ALTER TABLE apiKeys ADD COLUMN ${name} ${def}`);
    }
  },
};

export default migration;
