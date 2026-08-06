/**
 * A different palette for every business.
 *
 * The first version of this file held seven hard-coded palettes, one per
 * category, and it was the single most obvious thing wrong with the output: a
 * run over one suburb produced four cafés that were the *same shade of amber*,
 * in the same order, with the same type. It did not look like four sites. It
 * looked like one template run four times, which is exactly what a business
 * owner would notice first.
 *
 * So palettes are generated rather than chosen. A hash of the business name
 * picks a hue from a pool the category can plausibly wear, a scheme (how light
 * or dark the page is, and where the colour sits), a type pairing and a corner
 * radius. Every value below is derived arithmetically from those, so:
 *
 * - two cafés on the same street get visibly different sites,
 * - the same café gets the same site every time it is regenerated,
 * - and a dentist never comes out neon orange, because the pool will not offer
 *   it.
 *
 * Contrast is computed, not eyeballed. Text lightness is derived from the
 * background's so a generated combination cannot come out unreadable.
 */

export type Palette = {
  /** Human-readable, for the build log: "midnight · hue 214 · grotesk". */
  id: string;
  scheme: SchemeName;
  hue: number;
  bg: string;
  /** Cards, panels — a step away from the background, never pure white/black. */
  surface: string;
  /** A second step, for nested things that must separate from `surface`. */
  raised: string;
  ink: string;
  muted: string;
  accent: string;
  /** Text placed *on* the accent. Computed from the accent's lightness. */
  accentInk: string;
  /** A supporting hue, for gradients and the second half of a duotone. */
  accent2: string;
  line: string;
  display: string;
  body: string;
  /** 0 for hard-edged designs, up to 20 for soft ones. Changes the feel a lot. */
  radius: number;
  /** Whether the page is dark. The renderer needs to know for scrims. */
  dark: boolean;
  mood: "warm" | "elegant" | "bold" | "clean" | "modern";
};

// ── colour maths ────────────────────────────────────────────────────────────

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** HSL to hex. Everything in this file is built from this one function. */
export function hsl(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 100) / 100;
  const ll = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  const [r, g, b] =
    hh < 60 ? [c, x, 0]
    : hh < 120 ? [x, c, 0]
    : hh < 180 ? [0, c, x]
    : hh < 240 ? [0, x, c]
    : hh < 300 ? [x, 0, c]
    : [c, 0, x];
  const to = (v: number) =>
    Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Relative luminance, the sRGB one from WCAG.
 *
 * Used only to decide what colour of text goes on the accent. Getting that
 * wrong produces white-on-yellow buttons, which is the sort of detail that
 * makes an otherwise decent page look automated.
 */
