// Create or update a teammate in a RUNNING 9router instance.
//
// A teammate gets:
//   - an API key restricted to the models/combos you name (its allow-list,
//     budget and rate limits are the key's own),
//   - a dashboard member whose password they use to sign in to Basic Chat.
//
// The key value never reaches the teammate: the dashboard injects it
// server-side, so they only ever type their password.
//
// Usage:
//   node scripts/seed-team-member.mjs \
//     --url https://9router.aidonext.com \
//     --password 'OWNER_PASSWORD' \
//     --member '{"name":"andi","password":"...","allow":["Code-Freee"],"budgetCents":null}'
//
// Repeat --member for several teammates. Re-running with the same name
// UPDATES that teammate instead of duplicating them.
//
// Options per member:
//   name          (required) display name
//   password      (required) the password the teammate types
//   allow         array of combos/models the key may call
//   budgetCents   monthly budget in cents; null = unlimited
//   rpm           requests per minute; 0 = unlimited
//   tpm           tokens per minute; 0 = unlimited
//   keyName       name of the generated key (default "<name>-key")

const args = process.argv.slice(2);
let url = process.env.NINEROUTER_URL || "http://localhost:20128";
let ownerPassword = process.env.NINEROUTER_PASSWORD || "";
const members = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--url") { url = args[++i]; continue; }
  if (arg === "--password") { ownerPassword = args[++i]; continue; }
  if (arg === "--member") { members.push(JSON.parse(args[++i])); continue; }
  if (arg.startsWith("--")) { console.error(`Unknown flag: ${arg}`); process.exit(2); }
}
if (!ownerPassword) {
  console.error("Missing --password (the owner dashboard password)");
  process.exit(2);
}
if (!members.length) {
  console.error("Missing --member '{\"name\":...,\"password\":...,\"allow\":[...]}'");
  process.exit(2);
}

async function api(path, init = {}) {
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    redirect: "manual",
  });
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch { /* non-JSON body */ }
  if (!res.ok) {
    throw new Error(`${init.method || "GET"} ${path} → ${res.status} ${body.error || text.slice(0, 200)}`);
  }
  return body;
}

// Owner session. The cookie has to come from the raw response, so this login
// reads the response headers rather than the parsed body.
const rawRes = await fetch(`${url}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: ownerPassword }),
  redirect: "manual",
});
const loginBody = await rawRes.json().catch(() => ({}));
if (loginBody.role !== "owner") {
  console.error(`Owner login failed (role=${loginBody.role})`);
  process.exit(1);
}
const cookie = (rawRes.headers.getSetCookie?.() || [])
  .map((c) => c.split(";")[0])
  .find((c) => c.startsWith("auth_token="));
if (!cookie) {
  console.error("Could not read the owner session cookie");
  process.exit(1);
}
const auth = { cookie };
console.log(`owner session ok (${url})`);

for (const member of members) {
  const name = String(member.name || "").trim();
  if (!name || !member.password) {
    console.error(`[${name || "?"}] name and password are required`);
    continue;
  }
  const allow = Array.isArray(member.allow) ? member.allow : [];
  const budgetCents = member.budgetCents === undefined ? 500 : member.budgetCents;
  const rpm = member.rpm === undefined ? 20 : member.rpm;
  const tpm = member.tpm === undefined ? 60000 : member.tpm;
  const keyName = member.keyName || `${name}-key`;

  // 1) the API key (restricted) — reuse the existing one when the name matches
  const keys = (await api("/api/keys", { headers: auth })).keys || [];
  let key = keys.find((k) => k.name === keyName);
  if (!key) {
    const created = await api("/api/keys", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: keyName }),
    });
    key = (await api(`/api/keys/${created.id}`, { headers: auth })).key;
    console.log(`[${name}] created key ${created.id} (${keyName})`);
  } else {
    console.log(`[${name}] reusing key ${key.id} (${keyName})`);
  }

  await api(`/api/keys/${key.id}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      access: { restricted: true, allow },
      budgetLimitCents: budgetCents,
      budgetPeriod: "monthly",
      rpmLimit: rpm,
      tpmLimit: tpm,
      isActive: true,
    }),
  });

  // 2) the dashboard member — password sign-in, key bound server-side
  const existing = (await api("/api/team/members", { headers: auth })).members || [];
  const prior = existing.find((m) => m.name === name);
  if (prior) {
    await api("/api/team/members", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ id: prior.id, password: member.password, apiKeyRef: key.keyRef, areas: member.areas || [], isActive: true }),
    });
    console.log(`[${name}] updated member ${prior.id}`);
  } else {
    const created = await api("/api/team/members", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name, password: member.password, apiKeyRef: key.keyRef, areas: member.areas || [] }),
    });
    console.log(`[${name}] created member ${created.member.id}`);
  }

  const budget = budgetCents === null ? "unlimited" : `$${(budgetCents / 100).toFixed(2)}/month`;
  console.log(`  allowed models: ${allow.join(", ") || "(nothing)"}`);
  console.log(`  dashboard areas: ${(member.areas || []).join(", ") || "(chat only)"}`);
  console.log(`  budget: ${budget} | rpm ${rpm || "unlimited"} | tpm ${tpm || "unlimited"}`);
  console.log(`  login: they type the password only — the key stays server-side\n`);
}
