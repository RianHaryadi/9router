// The dashboard areas a teammate may be granted.
//
// A member's access is a SET OF AREAS. The owner ticks the areas in the
// dashboard; the guard checks the area of the page/API being requested. This
// is deliberately coarse: an area is a capability ("can use the chat", "can
// see the usage numbers"), not a URL — so a new page added later does not
// silently become reachable.
//
// "basic-chat" is always granted: it is the member's reason to exist.
//
// ponytail: the areas are a fixed list, not a permission table. Add an area
// by adding it here and to the OWNER_AREA_FOR_PATH map — nothing else
// changes.
export const MEMBER_AREAS = [
  { id: "basic-chat", label: "Basic Chat", hint: "Chat with the models their key allows. Always granted." },
  { id: "usage", label: "Usage & Stats", hint: "Read the usage numbers (no keys, no provider credentials)." },
  { id: "combos", label: "Combos", hint: "Open the Combos page and manage your own combos." },
  { id: "prompts", label: "Prompt Library", hint: "Open the Prompt Library and the template list." },
  { id: "health", label: "Health & Spend", hint: "Open Health & Spend — provider health, latency and spend per project." },
  { id: "quota", label: "Quota Tracker", hint: "Open the Quota Tracker — the provider quota limits." },
  { id: "providers", label: "Providers (read-only)", hint: "Open the Providers page — names only, never an account identity." },
  { id: "endpoint", label: "Endpoint & Keys", hint: "Open the Endpoint page and the key list. A key VALUE is never shown." },
];

export const MEMBER_AREA_IDS = MEMBER_AREAS.map((a) => a.id);

// The areas every member gets, whatever the owner ticked.
export const MEMBER_BASE_AREAS = ["basic-chat"];

// Endpoints every member may read, whatever areas the owner granted. The
// chat page needs the provider and combo lists to fill its model picker.
// These two answers are already filtered down to the member's own key
// allow-list, so they expose nothing the member may not use.
export const MEMBER_BASE_API_PATHS = [
  "/api/providers",
  "/api/combos",
  "/api/models",
];

// Dashboard page prefix → area. A member without the area is redirected to
// the first area they do have (Basic Chat).
export const OWNER_AREA_FOR_PATH = {
  "/dashboard/basic-chat": "basic-chat",
  "/dashboard/usage": "usage",
  "/dashboard/combos": "combos",
  "/dashboard/prompts": "prompts",
  "/dashboard/health": "health",
  "/dashboard/quota": "quota",
  "/dashboard/providers": "providers",
  "/dashboard/endpoint": "endpoint",
  "/dashboard/media-providers": "combos",
  "/dashboard/token-saver": "usage",
  "/dashboard/console-log": "usage",
  "/dashboard/translator": "combos",
  "/dashboard/cli-tools": "endpoint",
  "/dashboard/proxy-pools": "providers",
  "/dashboard/skills": "combos",
  "/dashboard/profile": "endpoint",
  "/dashboard/mitm": "endpoint",
  "/dashboard/pxpipe": "combos",
};

// API path prefix → area. The read endpoints a member's page needs are
// covered by its area; everything else stays owner-only.
export const API_AREA_FOR_PATH = {
  "/api/dashboard/chat": "basic-chat",
  "/api/combos": "combos",
  "/api/combos/presets": "combos",
  "/api/models": "combos",
  "/api/models/alias": "combos",
  "/api/models/custom": "combos",
  "/api/prompt-templates": "prompts",
  "/api/usage": "usage",
  "/api/health/matrix": "health",
  "/api/health/breaker": "health",
  "/api/providers": "providers",
  "/api/provider-nodes": "providers",
  "/api/proxy-pools": "providers",
  "/api/keys": "endpoint",
  "/api/tunnel/status": "endpoint",
  "/api/translator": "combos",
  "/api/team": "endpoint",
  // /api/settings is deliberately NOT mapped: it carries the deployment
  // settings (proxy, headers, feature flags) and is owner-only for every
  // area. A member never reads it.
};

/** Sidebar nav entry → area. */
export const AREA_FOR_NAV = {
  "/dashboard/basic-chat": "basic-chat",
  "/dashboard/usage": "usage",
  "/dashboard/health": "health",
  "/dashboard/quota": "quota",
  "/dashboard/combos": "combos",
  "/dashboard/prompts": "prompts",
  "/dashboard/providers": "providers",
  "/dashboard/endpoint": "endpoint",
};

/**
 * The areas a member holds.
 * @param {object|null} session
 * @returns {Set<string>}
 */
export function memberAreasOf(session) {
  const granted = Array.isArray(session?.areas) ? session.areas : [];
  const out = new Set(MEMBER_BASE_AREAS);
  for (const id of granted) {
    if (MEMBER_AREA_IDS.includes(id)) out.add(id);
  }
  return out;
}
