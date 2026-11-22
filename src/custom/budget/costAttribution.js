/**
 * src/custom/budget/costAttribution.js
 *
 * Cost attribution per task / session / project.
 *
 * Tracks every model request's cost so callers can answer:
 *   - "How much did task X cost?"
 *   - "What is project Y's total spend this week?"
 *   - "Export a CSV of all costs for billing."
 *
 * Design:
 *   - LRU eviction on both the task map and the project map so memory is
 *     bounded (maxTasks / maxProjects).
 *   - Lazy TTL expiry: entries older than ttlMs are silently dropped on read.
 *   - Pure parsers (parseTaskId, parseProject) — no side effects, null-safe.
 *   - Fail-open: every public method catches and returns a safe default.
 *   - Zero external deps.
 */

// ── LRU helpers ──────────────────────────────────────────────────────────────

/**
 * Bump a key to the most-recently-used tail of a Map (Map preserves insertion
 * order, so delete + re-set moves it to the end).
 */
function bumpLRU(map, key) {
  const val = map.get(key);
  if (val !== undefined) {
    map.delete(key);
    map.set(key, val);
  }
}

/** Evict the least-recently-used entry (first key in Map iteration order). */
function evictLRU(map) {
  const first = map.keys().next();
  if (!first.done) map.delete(first.value);
}

// ── Parsers ──────────────────────────────────────────────────────────────────

/**
 * Extract a task / session / request identifier from headers + body.
 *
 * Lookup order:
 *   1. headers: x-task-id → x-session-id → x-request-id
 *   2. body:    metadata.taskId → metadata.sessionId
 *   3. fallback: null (untracked)
 *
 * @param {object|null} headers  case-insensitive header bag
 * @param {object|null} body     request body
 * @returns {string|null}
 */
export function parseTaskId(headers, body) {
  try {
    // Headers — accept any casing.
    const h = headers && typeof headers === "object" ? headers : {};
    const getHeader = (name) => {
      if (h[name] != null) return h[name];
      // case-insensitive fallback
      const lower = name.toLowerCase();
      for (const k of Object.keys(h)) {
        if (k.toLowerCase() === lower) return h[k];
      }
      return undefined;
    };

    const fromHeader =
      getHeader("x-task-id") ??
      getHeader("x-session-id") ??
      getHeader("x-request-id");
    if (typeof fromHeader === "string" && fromHeader) return fromHeader;

    // Body metadata.
    const meta = body?.metadata;
    if (meta && typeof meta === "object") {
      if (typeof meta.taskId === "string" && meta.taskId) return meta.taskId;
      if (typeof meta.sessionId === "string" && meta.sessionId) return meta.sessionId;
    }
  } catch {
    // fail-open
  }
  return null;
}

/**
 * Extract a project identifier from headers + body.
 *
 * Lookup order:
 *   1. headers: x-project
 *   2. body:    metadata.project → project field
 *   3. fallback: 'Default Key'
 *
 * @param {object|null} headers
 * @param {object|null} body
 * @returns {string}
 */
