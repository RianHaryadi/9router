// ⚠️ AGENT/DEV: Bump this by +1 EVERY TIME you change the schema below
// (add/remove/alter a table, column, or index in TABLES). It drives the
// pre-change safety backup in migrate.js: when the stored version is lower,
// one lightweight DB backup is taken before applying schema changes. Forgetting
// to bump only skips that backup — it does NOT break the additive auto-sync.
export const SCHEMA_VERSION = 11;

export const PRAGMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;

// Declarative current schema. Used by syncSchemaFromTables() to
// auto-add missing tables/columns/indexes after versioned migrations.
// For destructive changes (drop/rename/type-change), write a migration file.
export const TABLES = {
  _meta: {
    columns: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT NOT NULL",
    },
  },
  settings: {
    columns: {
      id: "INTEGER PRIMARY KEY CHECK (id = 1)",
      data: "TEXT NOT NULL",
    },
  },
  providerConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      provider: "TEXT NOT NULL",
      authType: "TEXT NOT NULL",
      name: "TEXT",
      email: "TEXT",
      priority: "INTEGER",
      isActive: "INTEGER DEFAULT 1",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider)",
      "CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority)",
    ],
  },
  providerNodes: {
    columns: {
      id: "TEXT PRIMARY KEY",
      type: "TEXT",
      name: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(type)"],
  },
  proxyPools: {
    columns: {
      id: "TEXT PRIMARY KEY",
      isActive: "INTEGER DEFAULT 1",
      testStatus: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pp_active ON proxyPools(isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pp_status ON proxyPools(testStatus)",
    ],
  },
  apiKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      key: "TEXT UNIQUE NOT NULL",
      // Non-reversible fingerprint of `key` (sha256 prefix). Usage rows store
      // this instead of the raw key, so a DB file or backup never carries a
      // team's secret in plain text. Additive.
      keyRef: "TEXT",
      name: "TEXT",
      machineId: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
      // Per-key access control. Additive columns, picked up by
      // syncSchemaFromTables() on boot; existing rows read as unrestricted (0).
      accessRestricted: "INTEGER DEFAULT 0",
      accessAllow: "TEXT",
      // Per-key monthly budget. NULL budgetLimitCents = unlimited. Additive.
      budgetLimitCents: "INTEGER DEFAULT NULL",
      budgetPeriod: "TEXT DEFAULT 'monthly'",
      budgetStartedAt: "TEXT",
      budgetSpentCents: "INTEGER DEFAULT 0",
      rpmLimit: "INTEGER DEFAULT 0",
      rpmWindowStart: "INTEGER DEFAULT 0",
      rpmRequestCount: "INTEGER DEFAULT 0",
      // Per-key token rate limit (TPM). tpmLimit 0 = unlimited. Additive.
      tpmLimit: "INTEGER DEFAULT 0",
      tpmWindowStart: "INTEGER DEFAULT 0",
      tpmTokenCount: "INTEGER DEFAULT 0",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)",
      "CREATE INDEX IF NOT EXISTS idx_ak_keyref ON apiKeys(keyRef)",
    ],
  },
  combos: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT UNIQUE NOT NULL",
      kind: "TEXT",
      models: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name)"],
  },
  promptTemplates: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT NOT NULL",
      description: "TEXT NOT NULL DEFAULT ''",
      content: "TEXT NOT NULL",
      version: "INTEGER NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_prompt_templates_updated ON promptTemplates(updatedAt)"],
  },
  promptTemplateVersions: {
    columns: {
      templateId: "TEXT NOT NULL",
      version: "INTEGER NOT NULL",
      name: "TEXT NOT NULL",
      description: "TEXT NOT NULL",
      content: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (templateId, version)",
  },
  kv: {
    columns: {
      scope: "TEXT NOT NULL",
      key: "TEXT NOT NULL",
      value: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (scope, key)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope)"],
  },
  usageHistory: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      apiKey: "TEXT",
      endpoint: "TEXT",
      promptTokens: "INTEGER DEFAULT 0",
      completionTokens: "INTEGER DEFAULT 0",
      cost: "REAL DEFAULT 0",
      status: "TEXT",
      tokens: "TEXT",
      meta: "TEXT",
      // Observability (v3): real latency/TTFT + project attribution + fallback
      // count. Additive — picked up by syncSchemaFromTables() on boot.
      latencyMs: "INTEGER DEFAULT 0",
      ttftMs: "INTEGER DEFAULT 0",
      projectName: "TEXT",
      fallbackCount: "INTEGER DEFAULT 0",
      // Fork (T8): request identity for usage rows. Without it a request that
      // reports no tokens could not be told apart from another one with the
      // same provider/model/timestamp, so the dedup in saveRequestUsage()
      // could not recognise it as the same request. Additive.
      requestId: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model)",
      "CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId)",
      "CREATE INDEX IF NOT EXISTS idx_uh_project ON usageHistory(projectName)",
      "CREATE INDEX IF NOT EXISTS idx_uh_request ON usageHistory(requestId)",
    ],
  },
  usageDaily: {
    columns: {
      dateKey: "TEXT PRIMARY KEY",
      data: "TEXT NOT NULL",
    },
  },
  requestDetails: {
    columns: {
      id: "TEXT PRIMARY KEY",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      status: "TEXT",
      data: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_rd_provider ON requestDetails(provider)",
      "CREATE INDEX IF NOT EXISTS idx_rd_model ON requestDetails(model)",
      "CREATE INDEX IF NOT EXISTS idx_rd_conn ON requestDetails(connectionId)",
    ],
  },
  teamMembers: {
    columns: {
      id: "TEXT PRIMARY KEY",
      // Display name of the teammate ("andi"). Not a login name — the
      // teammate only ever types their password.
      name: "TEXT NOT NULL",
      // bcrypt hash of the password the OWNER chose for this teammate.
      passwordHash: "TEXT NOT NULL",
      // The API key this member's chat requests are billed to. The member
      // never sees the key — it stays server-side, so a leaked password
      // grants chat access and nothing else.
      apiKeyRef: "TEXT",
      // The dashboard areas this member may reach, as a JSON array of area
      // ids (see shared/constants/memberAreas.js). Empty = chat only.
      areas: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_tm_active ON teamMembers(isActive)"],
  },
  fallbackEvents: {
    columns: {
      id: "TEXT PRIMARY KEY",
      timestamp: "TEXT NOT NULL",
      requestId: "TEXT",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      apiKey: "TEXT",
      projectName: "TEXT",
      fromProvider: "TEXT",
      fromModel: "TEXT",
      status: "INTEGER",
      reason: "TEXT",
      cooldownMs: "INTEGER",
      latencyMs: "INTEGER",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_fe_ts ON fallbackEvents(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_fe_provider ON fallbackEvents(provider)",
      "CREATE INDEX IF NOT EXISTS idx_fe_request ON fallbackEvents(requestId)",
    ],
  },
};

export function buildCreateTableSql(name, def) {
  const cols = Object.entries(def.columns).map(([k, v]) => `${k} ${v}`);
  if (def.primaryKey) cols.push(def.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${cols.join(", ")})`;
}
