// Team members: teammates who sign in to the dashboard with a PASSWORD the
// owner chose for them.
//
// The member's identity is the password (plus the member row it belongs to) —
// not an API key. The key that bills their requests stays server-side, so a
// leaked member password grants chat access and nothing else: it cannot be
// replayed against /v1 as a bearer token.
//
// The owner's own account is NOT a row here — it stays settings.password, so
// an existing install logs in exactly as before.
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { getAdapter } from "../driver.js";
import { MEMBER_AREA_IDS } from "@/shared/constants/memberAreas.js";

/** Keep only known area ids; an empty list means chat-only access. */
function normalizeAreas(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  for (const id of list) {
    if (typeof id !== "string") continue;
    const area = id.trim();
    if (!MEMBER_AREA_IDS.includes(area)) continue;
    seen.add(area);
  }
  return [...seen];
}

function parseAreas(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToMember(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    // The hash never leaves the server.
    role: "member",
    isActive: row.isActive === 1 || row.isActive === true,
    apiKeyRef: row.apiKeyRef || null,
    // Alias: the session claim is called keyRef everywhere.
    keyRef: row.apiKeyRef || null,
    // The dashboard areas this member may reach.
    areas: normalizeAreas(parseAreas(row.areas)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getTeamMembers() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM teamMembers ORDER BY createdAt ASC`).map(rowToMember);
}

export async function getTeamMemberById(id) {
  if (!id) return null;
  const db = await getAdapter();
  return rowToMember(db.get(`SELECT * FROM teamMembers WHERE id = ?`, [id]));
}

/**
 * Create a teammate.
 *
 * @param {{name: string, password: string, apiKeyRef?: string}} data
 */
export async function createTeamMember(data = {}) {
  const name = String(data.name || "").trim();
  if (!name) throw new Error("name is required");
  if (!data.password || String(data.password).length < 4) {
    throw new Error("password must be at least 4 characters");
  }
  const db = await getAdapter();
  const now = new Date().toISOString();
  const areas = normalizeAreas(data.areas);
  const member = {
    id: uuidv4(),
    name,
    passwordHash: await bcrypt.hash(String(data.password), 10),
    apiKeyRef: data.apiKeyRef || null,
    areas: JSON.stringify(areas),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO teamMembers(id, name, passwordHash, apiKeyRef, areas, isActive, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, 1, ?, ?)`,
    [member.id, member.name, member.passwordHash, member.apiKeyRef, member.areas, member.createdAt, member.updatedAt]
  );
  return rowToMember(member);
}

export async function updateTeamMember(id, data = {}) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM teamMembers WHERE id = ?`, [id]);
  if (!row) return null;
  const existing = rowToMember(row);

  const next = { ...existing };
  if (data.name !== undefined) {
    const name = String(data.name).trim();
    if (!name) throw new Error("name cannot be empty");
    next.name = name;
  }
  if (data.apiKeyRef !== undefined) next.apiKeyRef = data.apiKeyRef;
  if (data.areas !== undefined) next.areas = normalizeAreas(data.areas);
  if (data.isActive !== undefined) next.isActive = data.isActive === true;
  next.updatedAt = new Date().toISOString();

  const passwordHash = data.password
    ? await bcrypt.hash(String(data.password), 10)
    : row.passwordHash;

  db.run(
    `UPDATE teamMembers SET name = ?, apiKeyRef = ?, areas = ?, isActive = ?, passwordHash = ?, updatedAt = ? WHERE id = ?`,
    [next.name, next.apiKeyRef, JSON.stringify(next.areas), next.isActive ? 1 : 0, passwordHash, next.updatedAt, id]
  );
  return rowToMember(db.get(`SELECT * FROM teamMembers WHERE id = ?`, [id]));
}

export async function deleteTeamMember(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM teamMembers WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

/**
 * Verify a member's password.
 *
 * Every active member's hash is checked, because a teammate only ever types
 * a password — there is no username to narrow the row down. bcrypt's cost
 * makes this expensive enough to resist brute force, and the login limiter
 * caps attempts per IP on top.
 *
 * @returns {Promise<object|null>} the member, or null.
 */
export async function verifyTeamMemberPassword(password) {
  if (!password || typeof password !== "string") return null;
  let rows = [];
  try {
    const db = await getAdapter();
    rows = db.all(`SELECT * FROM teamMembers WHERE isActive = 1`);
  } catch {
    return null;
  }
  for (const row of rows) {
    try {
      if (await bcrypt.compare(password, row.passwordHash)) return rowToMember(row);
    } catch {
      /* a malformed hash must not abort the scan */
    }
  }
  return null;
}

/** The raw API key behind a member's key fingerprint (server-side only). */
export async function getTeamMemberApiKey(member) {
  const ref = member?.apiKeyRef || null;
  if (!ref) return null;
  try {
    const db = await getAdapter();
    const row = db.get(`SELECT key FROM apiKeys WHERE keyRef = ? AND isActive = 1`, [ref]);
    return row?.key || null;
  } catch {
    return null;
  }
}
