// Node loader for the "@/..." path alias used across src/.
//
// The Next.js build resolves "@/*" through jsconfig.json, but a plain
// `node scripts/foo.mjs` does not. Registering this loader lets scripts
// import the app's own modules:
//
//   node --import ./scripts/register-alias.mjs scripts/seed-team-keys.mjs ...
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(new URL("./alias-loader.mjs", import.meta.url), pathToFileURL("./"));