export function luminance(hex: string): number {
  const v = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** Contrast ratio between two hex colours, 1–21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Deterministic hash. The same name must always produce the same site. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Pulls independent small integers out of one hash, one per decision. */
function picker(seed: string) {
  let h = hash(seed);
  return (n: number) => {
    // xorshift between draws, so consecutive decisions are not correlated —
    // otherwise "hue" and "scheme" moved together and half the combinations
    // never appeared.
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    return h % n;
  };
}

// ── schemes ─────────────────────────────────────────────────────────────────

export type SchemeName = "midnight" | "carbon" | "paper" | "bone" | "duotone" | "cream" | "slate";

/**
 * The accent for a `duotone` page, where the hue owns the whole background.
 *
 * The first version took the straight complement — `hue + 168` — and it is the
 * one combination in this file that was visibly wrong when it was rendered: a
 * green café ground came out with a **magenta** accent, which is a colour-wheel
 * exercise rather than a design. Nobody pairs those.
 *
 * What designers actually reach for on a saturated ground is one of two moves:
 * a cool accent on a warm ground, or a warm one on everything else. Both are
 * pairings you can point at in the wild — teal on terracotta, gold on navy,
 * gold on aubergine, amber on forest green.
 */
function duotoneAccent(h: number): number {
  const hue = ((h % 360) + 360) % 360;
  const warmGround = hue >= 330 || hue <= 70;
  // ±6° of drift so two duotone pages on nearby hues do not land identically.
  const drift = (Math.round(hue) % 13) - 6;
  return (warmGround ? 195 : 42) + drift;
}

/**
 * How light the page is and where the colour lives.
 *
 * Scheme changes the character of a site far more than hue does — a dark
 * "midnight" page and a light "paper" page built on the *same* hue read as two
 * completely different businesses, which is the point.
 */
const SCHEMES: Record<SchemeName, (h: number) => Omit<Palette, "id" | "scheme" | "hue" | "display" | "body" | "radius" | "mood">> = {
  // Near-black, tinted with the hue. Restaurants, bars, gyms.
  midnight: (h) => ({
    bg: hsl(h, 16, 6),
    surface: hsl(h, 14, 10),
    raised: hsl(h, 13, 14),
    ink: hsl(h, 12, 96),
    muted: hsl(h, 10, 64),
    accent: hsl(h, 72, 58),
    accentInk: hsl(h, 30, 8),
    accent2: hsl(h + 28, 60, 50),
    line: hsl(h, 12, 17),
    dark: true,
  }),
  // Neutral black, colour only in the accent. Reads as expensive.
  carbon: (h) => ({
    bg: "#0a0a0b",
    surface: "#111113",
    raised: "#17171a",
    ink: "#f4f4f5",
    muted: "#9a9aa2",
    accent: hsl(h, 84, 60),
    accentInk: "#0a0a0b",
    accent2: hsl(h + 40, 70, 52),
    line: "#1e1e22",
    dark: true,
  }),
  // Warm off-white. The default look of a good small-business site.
  paper: (h) => ({
    bg: hsl(h, 24, 97),
    surface: "#ffffff",
    raised: hsl(h, 20, 94),
    ink: hsl(h, 34, 13),
    muted: hsl(h, 14, 42),
    accent: hsl(h, 62, 36),
    accentInk: "#ffffff",
    accent2: hsl(h - 26, 50, 44),
    line: hsl(h, 18, 89),
    dark: false,
  }),
  // Cool light. Clinics, accountants, anything that must look careful.
  bone: (h) => ({
    bg: hsl(h, 8, 96),
    surface: "#ffffff",
    raised: hsl(h, 10, 93),
    ink: hsl(h, 26, 12),
    muted: hsl(h, 10, 44),
    accent: hsl(h, 66, 38),
    accentInk: "#ffffff",
    accent2: hsl(h + 30, 44, 46),
    line: hsl(h, 12, 88),
    dark: false,
  }),
  // The hue *is* the background. The most opinionated of the seven.
  duotone: (h) => {
    const a = duotoneAccent(h);
    return {
      bg: hsl(h, 42, 15),
      surface: hsl(h, 38, 20),
      raised: hsl(h, 34, 25),
      ink: hsl(h, 30, 96),
      muted: hsl(h, 22, 70),
      accent: hsl(a, 74, 60),
      accentInk: hsl(a, 45, 10),
      accent2: hsl(a - 18, 55, 52),
      line: hsl(h, 30, 26),
      dark: true,
    };
  },
  // Strongly tinted warm light — bakeries, florists, anything soft.
  cream: (h) => ({
    bg: hsl(h, 44, 94),
    surface: hsl(h, 50, 97),
    raised: hsl(h, 40, 90),
    ink: hsl(h, 42, 15),
    muted: hsl(h, 22, 40),
    accent: hsl(h, 68, 34),
    accentInk: hsl(h, 44, 96),
    accent2: hsl(h + 32, 54, 42),
    line: hsl(h, 30, 85),
    dark: false,
  }),
  // Mid-dark blue-grey shell with the hue as the accent. Trades, workshops.
  slate: (h) => ({
    bg: "#0f141b",
    surface: "#161d26",
    raised: "#1d2531",
    ink: "#eef2f7",
    muted: "#93a2b4",
    accent: hsl(h, 80, 56),
    accentInk: hsl(h, 40, 9),
    accent2: hsl(h + 24, 62, 48),
    line: "#222c38",
    dark: true,
  }),
};

// ── what each category can plausibly wear ───────────────────────────────────

/**
 * Hue pools and permitted schemes per family.
 *
 * The constraint is the useful part. A generated palette with no constraint
 * gives a dental clinic a blood-red duotone, and the whole page stops being
 * something you could send to the owner. Each pool is a set of hues that
 * businesses in that category actually use.
 */
const FAMILY_STYLE: Record<
  string,
  { hues: number[]; schemes: SchemeName[]; moods: Palette["mood"][] }
> = {
  food: {
    hues: [18, 32, 8, 44, 138, 352, 24],
    schemes: ["midnight", "cream", "paper", "duotone", "carbon"],
    moods: ["warm", "elegant", "bold"],
  },
  beauty: {
    hues: [336, 348, 286, 20, 174, 312],
    schemes: ["paper", "cream", "carbon", "duotone", "bone"],
    moods: ["elegant", "clean", "modern"],
  },
  trades: {
    hues: [26, 205, 44, 4, 190],
    schemes: ["slate", "carbon", "midnight", "bone"],
    moods: ["bold", "modern"],
  },
  health: {
    hues: [186, 208, 158, 232, 172],
    schemes: ["bone", "paper", "carbon"],
    moods: ["clean", "modern"],
  },
  professional: {
    hues: [214, 44, 258, 196, 350],
    schemes: ["bone", "carbon", "duotone", "paper"],
    moods: ["elegant", "clean", "modern"],
  },
  fitness: {
    hues: [84, 12, 268, 190, 48],
    schemes: ["carbon", "midnight", "duotone", "slate"],
    moods: ["bold", "modern"],
  },
  retail: {
    hues: [164, 350, 30, 248, 200, 96],
    schemes: ["paper", "bone", "cream", "carbon", "duotone"],
    moods: ["modern", "elegant", "warm"],
  },
};

/**
 * Type pairings, from fonts that are already on the machine.
 *
 * No web fonts. A generated site is a single file that has to render correctly
 * when it is opened from a desktop, emailed, or viewed on a phone with a bad
 * connection, and a hero headline that arrives 800ms late in the wrong face is
 * worse than one that never moves. Every stack ends in a generic family, so
 * something sensible renders on any platform.
 */
const TYPE: Array<{ name: string; display: string; body: string }> = [
  {
    name: "grotesk",
    display: `'Helvetica Neue', Helvetica, Arial, sans-serif`,
    body: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`,
  },
  {
    name: "didone",
    display: `'Didot', 'Bodoni MT', 'Playfair Display', Georgia, serif`,
    body: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`,
  },
  {
    name: "oldstyle",
    display: `'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif`,
    body: `'Charter', 'Iowan Old Style', Georgia, serif`,
  },
  {
    name: "humanist",
    display: `Optima, Candara, 'Gill Sans', 'Gill Sans MT', sans-serif`,
    body: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`,
  },
  {
    name: "geometric",
    display: `Futura, 'Century Gothic', 'Avenir Next', Avenir, sans-serif`,
    body: `'Avenir Next', Avenir, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif`,
  },
  {
    name: "editorial",
    display: `Georgia, 'Times New Roman', Times, serif`,
    body: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`,
  },
  {
    name: "mono",
    display: `'SF Mono', Menlo, Consolas, 'Courier New', monospace`,
    body: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`,
  },
  {
    name: "system",
    display: `system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`,
    body: `system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`,
  },
];

const RADII = [0, 2, 6, 12, 20];

/**
 * The palette for one business.
 *
 * `seed` is the business name, so the result is stable across runs — an owner
 * who is sent a link on Monday sees the same site on Friday.
 */
export function paletteFor(family: string, seed: string): Palette {
  const style = FAMILY_STYLE[family] ?? FAMILY_STYLE.retail;
  const pick = picker(`${family}:${seed}`);

  // Nudged off the pool hue by a few degrees so two businesses that land on the
  // same base still differ. Small enough that the category constraint holds.
  const hue = (style.hues[pick(style.hues.length)] + (pick(15) - 7)) % 360;
  const scheme = style.schemes[pick(style.schemes.length)];
  const type = TYPE[pick(TYPE.length)];
  const mood = style.moods[pick(style.moods.length)];
  const radius = RADII[pick(RADII.length)];

  const base = SCHEMES[scheme](hue);

  // Whatever the scheme proposed for text-on-accent, take the version that
  // actually reads. A mid-lightness accent can go either way and the scheme
  // cannot know which without measuring.
  const accentInk =
    contrast(base.accent, base.accentInk) >= 4.5
      ? base.accentInk
      : contrast(base.accent, "#ffffff") >= contrast(base.accent, "#0a0a0b")
        ? "#ffffff"
        : "#0a0a0b";

  return {
    ...base,
    accentInk,
    id: `${scheme} · hue ${Math.round(hue)} · ${type.name}`,
    scheme,
    hue,
    display: type.display,
    body: type.body,
    radius,
    mood,
  };
}
