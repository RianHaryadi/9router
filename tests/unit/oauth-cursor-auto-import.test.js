import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

// The route reads the Cursor SQLite db with a CJS `require("better-sqlite3")`.
// A CJS require bypasses the vitest mock registry, so the native module CANNOT
// be mocked here — the test therefore writes a REAL Cursor db into a temp home
// and lets the route read it for real. Everything else is the real filesystem.
let HOME = "";
let execFileMock = vi.fn();

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    default: { ...actual.default, homedir: () => HOME },
    homedir: () => HOME,
  };
});

// The sqlite3 CLI fallback is the second strategy: it is unavailable by
// default here, so the native path is the one under test.
vi.mock("child_process", () => ({
  execFile: (...args) => execFileMock(...args),
}));

let GET;

/** Write a real Cursor state.vscdb with the given itemTable rows. */
function writeCursorDb(rows) {
  const dir = path.join(HOME, "Library/Application Support/Cursor/User/globalStorage");
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "state.vscdb");
  const db = new Database(dbPath);
  db.exec("CREATE TABLE IF NOT EXISTS itemTable (key TEXT PRIMARY KEY, value TEXT)");
  const insert = db.prepare("INSERT OR REPLACE INTO itemTable (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(rows)) insert.run(key, value);
  db.close();
  return dbPath;
}

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    HOME = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-auto-import-"));
    execFileMock = vi.fn((_file, _args, _opts, cb) =>
      cb(new Error("ENOENT: sqlite3 not found")),
    );
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    const mod = await import("../../src/app/api/oauth/cursor/auto-import/route.js");
    GET = mod.GET;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    fs.rmSync(HOME, { recursive: true, force: true });
  });

  // ── path probing ──────────────────────────────────────────────────────

  it("returns not-found when no macOS cursor db paths are accessible", async () => {
    const response = await GET();
    const body = await response.json();

    expect(body.found).toBe(false);
    // The route reports every path it probed, so the user can see where it
    // looked.
    expect(body.error).toContain("Cursor database not found");
    expect(body.error).toContain("Checked locations:");
    expect(body.error).toContain(
      path.join(HOME, "Library/Application Support/Cursor/User/globalStorage/state.vscdb"),
    );
  });

  it("falls back to the manual import when the db yields no tokens", async () => {
    writeCursorDb({ "cursorAuth/accessToken": "only-a-token" });

    const response = await GET();
    const body = await response.json();

    expect(body.found).toBe(false);
    // No machine id, so no usable credentials: the caller pastes them by hand.
    expect(body.windowsManual).toBe(true);
    expect(body.dbPath).toContain("state.vscdb");
  });

  // ── token extraction ──────────────────────────────────────────────────

  it("extracts tokens using exact keys", async () => {
    writeCursorDb({
      "cursorAuth/accessToken": "test-token",
      "storage.serviceMachineId": "test-machine-id",
    });

    const response = await GET();
    const body = await response.json();

    expect(body.found).toBe(true);
    expect(body.accessToken).toBe("test-token");
    expect(body.machineId).toBe("test-machine-id");
  });

  it("unwraps JSON-encoded string values", async () => {
    writeCursorDb({
      "cursorAuth/accessToken": '"json-token"',
      "storage.serviceMachineId": '"json-machine-id"',
    });

    const response = await GET();
    const body = await response.json();

    expect(body.found).toBe(true);
    expect(body.accessToken).toBe("json-token");
    expect(body.machineId).toBe("json-machine-id");
  });

  it("accepts the alternate exact keys", async () => {
    writeCursorDb({
      "cursorAuth/token": "alt-token",
      "storage.machineId": "alt-machine",
    });

    const response = await GET();
    const body = await response.json();

    expect(body.found).toBe(true);
    expect(body.accessToken).toBe("alt-token");
    expect(body.machineId).toBe("alt-machine");
  });

  it("does not fall back to a fuzzy key match", async () => {
    // A LIKE-style fuzzy query would return this row. The route only ever
    // asks for the EXACT keys, so nothing is found.
    writeCursorDb({
      "cursorAuth/someOtherAccessTokenKey": "fallback-token",
      "storage.serviceMachineId": "fallback-machine",
    });

    const response = await GET();
    const body = await response.json();

    expect(body.found).toBe(false);
    expect(body.windowsManual).toBe(true);
  });

  // ── linux: the route probes the paths AND checks that Cursor is installed ──

  it("linux probes the linux paths and reports where it looked", async () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });

    const response = await GET();
    const body = await response.json();

    expect(body.found).toBe(false);
    expect(body.error).toContain("Cursor database not found");
    expect(body.error).toContain(
      path.join(HOME, ".config/Cursor/User/globalStorage/state.vscdb"),
    );
  });

  it("linux skips the import when the config exists but Cursor is not installed", async () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    const dir = path.join(HOME, ".config/Cursor/User/globalStorage");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "state.vscdb"), "");
    // `which cursor` fails and the desktop file is missing.
    execFileMock = vi.fn((_file, _args, _opts, cb) => cb(new Error("not found")));

    const response = await GET();
    const body = await response.json();

    expect(body.found).toBe(false);
    expect(body.error).toContain("does not appear to be installed");
  });

  it("unsupported platform falls back to the generic paths instead of failing", async () => {
    Object.defineProperty(process, "platform", { value: "freebsd", writable: true });

    const response = await GET();
    const body = await response.json();

    // The route has no dedicated "unsupported platform" branch: it probes the
    // generic (linux-style) paths and reports what it found.
    expect(response.status).toBe(200);
    expect(body.found).toBe(false);
    expect(body.error).toContain("Cursor database not found");
  });
});
