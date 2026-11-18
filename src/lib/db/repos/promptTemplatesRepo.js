import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

/**
 * True when the caller may write the row with this owner id.
 *
 * The owner writes every row; a teammate writes only the rows they own.
 * @param {string|null} ownerId
 * @param {{ isOwner: boolean, memberId: string|null }} caller
 */
function mayWrite(ownerId, caller) {
  if (caller?.isOwner) return true;
  return !!caller?.memberId && (ownerId || null) === caller.memberId;
}

function valid(data) {
  if (!data || typeof data.name !== "string" || !data.name.trim() || typeof data.content !== "string" || !data.content.trim()) {
    throw new TypeError("Name and content are required");
  }
}

function template(row) {
  if (!row) return null;
  return { ...row, version: Number(row.version), ownerId: row.ownerId || null };
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
  const row = { id: uuidv4(), name: data.name.trim(), description: typeof data.description === "string" ? data.description : "", content: data.content, version: 1, ownerId: data.ownerId || null, createdAt: now, updatedAt: now };
  db.transaction(() => {
    db.run("INSERT INTO promptTemplates(id,name,description,content,version,ownerId,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)", [row.id,row.name,row.description,row.content,row.version,row.ownerId,now,now]);
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

/**
 * Update a template only when the caller may write it.
 *
 * The owner updates any template; a teammate updates only the templates they
 * own. See combosRepo.updateComboOwnedBy for the same rule.
 *
 * @param {string} id
 * @param {object} data
 * @param {{ isOwner: boolean, memberId: string|null }} caller
 */
export async function updatePromptTemplateOwnedBy(id, data, caller) {
  const db = await getAdapter();
  const row = db.get("SELECT ownerId FROM promptTemplates WHERE id = ?", [id]);
  if (!row) return null;
  if (!mayWrite(row.ownerId, caller)) return null;
  return await updatePromptTemplate(id, data);
}

/**
 * Delete a template only when the caller may write it.
 * @see updatePromptTemplateOwnedBy
 */
export async function deletePromptTemplateOwnedBy(id, caller) {
  const db = await getAdapter();
  const row = db.get("SELECT ownerId FROM promptTemplates WHERE id = ?", [id]);
  if (!row) return false;
  if (!mayWrite(row.ownerId, caller)) return false;
  return await deletePromptTemplate(id);
}
