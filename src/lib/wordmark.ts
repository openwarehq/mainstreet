/**
 * A drawn logotype for a business that has never had one.
 *
 * Every generated page so far set its name in a system font, and that is the
 * single biggest reason a batch of them still looked like a batch: the layout
 * varied, the colour varied, and the *letters* were the same letters everybody
 * else's page uses. A business with no website has no logo either, and a
 * proposal that arrives with one is a different kind of object.
 *
 * So the name is drawn rather than typeset. Every glyph below is a monoline
 * skeleton on a 10×14 grid — the geometric, constructed style, which is a real
 * lettering tradition and also the one that survives being generated, because
 * its whole character is that it looks built rather than written.
 *
 * The letterforms are fixed; how they are *drawn* is seeded from the name:
 *
 * - stroke weight, from hairline to heavy
 * - a slant, either way
 * - how tightly the letters are tracked
 * - round or squared-off terminals
 * - a per-glyph baseline shift and rotation of a fraction of a degree, which is
 *   what stops it reading as a font and starts it reading as lettering
 *
 * Two businesses never get the same mark, and one business gets the same mark
 * every time — the same guarantee the palette makes.
 *
 * It draws itself on. Each path carries `pathLength="100"`, which normalises
 * every stroke to the same nominal length whatever its real geometry, so one
 * CSS animation from `stroke-dashoffset: 100` to `0` writes any letter at the
 * same rate — with no measuring, and therefore no JavaScript.
 */

import { hash } from "./palette";

/** Advance width per glyph, in grid units. Everything else is 10 wide. */
const WIDTHS: Record<string, number> = {
  I: 2, J: 8, L: 8.6, M: 12, W: 12.6, T: 9.4, Y: 9.4, "1": 6,
  "'": 2.4, ".": 2.4, "-": 7, "&": 11.4, " ": 5,
};

/**
 * The alphabet, as stroke skeletons on a 10 wide × 14 tall box.
 *
 * y=0 is the cap line and y=14 the baseline. Round forms overshoot both by a
 * fraction, as they must — an O that stops exactly on the baseline reads as
 * smaller than an E beside it.
 */
const GLYPHS: Record<string, string[]> = {
  A: ["M0 14 L5 0 L10 14", "M1.9 9.5 L8.1 9.5"],
  B: [
    "M0 0 L0 14",
    "M0 0 L4.6 0 C8.2 0 8.2 7 4.6 7 L0 7",
    "M0 7 L5 7 C8.9 7 8.9 14 5 14 L0 14",
  ],
  C: ["M9.4 2.6 C7.8 -0.4 0.4 -0.3 0.4 7 C0.4 14.3 7.8 14.4 9.4 11.4"],
  D: ["M0 0 L0 14", "M0 0 L3.8 0 C9.6 0 9.6 14 3.8 14 L0 14"],
  E: ["M9.4 0 L0 0 L0 14 L9.4 14", "M0 7 L7.4 7"],
  F: ["M9.4 0 L0 0 L0 14", "M0 7 L7.4 7"],
  G: ["M9.4 2.6 C7.8 -0.4 0.4 -0.3 0.4 7 C0.4 14.3 8.2 14.6 9.6 11 L9.6 7.4 L5.6 7.4"],
  H: ["M0 0 L0 14", "M10 0 L10 14", "M0 7 L10 7"],
  I: ["M1 0 L1 14"],
  J: ["M7.6 0 L7.6 9.8 C7.6 14.6 0.6 14.6 0.4 10.4"],
  K: ["M0 0 L0 14", "M9.4 0 L0.6 8", "M3.4 5.6 L10 14"],
  L: ["M0 0 L0 14 L8.6 14"],
  M: ["M0 14 L0 0 L6 9.4 L12 0 L12 14"],
  N: ["M0 14 L0 0 L10 14 L10 0"],
  O: ["M5 -0.3 C9 -0.3 10 3.4 10 7 C10 10.6 9 14.3 5 14.3 C1 14.3 0 10.6 0 7 C0 3.4 1 -0.3 5 -0.3 Z"],
  P: ["M0 14 L0 0 L4.8 0 C8.6 0 8.6 7.6 4.8 7.6 L0 7.6"],
  Q: ["M5 -0.3 C9 -0.3 10 3.4 10 7 C10 10.6 9 14.3 5 14.3 C1 14.3 0 10.6 0 7 C0 3.4 1 -0.3 5 -0.3 Z", "M6.4 10.6 L10.4 15.4"],
  R: ["M0 14 L0 0 L4.8 0 C8.6 0 8.6 7.2 4.8 7.2 L0 7.2", "M4.4 7.2 L9.8 14"],
  S: [
    "M9.3 2.6 C9.3 -0.7 0.9 -1 0.9 3.5 C0.9 7.2 9.2 6.4 9.2 10.4 C9.2 14.9 0.6 14.7 0.6 11.3",
  ],
  T: ["M0 0 L9.4 0", "M4.7 0 L4.7 14"],
  U: ["M0 0 L0 9 C0 14.4 10 14.4 10 9 L10 0"],
  V: ["M0 0 L5 14 L10 0"],
  W: ["M0 0 L3.2 14 L6.3 4.6 L9.4 14 L12.6 0"],
  X: ["M0 0 L10 14", "M10 0 L0 14"],
  Y: ["M0 0 L4.7 7.2 L9.4 0", "M4.7 7.2 L4.7 14"],
  Z: ["M0 0 L10 0 L0 14 L10 14"],

  "0": ["M5 -0.3 C9 -0.3 10 3.4 10 7 C10 10.6 9 14.3 5 14.3 C1 14.3 0 10.6 0 7 C0 3.4 1 -0.3 5 -0.3 Z"],
  "1": ["M1 3 L4 0 L4 14"],
  "2": ["M0.6 3.2 C0.6 -1 9.4 -1.2 9.4 3.6 C9.4 7.4 0.6 10.2 0.6 14 L9.8 14"],
  "3": [
    "M0.8 2.6 C0.8 -0.9 9.2 -1 9.2 3.4 C9.2 6.2 5.4 7 3.6 7",
    "M3.6 7 C5.6 7 9.4 7.4 9.4 10.6 C9.4 15 0.8 14.8 0.8 11.3",
  ],
  "4": ["M7.6 14 L7.6 0 L0 10.2 L9.8 10.2"],
  "5": ["M8.8 0 L1.4 0 L0.8 6.6 C3.2 4.8 9.4 5.6 9.4 10.2 C9.4 15 1 14.8 0.6 11.3"],
  "6": [
    "M8.8 1.4 C6.2 -1.2 0.6 0.4 0.6 8.4",
    "M0.6 8.4 C0.6 14.6 9.6 14.8 9.6 9.4 C9.6 4.6 1.6 4.2 0.6 8.4",
  ],
  "7": ["M0 0 L10 0 L3.6 14"],
  "8": [
    "M5 6.6 C1.4 6.6 0.8 3.4 0.8 3.4 C0.8 -1 9.2 -1 9.2 3.4 C9.2 3.4 8.6 6.6 5 6.6 Z",
    "M5 6.6 C1 6.6 0.4 10.4 0.4 10.4 C0.4 15 9.6 15 9.6 10.4 C9.6 10.4 9 6.6 5 6.6 Z",
  ],
  "9": [
    "M1.2 12.6 C3.8 15.2 9.4 13.6 9.4 5.6",
    "M9.4 5.6 C9.4 -0.6 0.4 -0.8 0.4 4.6 C0.4 9.4 8.4 9.8 9.4 5.6",
  ],

  "'": ["M1.2 0 L0.6 4.6"],
  ".": ["M1.2 13.4 L1.2 14"],
  "-": ["M0.6 7.4 L6.4 7.4"],
  "&": [
    "M11.4 14 C7.6 9.6 1.8 5.8 1.8 3.4 C1.8 0.2 6.6 0.2 6.6 3.4 C6.6 6.8 0.4 8 0.4 11.2 C0.4 14.8 6.4 14.8 8.4 10.8 L10.6 6.6",
  ],
  " ": [],
};

