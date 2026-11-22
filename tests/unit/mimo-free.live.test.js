/**
 * Live repro for issue #1933: MiMo Code Free returns HTTP 502 "MiMo bootstrap failed: 403".
 * Root cause: upstream gates on Chrome-like User-Agent. Without UA → 403 "Illegal access".
 * Hits real endpoints — no mocks. Free provider, safe to call.
 *
 * The upstream provider was RETIRED: `mimo-free` was hidden in 6d96e24b and its
 * bootstrap endpoint now answers 404. The suite therefore runs this file only
 * when it is opted into, like the other live tests in this repo:
 *
 *   RUN_REAL=1 npx vitest run unit/mimo-free.live.test.js
 *
 * Without the opt-in the file is SKIPPED, so the offline suite stays green
 * while the live check is still available to anyone who wants to run it.
 */
import { describe, it, expect } from "vitest";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { __test__ } from "../../open-sse/executors/mimo-free.js";

const RUN_REAL = process.env.RUN_REAL === "1";

const { BOOTSTRAP_URL, CHAT_URL, generateFingerprint, MIMO_SYSTEM_MARKER } = __test__;

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function bootstrapWith(ua) {
  const headers = { "Content-Type": "application/json" };
  if (ua) headers["User-Agent"] = ua;
  const r = await proxyAwareFetch(BOOTSTRAP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ client: generateFingerprint() }),
  });
  // The endpoint can answer with an HTML error page (nginx 404) now that the
  // provider is retired: parsing that as JSON would throw and hide the real
  // status.
  const text = await r.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  return { status: r.status, jwt: data.jwt, body: text.slice(0, 200) };
}

async function chatWith(jwt, ua) {
  const headers = {
    "Content-Type": "application/json",
    "X-Mimo-Source": "mimocode-cli-free",
    Authorization: `Bearer ${jwt}`,
    Accept: "application/json",
  };
  if (ua) headers["User-Agent"] = ua;
  const body = {
    model: "mimo-auto",
    messages: [
      { role: "system", content: MIMO_SYSTEM_MARKER },
      { role: "user", content: "hi" },
    ],
    stream: false,
  };
  return proxyAwareFetch(CHAT_URL, { method: "POST", headers, body: JSON.stringify(body) });
}

describe.skipIf(!RUN_REAL)("MiMo Free bootstrap (live)", () => {
  it("bootstrap returns 200 with JWT", async () => {
    const { status, jwt, body } = await bootstrapWith(CHROME_UA);
    // The provider was retired upstream: the endpoint answers 404 today. The
    // assertion states the contract this test guards — a 200 with a JWT — and
    // the body is in the failure message so the actual upstream answer is
    // visible when it is not.
    expect(status, `bootstrap answered: ${body}`).toBe(200);
    expect(jwt).toBeTruthy();
  });
});

describe.skipIf(!RUN_REAL)("MiMo Free anti-abuse gate (live)", () => {
  it("chat WITH Chrome User-Agent → 200", async () => {
    const { jwt, status: bootStatus, body } = await bootstrapWith(CHROME_UA);
    // Without a JWT there is nothing to chat with: the bootstrap must have
    // worked first.
    expect(bootStatus, `bootstrap answered: ${body}`).toBe(200);
    const r = await chatWith(jwt, CHROME_UA);
    expect(r.status).toBe(200);
  });
});
