// Seed one API key per teammate, each restricted to the models/combos you
// name, with a monthly budget and RPM/TPM limits.
//
// Usage:
//   node scripts/seed-team-keys.mjs '{"andi":["openai/gpt-5"],"budi":["MyCombo"]}'
//
// Options (env or CLI flags):
//   --budget-cents 500      monthly budget per key (500 = $5.00)
//   --rpm 20                requests per minute
//   --tpm 60000             tokens per minute
//   --machine-id <id>       machine id embedded in the key (default: team-<name>)
//
// The script is idempotent per name: an existing key with the same name is
// updated (allow-list, budget, limits) instead of duplicated.
import { createApiKey, getApiKeys, updateApiKey } from "../src/lib/db/repos/apiKeysRepo.js";
import { validateKeyAccessInput } from "../src/shared/utils/keyAccess.js";

const args = process.argv.slice(2);
const jsonArg = args.find((a) => !a.startsWith("--"));
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith("--")) continue;
  const key = args[i].slice(2);
  const next = args[i + 1];
  if (next && !next.startsWith("--")) { flags[key] = next; i++; }
  else flags[key] = true;
}

const plan = jsonArg ? JSON.parse(jsonArg) : {};
if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
  console.error("Usage: node scripts/seed-team-keys.mjs '{\"name\":[\"model-or-combo\", ...]}'");
  process.exit(2);
}

const budgetCents = Number(flags["budget-cents"] ?? 500);
const rpmLimit = Number(flags.rpm ?? 20);
const tpmLimit = Number(flags.tpm ?? 60000);

const existing = new Map();
for (const k of await getApiKeys()) existing.set(k.name, k);

for (const [name, allow] of Object.entries(plan)) {
  const checked = validateKeyAccessInput({ restricted: true, allow });
  if (!checked.ok) {
    console.error(`[${name}] invalid allow-list: ${checked.error}`);
    continue;
  }
  const prior = existing.get(name);
  if (prior) {
    const updated = await updateApiKey(prior.id, {
      access: checked.value,
      budgetLimitCents: budgetCents,
      budgetPeriod: "monthly",
      rpmLimit,
      tpmLimit,
      isActive: true,
    });
    console.log(`[${name}] updated existing key ${updated.id}`);
    continue;
  }
  const created = await createApiKey(name, flags["machine-id"] || `team-${name.toLowerCase().replace(/[^a-z0-9]/g, "")}`);
  const updated = await updateApiKey(created.id, {
    access: checked.value,
    budgetLimitCents: budgetCents,
    budgetPeriod: "monthly",
    rpmLimit,
    tpmLimit,
  });
  console.log(`[${name}] created key ${updated.id}`);
  console.log(`  key: ${updated.key}`);
  console.log(`  allowed: ${checked.value.allow.join(", ")}`);
  console.log(`  budget: $${(budgetCents / 100).toFixed(2)}/month | rpm ${rpmLimit} | tpm ${tpmLimit}`);
}
