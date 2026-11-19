// Benchmark: the SQLite-backed DB layer on the workloads the old lowdb store
// used to serve.
//
// The original benchmark compared SQLite against lowdb, but lowdb was removed
// from package.json in the very commit that added this file (bee8dad9), so the
// comparison half could never run. The benchmark now measures the SQLite layer
// against a plain in-memory JSON store — the same "read the whole file, filter
// in JS" shape lowdb had — so the numbers stay comparable to the old output.
//
// Run: cd tests && npx vitest run unit/db-benchmark.test.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, beforeAll, afterAll, vi } from "vitest";

const N_ITEMS = 500;
const N_QUERIES = 200;

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let sqliteDb;

function fmt(ms) { return `${ms.toFixed(2)}ms`; }

async function bench(label, fn) {
  // warmup
  await fn();
  const t0 = performance.now();
  await fn();
  const dt = performance.now() - t0;
  console.log(`  ${label.padEnd(40)} ${fmt(dt)}`);
  return dt;
}

/**
 * The lowdb-shaped store: one JSON document on disk, rewritten on every write,
 * and read into memory before every query.
 */
function createJsonStore(file) {
  let data = { providerConnections: [], usageHistory: [] };
  return {
    async read() { data = JSON.parse(fs.readFileSync(file, "utf-8")); },
    async write() { fs.writeFileSync(file, JSON.stringify(data)); },
    get data() { return data; },
  };
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-bench-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  sqliteDb = await import("@/lib/db/index.js");
  await sqliteDb.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("DB Benchmark — SQLite vs JSON document store", () => {
  it(`INSERT ${N_ITEMS} provider connections`, async () => {
    console.log(`\n[INSERT ${N_ITEMS}]`);

    const sqliteTime = await bench("SQLite createProviderConnection", async () => {
      for (let i = 0; i < N_ITEMS; i++) {
        await sqliteDb.createProviderConnection({
          provider: `bench-p${i % 5}`, authType: "apikey",
          name: `name-${i}`, apiKey: `k-${i}`,
        });
      }
    });

    const jsonFile = path.join(tempDir, "bench-connections.json");
    fs.writeFileSync(jsonFile, JSON.stringify({ providerConnections: [], usageHistory: [] }));
    const jsonStore = createJsonStore(jsonFile);

    const jsonTime = await bench("JSON push + write", async () => {
      for (let i = 0; i < N_ITEMS; i++) {
        jsonStore.data.providerConnections.push({
          id: `id-${i}`, provider: `bench-p${i % 5}`, authType: "apikey",
          name: `name-${i}`, apiKey: `k-${i}`, priority: i + 1, isActive: true,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
        await jsonStore.write();
      }
    });

    console.log(`  → SQLite is ${(jsonTime / sqliteTime).toFixed(2)}x faster`);
  }, 60000);

  it(`READ ${N_QUERIES} filtered queries`, async () => {
    console.log(`\n[READ ${N_QUERIES} filtered queries]`);

    const sqliteTime = await bench("SQLite getProviderConnections(filter)", async () => {
      for (let i = 0; i < N_QUERIES; i++) {
        await sqliteDb.getProviderConnections({ provider: `bench-p${i % 5}` });
      }
    });

    const jsonFile = path.join(tempDir, "bench-read.json");
    fs.writeFileSync(jsonFile, JSON.stringify({
      providerConnections: Array.from({ length: N_ITEMS }, (_, i) => ({
        id: `id-${i}`, provider: `bench-p${i % 5}`, authType: "apikey",
        name: `name-${i}`, apiKey: `k-${i}`, priority: i + 1, isActive: true,
      })),
      usageHistory: [],
    }));
    const jsonStore = createJsonStore(jsonFile);

    const jsonTime = await bench("JSON read + filter", async () => {
      for (let i = 0; i < N_QUERIES; i++) {
        await jsonStore.read();
        jsonStore.data.providerConnections.filter((c) => c.provider === `bench-p${i % 5}`);
      }
    });

    console.log(`  → SQLite is ${(jsonTime / sqliteTime).toFixed(2)}x faster`);
  }, 60000);

  it(`READ ${N_QUERIES} by id (point lookup)`, async () => {
    console.log(`\n[READ ${N_QUERIES} by id]`);

    const sqliteAll = await sqliteDb.getProviderConnections();
    const ids = sqliteAll.slice(0, N_QUERIES).map((c) => c.id);

    const sqliteTime = await bench("SQLite getProviderConnectionById", async () => {
      for (const id of ids) await sqliteDb.getProviderConnectionById(id);
    });

    const jsonFile = path.join(tempDir, "bench-byid.json");
    fs.writeFileSync(jsonFile, JSON.stringify({
      providerConnections: Array.from({ length: N_ITEMS }, (_, i) => ({
        id: `id-${i}`, provider: `bench-p${i % 5}`, authType: "apikey",
        name: `name-${i}`, apiKey: `k-${i}`, priority: i + 1, isActive: true,
      })),
      usageHistory: [],
    }));
    const jsonStore = createJsonStore(jsonFile);

    const jsonTime = await bench("JSON find by id", async () => {
      for (const id of ids) {
        await jsonStore.read();
        jsonStore.data.providerConnections.find((c) => c.id === id);
      }
    });

    console.log(`  → SQLite is ${(jsonTime / sqliteTime).toFixed(2)}x faster`);
  }, 60000);

  it(`saveRequestUsage ${N_ITEMS} entries`, async () => {
    console.log(`\n[saveRequestUsage ${N_ITEMS}]`);

    const sqliteTime = await bench("SQLite saveRequestUsage", async () => {
      for (let i = 0; i < N_ITEMS; i++) {
        await sqliteDb.saveRequestUsage({
          provider: "openai", model: `m-${i % 10}`, connectionId: `c-${i % 5}`,
          tokens: { prompt_tokens: 100 + i, completion_tokens: 50 + i },
          endpoint: "/v1/chat/completions", status: "ok",
        });
      }
    });

    const jsonFile = path.join(tempDir, "bench-usage.json");
    fs.writeFileSync(jsonFile, JSON.stringify({ providerConnections: [], usageHistory: [] }));
    const jsonStore = createJsonStore(jsonFile);

    const jsonTime = await bench("JSON push history + write", async () => {
      jsonStore.data.usageHistory = [];
      for (let i = 0; i < N_ITEMS; i++) {
        jsonStore.data.usageHistory.push({
          timestamp: new Date().toISOString(), provider: "openai", model: `m-${i % 10}`,
          connectionId: `c-${i % 5}`, tokens: { prompt_tokens: 100 + i, completion_tokens: 50 + i },
          endpoint: "/v1/chat/completions", status: "ok", cost: 0,
        });
        await jsonStore.write();
      }
    });

    console.log(`  → SQLite is ${(jsonTime / sqliteTime).toFixed(2)}x faster`);
  }, 120000);

  it(`getUsageStats(24h) repeat 50x`, async () => {
    console.log(`\n[getUsageStats(24h) x 50]`);

    const sqliteTime = await bench("SQLite getUsageStats(24h)", async () => {
      for (let i = 0; i < 50; i++) await sqliteDb.getUsageStats("24h");
    });

    const jsonFile = path.join(tempDir, "bench-stats.json");
    fs.writeFileSync(jsonFile, JSON.stringify({
      providerConnections: [],
      usageHistory: Array.from({ length: N_ITEMS }, (_, i) => ({
        timestamp: new Date().toISOString(), provider: "openai", model: `m-${i % 10}`,
        connectionId: `c-${i % 5}`, tokens: { prompt_tokens: 100 + i, completion_tokens: 50 + i },
        endpoint: "/v1/chat/completions", status: "ok", cost: 0,
      })),
    }));
    const jsonStore = createJsonStore(jsonFile);

    const jsonTime = await bench("JSON read + aggregate", async () => {
      for (let i = 0; i < 50; i++) {
        await jsonStore.read();
        const cutoff = Date.now() - 86400000;
        const hist = jsonStore.data.usageHistory.filter((h) => new Date(h.timestamp).getTime() >= cutoff);
        const stats = { byProvider: {}, byModel: {} };
        for (const e of hist) {
          if (!stats.byProvider[e.provider]) stats.byProvider[e.provider] = { requests: 0 };
          stats.byProvider[e.provider].requests++;
        }
      }
    });

    console.log(`  → SQLite is ${(jsonTime / sqliteTime).toFixed(2)}x faster`);
  }, 60000);
});
