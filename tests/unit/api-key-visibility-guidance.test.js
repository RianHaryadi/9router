import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const oldGuidance = "This is the only time you will see this key. Store it securely.";
const guidance = "Store this key securely. You can view or copy it later from the API Keys list.";
const source = readFileSync(
  new URL("../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js", import.meta.url),
  "utf-8"
);

describe("API key visibility guidance source verification", () => {
  it("explains that created keys remain available in the API Keys list", () => {
    const modal = source.match(/title="API Key Created"[\s\S]*?<\/Modal>/)?.[0];
    expect(modal).toBeDefined();
    expect(modal).toContain(guidance);
    expect(modal).not.toContain(oldGuidance);
  });

  it("retains the list's reveal and copy controls", () => {
    expect(source).toContain("keyMaskView(key.key, {");
    expect(source).toContain("onClick={() => handleToggleKeyVisibility(key)}");
    expect(source).toContain("onClick={() => handleCopyKey(key)}");
  });

  it("asks for the dashboard password before revealing a key value", () => {
    // The raw value never travels with the list: the owner fetches it from the
    // password-gated reveal route.
    expect(source).toContain("/reveal`");
    expect(source).toContain('"x-9r-password": password');
  });

  it.each(["fa", "id", "km", "pt-BR", "th", "zh-CN"])(
    "updates the existing %s translation without retaining the one-time claim",
    (locale) => {
      const translations = JSON.parse(readFileSync(
        new URL(`../../public/i18n/literals/${locale}.json`, import.meta.url),
        "utf-8"
      ));
      expect(translations).not.toHaveProperty(oldGuidance);
      expect(translations[guidance]).toEqual(expect.any(String));
      expect(translations[guidance].trim()).not.toBe("");
      expect(translations[guidance]).not.toBe(guidance);
    }
  );
});