export type Wordmark = {
  svg: string;
  /** Letters that had no glyph and were dropped, for the log. */
  unsupported: string[];
  /** How the mark was drawn, for the build log: "1.6w · 4° · round". */
  id: string;
};

/** Pulls independent decisions out of one hash. */
function picker(seed: string) {
  let h = hash(seed);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    return h / 0xffffffff;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Draws the name.
 *
 * `seed` defaults to the name, so the mark is stable. Anything with no glyph is
 * dropped rather than substituted — a box where a letter should be is worse
 * than a shorter word, and the caller is told what went.
 */
export function wordmark(name: string, opts: { seed?: string; className?: string } = {}): Wordmark {
  const pick = picker(opts.seed ?? name);

  // Every decision below is drawn once, in a fixed order, so the mark is stable.
  const weight = round2(1.05 + pick() * 1.15);
  const slant = round2(-6 + pick() * 12);
  const tracking = round2(1.3 + pick() * 2.2);
  const cap = pick() < 0.68 ? "round" : "butt";
  const jitter = 0.18 + pick() * 0.34;

  const letters = [...name.toUpperCase()];
  const unsupported: string[] = [];

  let x = 0;
  const parts: string[] = [];
  let drawn = 0;

  for (const ch of letters) {
    const strokes = GLYPHS[ch];
    if (!strokes) {
      if (ch.trim()) unsupported.push(ch);
      x += WIDTHS[" "] + tracking;
      continue;
    }
    const w = WIDTHS[ch] ?? 10;
    if (strokes.length) {
      // The wobble is the whole difference between a font and lettering: a
      // fraction of a degree and a fraction of a unit, different per glyph.
      const dy = round2((pick() - 0.5) * 2 * jitter);
      const rot = round2((pick() - 0.5) * 2.6);
      const paths = strokes
        .map(
          (d, i) =>
            `<path d="${d}" pathLength="100" style="--i:${drawn + i}"/>`,
        )
        .join("");
      parts.push(
        `<g transform="translate(${round2(x)} ${dy}) rotate(${rot} ${w / 2} 7)">${paths}</g>`,
      );
      drawn += strokes.length;
    }
    x += w + tracking;
  }

  const width = round2(Math.max(x - tracking, 1));
  // Room for the slant, the overshoot on round forms, and the stroke itself.
  const pad = round2(weight + 1.4 + Math.abs(Math.tan((slant * Math.PI) / 180)) * 14);

  const svg = `<svg class="${opts.className ?? "wm"}" viewBox="${-pad} ${-1.6} ${round2(width + pad * 2)} ${17.2}" role="img" aria-label="${name.replace(/[<>&"]/g, "")}" fill="none" stroke="currentColor" stroke-width="${weight}" stroke-linecap="${cap}" stroke-linejoin="round">
  <g transform="skewX(${-slant})">${parts.join("")}</g>
</svg>`;

  return {
    svg,
    unsupported,
    id: `${weight}w · ${slant}° · ${cap} · ${tracking}tr`,
  };
}
