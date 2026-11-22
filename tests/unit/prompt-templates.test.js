import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-prompts-"));
  process.env.DATA_DIR = dir;
  delete global._dbAdapter;
  vi.resetModules();
});
afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("prompt templates", () => {
  it("creates templates and immutable numbered revisions; updates current content", async () => {
    const db = await import(new URL("../../src/lib/db/index.js", import.meta.url));
    const created = await db.createPromptTemplate({ name: "Review", content: "v1", description: "code" });
    expect(created).toMatchObject({ name: "Review", content: "v1", version: 1 });
    const updated = await db.updatePromptTemplate(created.id, { content: "v2" });
    expect(updated).toMatchObject({ content: "v2", version: 2 });
    expect(await db.getPromptTemplateVersions(created.id)).toMatchObject([
      { version: 1, content: "v1" }, { version: 2, content: "v2" },
    ]);
  });
  it("rejects empty required fields and preserves history when deleting template", async () => {
    const db = await import(new URL("../../src/lib/db/index.js", import.meta.url));
    await expect(db.createPromptTemplate({ name: " ", content: "x" })).rejects.toThrow();
    const row = await db.createPromptTemplate({ name: "Keep history", content: "text" });
    expect(await db.deletePromptTemplate(row.id)).toBe(true);
    expect(await db.getPromptTemplateVersions(row.id)).toHaveLength(1);
    expect(await db.getPromptTemplateById(row.id)).toBeNull();
  });
});
