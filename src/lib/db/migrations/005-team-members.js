// Team members: teammates who sign in with a password the owner chose.
// Additive: creates the table + index if missing. Existing installs are
// untouched — the owner keeps using settings.password.
const migration = {
  version: 10,
  name: "team-members",
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS teamMembers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      apiKeyRef TEXT,
      isActive INTEGER DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_tm_active ON teamMembers(isActive)");
  },
};

export default migration;
