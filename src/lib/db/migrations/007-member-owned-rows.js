// Member-owned combos and prompt templates.
//
// A teammate may manage the objects they created (their own combos, their own
// prompt templates) with the same flow the owner has, but never the owner's
// objects. The owner is recorded in the new ownerId column: NULL = the owner,
// a member id = that member.
//
// Additive: an existing install keeps every row, and every existing row reads
// as owner-owned (NULL), so nothing changes for the owner.
//
// A DB written by an older schema may not have both tables (the upgrade path
// creates only the tables its own migration owns), so each table is checked
// before it is touched.
const migration = {
  version: 12,
  name: "member-owned-rows",
  up(db) {
    for (const table of ["combos", "promptTemplates"]) {
      const exists = db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [table]);
      if (!exists) continue;
      const cols = new Set(db.all(`PRAGMA table_info(${table})`).map((r) => r.name));
      if (!cols.has("ownerId")) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ownerId TEXT`);
      }
    }
  },
};

export default migration;