export function parseProject(headers, body) {
  try {
    const h = headers && typeof headers === "object" ? headers : {};
    const getHeader = (name) => {
      if (h[name] != null) return h[name];
      const lower = name.toLowerCase();
      for (const k of Object.keys(h)) {
        if (k.toLowerCase() === lower) return h[k];
      }
      return undefined;
    };

    const fromHeader = getHeader("x-project");
    if (typeof fromHeader === "string" && fromHeader) return fromHeader;

    const meta = body?.metadata;
    if (meta && typeof meta === "object") {
      if (typeof meta.project === "string" && meta.project) return meta.project;
    }
    if (typeof body?.project === "string" && body.project) return body.project;
  } catch {
    // fail-open
  }
  return "Default Key";
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a cost tracker with bounded LRU maps and lazy TTL expiry.
 *
 * @param {object} [opts]
 * @param {number} [opts.maxTasks=1024]     LRU capacity for task entries
 * @param {number} [opts.maxProjects=256]   LRU capacity for project entries
 * @param {number} [opts.ttlMs=86400000]    entry TTL (24 h default)
 * @param {() => number} [opts.now]         injectable clock for tests
 * @returns {{
 *   track:          (entry: object) => void,
 *   getTaskCost:    (taskId: string) => object|null|undefined,
 *   getProjectCost: (project: string) => object|null,
 *   getAllTasks:    (filter?: { project?: string, since?: number }) => Array,
 *   getAllProjects: (filter?: { since?: number }) => Array,
 *   exportReport:   (opts?: { format?: 'json'|'csv', since?: number, project?: string }) => string,
 *   stats:          () => { trackedTasks: number, trackedProjects: number, totalCost: number, totalRequests: number },
 * }}
 */
export function createCostTracker({
  maxTasks = 1024,
  maxProjects = 256,
  ttlMs = 86_400_000,
  now = () => Date.now(),
} = {}) {
  /** @type {Map<string, object>} task-id → aggregated entry */
  const taskMap = new Map();
  /** @type {Map<string, object>} project → aggregated entry */
  const projectMap = new Map();

  let totalCost = 0;
  let totalRequests = 0;

  // ── internal helpers ─────────────────────────────────────────────────

  /** Return true if the entry is still within its TTL. */
  function isAlive(entry) {
    if (!entry || typeof entry.lastSeen !== "number") return false;
    const nowMs = typeof now === "function" ? now() : Date.now();
    return nowMs - entry.lastSeen <= ttlMs;
  }

  /** Purge dead entries from a map (lazy GC on write). */
  function purgeDead(map) {
    for (const [key, entry] of map) {
      if (!isAlive(entry)) map.delete(key);
    }
  }

  // ── track ────────────────────────────────────────────────────────────

  /**
   * Record a single model request's cost.
   *
   * @param {object} entry
   * @param {string}  entry.taskId
   * @param {string}  entry.project
   * @param {string}  entry.model
   * @param {string}  entry.provider
   * @param {number}  entry.promptTokens
   * @param {number}  entry.completionTokens
   * @param {number}  entry.costCents
   * @param {number}  entry.latencyMs
   * @param {number}  [entry.timestamp]  epoch ms; defaults to now()
   */
  function track(entry) {
    try {
      if (!entry || typeof entry !== "object") return;
      const nowMs = typeof now === "function" ? now() : Date.now();
      const ts = typeof entry.timestamp === "number" ? entry.timestamp : nowMs;

      const taskId = typeof entry.taskId === "string" ? entry.taskId : null;
      const project = typeof entry.project === "string" ? entry.project : "Default Key";
      const model = typeof entry.model === "string" ? entry.model : "unknown";
      const cost = Number(entry.costCents) || 0;
      const promptTok = Number(entry.promptTokens) || 0;
      const compTok = Number(entry.completionTokens) || 0;

      totalCost += cost;
      totalRequests++;

      // ── Task aggregation ──────────────────────────────────────────
      if (taskId) {
        // Lazy GC + LRU eviction.
        purgeDead(taskMap);
        if (taskMap.has(taskId)) {
          bumpLRU(taskMap, taskId);
        } else if (taskMap.size >= maxTasks) {
          evictLRU(taskMap);
        }

        let t = taskMap.get(taskId);
        if (!t) {
          t = {
            taskId,
            project,
            totalCostCents: 0,
            requests: 0,
            promptTokens: 0,
            completionTokens: 0,
            byModel: {},
            firstSeen: ts,
            lastSeen: ts,
          };
          taskMap.set(taskId, t);
        }

        t.totalCostCents += cost;
        t.requests++;
        t.promptTokens += promptTok;
        t.completionTokens += compTok;
        t.lastSeen = ts;
        if (ts < t.firstSeen) t.firstSeen = ts;

        // by-model breakdown
        if (!t.byModel[model]) t.byModel[model] = { cost: 0, requests: 0 };
        t.byModel[model].cost += cost;
        t.byModel[model].requests++;
      }

      // ── Project aggregation ───────────────────────────────────────
      purgeDead(projectMap);
      if (projectMap.has(project)) {
        bumpLRU(projectMap, project);
      } else if (projectMap.size >= maxProjects) {
        evictLRU(projectMap);
      }

      let p = projectMap.get(project);
      if (!p) {
        p = {
          project,
          totalCostCents: 0,
          requests: 0,
          tasks: new Set(),
          byModel: {},
          firstSeen: ts,
          lastSeen: ts,
        };
        projectMap.set(project, p);
      }

      p.totalCostCents += cost;
      p.requests++;
      p.lastSeen = ts;
      if (ts < p.firstSeen) p.firstSeen = ts;
      if (taskId) p.tasks.add(taskId);

      if (!p.byModel[model]) p.byModel[model] = { cost: 0, requests: 0 };
      p.byModel[model].cost += cost;
      p.byModel[model].requests++;
    } catch {
      // fail-open — never throw
    }
  }

  // ── getTaskCost ──────────────────────────────────────────────────────

  /**
   * Look up aggregated cost for a task.
   * @param {string} taskId
   * @returns {{ taskId: string, project: string, totalCostCents: number, requests: number,
   *   promptTokens: number, completionTokens: number, byModel: object,
   *   firstSeen: number, lastSeen: number }|null|undefined}
   *   `undefined` for invalid input (fail-open), `null` when the task is unknown
   */
  function getTaskCost(taskId) {
    try {
      if (typeof taskId !== "string" || !taskId) return undefined;
      const t = taskMap.get(taskId);
      if (!t || !isAlive(t)) return null;
      bumpLRU(taskMap, taskId);
      return {
        taskId: t.taskId,
        project: t.project,
        totalCostCents: t.totalCostCents,
        requests: t.requests,
        promptTokens: t.promptTokens,
        completionTokens: t.completionTokens,
        byModel: { ...t.byModel },
        firstSeen: t.firstSeen,
        lastSeen: t.lastSeen,
      };
    } catch {
      return null;
    }
  }

  // ── getProjectCost ───────────────────────────────────────────────────

  /**
   * @param {string} project
   * @returns {{ project: string, totalCostCents: number, requests: number, tasks: number,
   *   byModel: object, firstSeen: number, lastSeen: number }|null}
   */
  function getProjectCost(project) {
    try {
      if (typeof project !== "string" || !project) return null;
      const p = projectMap.get(project);
      if (!p || !isAlive(p)) return null;
      bumpLRU(projectMap, project);
      return {
        project: p.project,
        totalCostCents: p.totalCostCents,
        requests: p.requests,
        tasks: p.tasks.size,
        byModel: { ...p.byModel },
        firstSeen: p.firstSeen,
        lastSeen: p.lastSeen,
      };
    } catch {
      return null;
    }
  }

  // ── getAllTasks ──────────────────────────────────────────────────────

  /**
   * @param {object} [filter]
   * @param {string} [filter.project]  restrict to one project
   * @param {number} [filter.since]    epoch ms — only tasks with lastSeen >= since
   * @returns {Array<{ taskId: string, project: string, totalCostCents: number, requests: number, lastSeen: number }>}
   */
  function getAllTasks({ project, since } = {}) {
    try {
      const out = [];
      for (const [, t] of taskMap) {
        if (!isAlive(t)) continue;
        if (typeof project === "string" && t.project !== project) continue;
        if (typeof since === "number" && t.lastSeen < since) continue;
        out.push({
          taskId: t.taskId,
          project: t.project,
          totalCostCents: t.totalCostCents,
          requests: t.requests,
          promptTokens: t.promptTokens,
          completionTokens: t.completionTokens,
          firstSeen: t.firstSeen,
          lastSeen: t.lastSeen,
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  // ── getAllProjects ───────────────────────────────────────────────────

  /**
   * @param {object} [filter]
   * @param {number} [filter.since]  epoch ms — only projects with lastSeen >= since
   * @returns {Array<{ project: string, totalCostCents: number, requests: number, tasks: number, lastSeen: number }>}
   */
  function getAllProjects({ since } = {}) {
    try {
      const out = [];
      for (const [, p] of projectMap) {
        if (!isAlive(p)) continue;
        if (typeof since === "number" && p.lastSeen < since) continue;
        out.push({
          project: p.project,
          totalCostCents: p.totalCostCents,
          requests: p.requests,
          tasks: p.tasks.size,
          byModel: { ...p.byModel },
          firstSeen: p.firstSeen,
          lastSeen: p.lastSeen,
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  // ── exportReport ─────────────────────────────────────────────────────

  /**
   * Export a report as JSON or CSV.
   *
   * @param {object} [opts]
   * @param {'json'|'csv'} [opts.format='json']
   * @param {number} [opts.since]    epoch ms filter
   * @param {string} [opts.project]  restrict to one project
   * @returns {string}
   */
  function exportReport({ format = "json", since, project } = {}) {
    try {
      const tasks = getAllTasks({ since, project });

      if (format === "csv") {
        const header = "taskId,project,model,totalCostCents,requests,promptTokens,completionTokens,firstSeen,lastSeen";
        const rows = [];
        for (const t of tasks) {
          // Expand by-model into one row per model for CSV clarity.
          const full = taskMap.get(t.taskId);
          if (full && full.byModel) {
            for (const [model, m] of Object.entries(full.byModel)) {
              rows.push(
                [
                  csvEscape(t.taskId),
                  csvEscape(t.project),
                  csvEscape(model),
                  m.cost,
                  m.requests,
                  t.promptTokens,
                  t.completionTokens,
                  t.firstSeen,
                  t.lastSeen,
                ].join(","),
              );
            }
          } else {
            rows.push(
              [
                csvEscape(t.taskId),
                csvEscape(t.project),
                "unknown",
                t.totalCostCents,
                t.requests,
                t.promptTokens,
                t.completionTokens,
                t.firstSeen,
                t.lastSeen,
              ].join(","),
            );
          }
        }
        return [header, ...rows].join("\n");
      }

      // Default: JSON
      const projects = getAllProjects({ since }).filter(
        (p) => typeof project !== "string" || !project || p.project === project,
      );
      return JSON.stringify(
        {
          tasks,
          projects,
          generatedAt: (typeof now === "function" ? now() : Date.now()),
        },
        null,
        2,
      );
    } catch {
      return format === "csv" ? "" : "{}";
    }
  }

  // ── stats ────────────────────────────────────────────────────────────

  /**
   * @returns {{ trackedTasks: number, trackedProjects: number, totalCost: number, totalRequests: number }}
   */
  function stats() {
    try {
      let aliveTasks = 0;
      for (const [, t] of taskMap) if (isAlive(t)) aliveTasks++;
      let aliveProjects = 0;
      for (const [, p] of projectMap) if (isAlive(p)) aliveProjects++;
      return {
        trackedTasks: aliveTasks,
        trackedProjects: aliveProjects,
        totalCost,
        totalRequests,
      };
    } catch {
      return { trackedTasks: 0, trackedProjects: 0, totalCost: 0, totalRequests: 0 };
    }
  }

  return { track, getTaskCost, getProjectCost, getAllTasks, getAllProjects, exportReport, stats };
}

// ── CSV helper ───────────────────────────────────────────────────────────────

/**
 * Escape a value for CSV: wrap in quotes if it contains commas, quotes, or
 * newlines; double any internal quotes.
 * @param {*} val
 * @returns {string}
 */
function csvEscape(val) {
  if (val == null) return "";
  const s = String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
