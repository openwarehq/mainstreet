import { describe, expect, it } from "vitest";
import { contrast, hsl, paletteFor } from "../src/lib/palette";

/**
 * The palette generator exists because seven hard-coded palettes made twelve
 * sites look like one template run twelve times. These tests hold the two
 * properties that fix is worth anything for: **different businesses look
 * different**, and **the same business never changes**.
 */

const FAMILIES = ["food", "beauty", "trades", "health", "professional", "fitness", "retail"];

const NAMES = [
  "Alba Coffee", "Barmuda", "Café Newtown", "Green Mushroom", "Mary's",
  "Washoku", "The Corner Store", "Blackwood & Sons", "Lune", "Pico",
  "Everleigh", "Nine Yards",
];

describe("hsl", () => {
  it("produces hex", () => {
    expect(hsl(0, 100, 50)).toBe("#ff0000");
    expect(hsl(120, 100, 50)).toBe("#00ff00");
    expect(hsl(0, 0, 100)).toBe("#ffffff");
  });

  it("wraps hues past 360 rather than clipping them", () => {
    // `accent2` is routinely computed as `hue + 168`, which runs past 360 for
    // more than half the pool. Clipping there would collapse every one of them
    // onto magenta.
    expect(hsl(380, 100, 50)).toBe(hsl(20, 100, 50));
    expect(hsl(-20, 100, 50)).toBe(hsl(340, 100, 50));
  });
});

describe("paletteFor", () => {
  it("gives the same business the same palette every time", () => {
    // An owner sent a link on Monday must see the same site on Friday.
    const a = paletteFor("food", "Alba Coffee");
    const b = paletteFor("food", "Alba Coffee");
    expect(a).toEqual(b);
  });

  it("gives businesses in the same category visibly different palettes", () => {
    // This is the actual complaint the generator was rebuilt to answer: four
    // cafés in one suburb came out the same shade of amber.
    const ids = new Set(NAMES.map((n) => paletteFor("food", n).id));
    expect(ids.size).toBeGreaterThanOrEqual(NAMES.length - 2);

    const accents = new Set(NAMES.map((n) => paletteFor("food", n).accent));
    expect(accents.size).toBeGreaterThanOrEqual(NAMES.length - 2);
  });

  it("spreads across schemes rather than favouring one", () => {
    const schemes = new Set(NAMES.flatMap((n) => FAMILIES.map((f) => paletteFor(f, n).scheme)));
    expect(schemes.size).toBeGreaterThanOrEqual(5);
  });

  it("keeps every category inside the hues it can plausibly wear", () => {
    // A dental practice in blood red is the failure mode of an unconstrained
    // generator, and it is the one that stops the page being sendable.
    for (const n of NAMES) {
      const h = paletteFor("health", n).hue;
      const ok = [186, 208, 158, 232, 172].some((base) => Math.abs(h - base) <= 8);
      expect(ok, `health hue ${h} for ${n}`).toBe(true);
    }
  });

  it("never generates text that cannot be read", () => {
    for (const family of FAMILIES) {
      for (const n of NAMES) {
        const p = paletteFor(family, n);
        expect(contrast(p.ink, p.bg), `${family}/${n} ink on bg`).toBeGreaterThanOrEqual(7);
        expect(contrast(p.muted, p.bg), `${family}/${n} muted on bg`).toBeGreaterThanOrEqual(3.5);
        expect(contrast(p.ink, p.surface), `${family}/${n} ink on surface`).toBeGreaterThanOrEqual(6);
        // The accent carries buttons, so its text is the one most likely to be
        // wrong — a mid-lightness accent can go either way and the scheme
        // cannot know which without measuring.
        expect(contrast(p.accent, p.accentInk), `${family}/${n} accent text`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps surfaces distinguishable from the page and from each other", () => {
    for (const family of FAMILIES) {
      for (const n of NAMES.slice(0, 6)) {
        const p = paletteFor(family, n);
        expect(p.surface).not.toBe(p.bg);
        expect(p.raised).not.toBe(p.surface);
        expect(p.line).not.toBe(p.bg);
      }
    }
  });

  it("emits every colour as a hex value the browser will accept", () => {
    const hex = /^#[0-9a-f]{6}$/;
    for (const family of FAMILIES) {
      const p = paletteFor(family, "Anything");
      for (const key of ["bg", "surface", "raised", "ink", "muted", "accent", "accentInk", "accent2", "line"] as const) {
        expect(p[key], `${family}.${key}`).toMatch(hex);
      }
    }
  });
});
