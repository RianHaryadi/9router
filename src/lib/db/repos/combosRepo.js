import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    // NULL = the owner. A member id = that member owns it.
    ownerId: row.ownerId || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getCombos() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
  return rows.map(rowToCombo);
}

export async function getComboById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
  return rowToCombo(row);
}

export async function getComboByName(name) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE name = ?`, [name]);
  return rowToCombo(row);
}

export async function createCombo(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    ownerId: data.ownerId || null,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, ownerId, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.ownerId, combo.createdAt, combo.updatedAt]
  );
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToCombo(row), ...data, updatedAt: new Date().toISOString() };
    // ownerId is set at creation and never moves: a member cannot take over an
    // owner's combo by writing the field.
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.updatedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

/**
 * The caller of a member-owned write.
 *
 * @typedef {{ isOwner: boolean, memberId: string|null }} WriteCaller
 * The owner writes every row. A teammate writes only the rows they own.
 */

/** True when the caller may write the row with this owner id. */
function mayWrite(ownerId, caller) {
  if (caller?.isOwner) return true;
  return !!caller?.memberId && (ownerId || null) === caller.memberId;
}

/**
 * Update a combo only when the caller may write it.
 *
 * The owner updates any combo; a teammate updates only the combos they own.
 * The ownership test happens before the write, so a member that guesses the
 * id of an owner's combo changes nothing.
 *
 * @param {string} id
 * @param {object} data
 * @param {WriteCaller} caller
 * @returns {Promise<object|null>} the updated combo, or null when it does not
 *   exist or is not the caller's.
 */
export async function updateComboOwnedBy(id, data, caller) {
  const db = await getAdapter();
  const row = db.get(`SELECT ownerId FROM combos WHERE id = ?`, [id]);
  if (!row) return null;
  if (!mayWrite(row.ownerId, caller)) return null;
  return await updateCombo(id, data);
}

/**
 * Delete a combo only when the caller may write it.
 * @see updateComboOwnedBy
 */
export async function deleteComboOwnedBy(id, caller) {
  const db = await getAdapter();
  const row = db.get(`SELECT ownerId FROM combos WHERE id = ?`, [id]);
  if (!row) return false;
  if (!mayWrite(row.ownerId, caller)) return false;
  return await deleteCombo(id);
}
