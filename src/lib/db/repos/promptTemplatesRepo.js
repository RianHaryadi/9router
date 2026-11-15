import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function valid(data) {
  if (!data || typeof data.name !== "string" || !data.name.trim() || typeof data.content !== "string" || !data.content.trim()) {
    throw new TypeError("Name and content are required");
  }
}

function template(row) {
  return row ? { ...row, version: Number(row.version) } : null;
}

export async function getPromptTemplates() {
  const db = await getAdapter();
  return db.all("SELECT * FROM promptTemplates ORDER BY updatedAt DESC").map(template);
}
export async function getPromptTemplateById(id) {
  const db = await getAdapter();
  return template(db.get("SELECT * FROM promptTemplates WHERE id = ?", [id]));
}
export async function getPromptTemplateVersions(id) {
  const db = await getAdapter();
  return db.all("SELECT templateId, version, name, description, content, createdAt FROM promptTemplateVersions WHERE templateId = ? ORDER BY version ASC", [id]).map(template);
}
export async function createPromptTemplate(data) {
  valid(data);
  const db = await getAdapter();
  const now = new Date().toISOString();
  const row = { id: uuidv4(), name: data.name.trim(), description: typeof data.description === "string" ? data.description : "", content: data.content, version: 1, createdAt: now, updatedAt: now };
  db.transaction(() => {
    db.run("INSERT INTO promptTemplates(id,name,description,content,version,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)", [row.id,row.name,row.description,row.content,row.version,now,now]);
    db.run("INSERT INTO promptTemplateVersions(templateId,version,name,description,content,createdAt) VALUES(?,?,?,?,?,?)", [row.id,row.version,row.name,row.description,row.content,now]);
  });
  return row;
}
export async function updatePromptTemplate(id, data) {
  const db = await getAdapter();
  let updated = null;
  db.transaction(() => {
    const current = db.get("SELECT * FROM promptTemplates WHERE id = ?", [id]);
    if (!current) return;
    valid({ name: data?.name ?? current.name, content: data?.content ?? current.content });
    if (data?.description !== undefined && typeof data.description !== "string") throw new TypeError("Description must be a string");
    const now = new Date().toISOString();
    updated = { ...current, name: data.name === undefined ? current.name : data.name.trim(), description: data.description === undefined ? current.description : data.description, content: data.content === undefined ? current.content : data.content, version: current.version + 1, updatedAt: now };
    db.run("UPDATE promptTemplates SET name=?,description=?,content=?,version=?,updatedAt=? WHERE id=?", [updated.name,updated.description,updated.content,updated.version,now,id]);
    db.run("INSERT INTO promptTemplateVersions(templateId,version,name,description,content,createdAt) VALUES(?,?,?,?,?,?)", [id,updated.version,updated.name,updated.description,updated.content,now]);
  });
  return template(updated);
}
export async function deletePromptTemplate(id) {
  const db = await getAdapter();
  return (db.run("DELETE FROM promptTemplates WHERE id = ?", [id])?.changes ?? 0) > 0;
}
