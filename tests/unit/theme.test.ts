import { describe, expect, it } from "vitest";
import { isHexColor, moodColors, paletteFromSeed, themeStylesheet } from "@/theme/materialYou";

describe("Material You palette", () => {
  it("generates every M3 role as hex for light and dark", () => {
    for (const dark of [false, true]) {
      const p = paletteFromSeed("#6750a4", dark);
      for (const v of Object.values(p)) expect(isHexColor(v)).toBe(true);
      expect(p.primary).not.toBe(p["on-primary"]);
    }
    expect(paletteFromSeed("#6750a4", false).surface).not.toBe(paletteFromSeed("#6750a4", true).surface);
  });
  it("writes CSS custom properties for light, dark and forced modes", () => {
    const css = themeStylesheet("#d0436e");
    expect(css).toContain("--md-sys-color-primary:");
    expect(css).toContain("--md-sys-color-surface-container-highest:");
    expect(css).toContain('[data-theme="dark"]');
  });
  it("falls back on a bad seed and makes mood colours", () => {
    expect(isHexColor(paletteFromSeed("nope", false).primary)).toBe(true);
    expect(moodColors("#d0436e", "confession", true).every(isHexColor)).toBe(true);
  });
});
