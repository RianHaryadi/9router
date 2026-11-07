import { describe, expect, it } from "vitest";
import { GET as breakerGet } from "../../src/app/api/health/breaker/route.js";
import { GET as latencyGet } from "../../src/app/api/usage/latency/route.js";
import { GET as projectsGet } from "../../src/app/api/usage/projects/route.js";
import { GET as fallbacksGet } from "../../src/app/api/usage/fallbacks/route.js";
import { formatPercentile, stateVariant } from "../../src/app/(dashboard)/dashboard/health/components/helpers.js";

const request = (url) => new Request(url);

describe("health dashboard", () => {
  it("formats metrics and breaker states", () => {
    expect(formatPercentile(12.4)).toBe("12 ms");
    expect(formatPercentile(null)).toBe("—");
    expect(stateVariant("closed")).toBe("success");
    expect(stateVariant("half-open")).toBe("warning");
    expect(stateVariant("open")).toBe("error");
  });

  it("keeps all API contracts available", async () => {
    const responses = await Promise.all([
      breakerGet(), latencyGet(request("http://localhost/api/usage/latency")),
      projectsGet(request("http://localhost/api/usage/projects")), fallbacksGet(request("http://localhost/api/usage/fallbacks")),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    expect(bodies.every((body) => body.ok === true)).toBe(true);
    expect(bodies[0].snapshot.entries).toBeInstanceOf(Array);
    expect(bodies[1].latencyMs).toBeTypeOf("object");
    expect(bodies[1].ttftMs).toBeTypeOf("object");
    expect(bodies[1].providers).toBeInstanceOf(Array);
    expect(bodies[2].projects).toBeInstanceOf(Array);
    expect(bodies[3].events).toBeInstanceOf(Array);
    expect(bodies[3].summary).toBeTypeOf("object");
  });
});
