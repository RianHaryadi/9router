import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { isLocalRequest } from "@/dashboardGuard";

export const dynamic = "force-dynamic";

// A key is a bearer secret: whoever holds it can call the router with that
// key's allow-list and budget. The full key is therefore only handed out to
// the OWNER on the machine the router runs on; any other (remote) dashboard
// session gets the masked form, so a leaked dashboard password cannot hand
// out every key.
function maskKey(key) {
  if (!key || typeof key !== "string") return key;
  const trimmed = key.trim();
  if (trimmed.length <= 12) return trimmed.charAt(0) + "***";
  return trimmed.slice(0, 8) + "***" + trimmed.slice(-4);
}

// GET /api/keys - List API keys
export async function GET(request) {
  try {
    const keys = await getApiKeys();
    const local = isLocalRequest(request);
    return NextResponse.json({
      keys: local ? keys : keys.map((k) => ({ ...k, key: maskKey(k.key) })),
      masked: !local,
    });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId);

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
