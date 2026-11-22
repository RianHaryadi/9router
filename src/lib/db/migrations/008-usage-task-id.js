// Task attribution on usage rows.
//
// The client names the task it is working on (x-task-id header, or
// metadata.taskId in the body). Every usage row of that task carries the
// label, so "what did this agent run cost me?" is answerable — not just
// "what did this project cost?".
//
// Additive: an existing install keeps every row, and rows written before
// this migration read as unattributed (NULL), which the dashboard groups
// under "unassigned".
const migration = {
  version: 13,
  name: "usage-task-id",
  up(db) {
    const exists = db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, ["usageHistory"]);
    if (!exists) return;
    const cols = new Set(db.all(`PRAGMA table_info(usageHistory)`).map((r) => r.name));
    if (!cols.has("taskId")) {
      db.exec(`ALTER TABLE usageHistory ADD COLUMN taskId TEXT`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_uh_task ON usageHistory(taskId)`);
  },
};

export default migration;
