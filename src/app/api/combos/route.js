import { NextResponse } from "next/server";
import { getCombos, createCombo, getComboByName, getApiKeys } from "@/lib/localDb";
import { isMemberSession, getSession } from "@/dashboardGuard";
import { ownerIdOfSession } from "@/shared/constants/memberAreas.js";

export const dynamic = "force-dynamic";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

/**
 * Add the "may I write this?" flag to a combo.
 *
 * The owner may write every combo. A teammate may write only the combos they
 * own. The flag is what the dashboard uses to show the edit/delete actions.
 */
function withWriteFlag(memberId) {
  return (combo) => ({ ...combo, canWrite: memberId === null ? true : combo.ownerId === memberId });
}

// GET /api/combos - Get all combos
export async function GET(request) {
  try {
    const combos = await getCombos();

    // A teammate member only sees the combos their key may call, so the
    // picker cannot offer something the router will refuse.
    if (await isMemberSession(request)) {
      const session = await getSession(request);
      const ref = session?.keyRef || null;
      const memberId = session?.userId || null;
      let allowedNames = null;
      if (ref) {
        try {
          const keys = await getApiKeys();
          const key = keys.find((k) => k.keyRef === ref && k.isActive !== false);
          if (key?.access?.restricted) {
            allowedNames = new Set((key.access.allow || []).map((e) => String(e).toLowerCase()));
          }
        } catch { /* fall through to the full list */ }
      }
      if (allowedNames) {
        // Their OWN combos stay visible even when the key's allow-list does
        // not name them: the teammate manages them here, exactly as the owner
        // does. The router still refuses a call the key may not make.
        const visible = combos.filter(
          (c) => allowedNames.has(String(c.name).toLowerCase()) || (memberId && c.ownerId === memberId)
        );
        return NextResponse.json({ combos: visible.map(withWriteFlag(memberId)) });
      }
      // No restricted key: the member still sees only what they may write,
      // plus the combos their key allows.
      return NextResponse.json({
        combos: combos
          .filter((c) => !memberId || c.ownerId === memberId || c.ownerId === null)
          .map(withWriteFlag(memberId)),
      });
    }

    return NextResponse.json({ combos: combos.map(withWriteFlag(null)) });
  } catch (error) {
    console.log("Error fetching combos:", error);
    return NextResponse.json({ error: "Failed to fetch combos" }, { status: 500 });
  }
}

// POST /api/combos - Create new combo
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, models, kind } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Validate name format
    if (!VALID_NAME_REGEX.test(name)) {
      return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
    }

    // Check if name already exists
    const existing = await getComboByName(name);
    if (existing) {
      return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
    }

    // A teammate creates the combo as their own: the row is bound to their
    // member id, so they may edit or delete it later. The owner creates it
    // with no owner id (owner-owned).
    const ownerId = (await isMemberSession(request)) ? ownerIdOfSession(await getSession(request)) : null;

    const combo = await createCombo({ name, models: models || [], kind: kind || null, ownerId });

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    console.log("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}
