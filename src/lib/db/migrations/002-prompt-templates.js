const migration = {
  version: 7,
  name: "prompt-templates",
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS promptTemplates (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', content TEXT NOT NULL, version INTEGER NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS promptTemplateVersions (templateId TEXT NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, content TEXT NOT NULL, createdAt TEXT NOT NULL, PRIMARY KEY(templateId, version))`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_prompt_templates_updated ON promptTemplates(updatedAt)");
  },
};

export default migration;
