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
  { id: "prompts", label: "Prompt Library", hint: "Open the Prompt Library and manage your own templates." },
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

// The member-owned writes a teammate may perform.
//
// A member owns the objects they created (their combos, their prompt
// templates) and may edit or delete those. The objects the owner created are
// READ-ONLY for a member: the ownership check happens in the route, where
// the row is loaded and compared.
//
// Matched exactly for the collection path and by prefix for the item path,
// so a sibling sub-route (e.g. /api/combos/presets, which creates MANY
// combos at once) is never opened by accident.
export const MEMBER_WRITE_SCOPES = [
  { area: "combos", method: "POST", path: "/api/combos" },
  { area: "combos", method: "PUT", item: "/api/combos/" },
  { area: "combos", method: "DELETE", item: "/api/combos/" },
  { area: "prompts", method: "POST", path: "/api/prompt-templates" },
  { area: "prompts", method: "PATCH", item: "/api/prompt-templates/" },
  { area: "prompts", method: "DELETE", item: "/api/prompt-templates/" },
];

/**
 * The write scope a request falls into, or null when it is not a
 * member-owned write.
 *
 * An `item` scope matches the item route only: exactly one path segment
 * below the collection. A sub-route (e.g. /api/prompt-templates/x/versions)
 * is a different route and is never matched by the item scope.
 */
export function memberWriteScopeFor(method, pathname) {
  const verb = String(method || "").toUpperCase();
  for (const scope of MEMBER_WRITE_SCOPES) {
    if (scope.method !== verb) continue;
    if (scope.path && pathname === scope.path) return scope;
    if (scope.item && pathname.startsWith(scope.item)) {
      const id = pathname.slice(scope.item.length);
      if (id && !id.includes("/")) return scope;
    }
  }
  return null;
}

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

/**
 * The id of the member a session belongs to, or null for the owner.
 *
 * A key sign-in has no member row, so it has no id: it may read the areas it
 * was granted but owns nothing.
 */
export function ownerIdOfSession(session) {
  return session?.userId || null;
}
