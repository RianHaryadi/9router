// Dashboard users: the owner (settings.password) plus teammates who log in
// with their own password and may only use Basic Chat.
//
// The owner's account is NOT a row here — it stays settings.password, so an
// existing install keeps working unchanged. A row here is always a "member":
// a teammate with their own password and their own API key.
//
// Members never receive a key value. Their chat requests are billed to the
// key referenced by apiKeyRef, and the key's own allow-list / budget / rate
// limits still apply — the member can only ever reach what that key allows.
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { getAdapter } from "../driver.js";

export const ROLE_OWNER = "owner";
export const ROLE_MEMBER = "member";

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    // The hash never leaves the server.
    role: row.role === ROLE_OWNER ? ROLE_OWNER : ROLE_MEMBER,
    isActive: row.isActive === 1 || row.isActive === true,
    displayName: row.displayName || row.username,
    apiKeyRef: row.apiKeyRef || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getDashboardUsers() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM dashboardUsers ORDER BY createdAt ASC`).map(rowToUser);
}

export async function getDashboardUserByUsername(username) {
  if (!username) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM dashboardUsers WHERE username = ?`, [String(username).trim().toLowerCase()]);
  return rowToUser(row);
}

export async function getDashboardUserById(id) {
  if (!id) return null;
  const db = await getAdapter();
  return rowToUser(db.get(`SELECT * FROM dashboardUsers WHERE id = ?`, [id]));
}

/**
 * Create a teammate account.
 * @param {{username: string, password: string, displayName?: string, apiKeyRef?: string}} data
 */
export async function createDashboardUser(data = {}) {
  const username = String(data.username || "").trim().toLowerCase();
  if (!username) throw new Error("username is required");
  if (!data.password || String(data.password).length < 6) {
    throw new Error("password must be at least 6 characters");
  }
  const db = await getAdapter();
  const existing = db.get(`SELECT id FROM dashboardUsers WHERE username = ?`, [username]);
  if (existing) throw new Error(`user "${username}" already exists`);

  const now = new Date().toISOString();
  const user = {
    id: uuidv4(),
    username,
    passwordHash: await bcrypt.hash(String(data.password), 10),
    role: ROLE_MEMBER,
    isActive: true,
    displayName: data.displayName || username,
    apiKeyRef: data.apiKeyRef || null,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO dashboardUsers(id, username, passwordHash, role, isActive, displayName, apiKeyRef, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [user.id, user.username, user.passwordHash, user.role, 1, user.displayName, user.apiKeyRef, user.createdAt, user.updatedAt]
  );
  return rowToUser(user);
}

export async function updateDashboardUser(id, data = {}) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM dashboardUsers WHERE id = ?`, [id]);
  if (!row) return null;
  const existing = rowToUser(row);

  const next = { ...existing };
  if (data.username !== undefined) {
    const username = String(data.username).trim().toLowerCase();
    if (!username) throw new Error("username cannot be empty");
    const clash = db.get(`SELECT id FROM dashboardUsers WHERE username = ? AND id != ?`, [username, id]);
    if (clash) throw new Error(`user "${username}" already exists`);
    next.username = username;
  }
  if (data.displayName !== undefined) next.displayName = data.displayName;
  if (data.apiKeyRef !== undefined) next.apiKeyRef = data.apiKeyRef;
  if (data.isActive !== undefined) next.isActive = data.isActive === true;
  next.updatedAt = new Date().toISOString();

  const passwordHash = data.password
    ? await bcrypt.hash(String(data.password), 10)
    : row.passwordHash;

  db.run(
    `UPDATE dashboardUsers SET username = ?, displayName = ?, apiKeyRef = ?, isActive = ?, passwordHash = ?, updatedAt = ? WHERE id = ?`,
    [next.username, next.displayName, next.apiKeyRef, next.isActive ? 1 : 0, passwordHash, next.updatedAt, id]
  );
  return rowToUser(db.get(`SELECT * FROM dashboardUsers WHERE id = ?`, [id]));
}

export async function deleteDashboardUser(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM dashboardUsers WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

/** Verify a member's password. Fails closed on any DB error. */
export async function verifyDashboardUserPassword(username, password) {
  if (!username || !password) return null;
  try {
    const db = await getAdapter();
    const row = db.get(`SELECT * FROM dashboardUsers WHERE username = ?`, [
      String(username).trim().toLowerCase(),
    ]);
    if (!row) return null;
    if (!(row.isActive === 1 || row.isActive === true)) return null;
    const ok = await bcrypt.compare(String(password), row.passwordHash);
    return ok ? rowToUser(row) : null;
  } catch {
    return null;
  }
}

/**
 * The API key a member's chat requests are billed to (raw value, server-side only).
 *
 * The user's key reference is read from the DB on every request (not from the
 * session cookie) so the owner can reassign a member's key without the
 * teammate having to log in again.
 */
export async function getDashboardUserApiKey(user) {
  const userId = user?.id || user?.userId || null;
  if (!userId) return null;
  try {
    const db = await getAdapter();
    const row = db.get(`SELECT apiKeyRef FROM dashboardUsers WHERE id = ? AND isActive = 1`, [userId]);
    const ref = row?.apiKeyRef || user?.apiKeyRef || null;
    if (!ref) return null;
    const keyRow = db.get(`SELECT key FROM apiKeys WHERE keyRef = ? AND isActive = 1`, [ref]);
    return keyRow?.key || null;
  } catch {
    return null;
  }
}
