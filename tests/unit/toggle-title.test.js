import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../../src/shared/components/Toggle.js", import.meta.url),
  "utf-8"
);

describe("Toggle title forwarding source contract", () => {
  it("accepts title and forwards it to the switch button", () => {
    const props = source.match(/export default function Toggle\(\{([^}]*)\}\)/)?.[1] || "";
    expect(props.split(",").map((p) => p.trim())).toContain("title");

    const button = source.match(/<button\b[\s\S]*?>/)?.[0] || "";
    expect(button).toContain('role="switch"');
    expect(button).toContain("title={title}");
  });
});
