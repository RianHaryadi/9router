// Per-member dashboard areas.
// Adds the `areas` column to teamMembers: the set of dashboard areas the
// member may reach (JSON array of area ids). An existing member with no value
// keeps chat-only access.
const migration = {
  version: 11,
  name: "member-areas",
  up(db) {
    const cols = new Set(db.all(`PRAGMA table_info(teamMembers)`).map((r) => r.name));
    if (!cols.has("areas")) {
      db.exec(`ALTER TABLE teamMembers ADD COLUMN areas TEXT`);
    }
  },
};

export default migration;
