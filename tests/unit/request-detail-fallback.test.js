import { describe, expect, it } from "vitest";
import fs from "node:fs";

const componentPath = new URL("../../src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js", import.meta.url);
const component = fs.readFileSync(componentPath, "utf8");

describe("request detail fallback explainability", () => {
  it("loads fallback events by the selected request ID", () => {
    expect(component).toContain("/api/usage/fallbacks?");
    expect(component).toContain("selectedDetail.requestId");
    expect(component).toContain("Fallback chain");
  });
});
