// Dashboard users table (teammates with their own password).
// Additive: creates the table + index if missing. Existing installs are
// untouched — the owner keeps using settings.password.
const migration = {
  version: 10,
  name: "dashboard-users",
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS dashboardUsers (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      isActive INTEGER DEFAULT 1,
      displayName TEXT,
      apiKeyRef TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_du_role ON dashboardUsers(role)");
  },
};

export default migration;
