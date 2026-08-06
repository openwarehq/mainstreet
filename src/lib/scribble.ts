/**
 * Hand-drawn lines, generated.
 *
 * Two shapes, both seeded from the business name so they belong to the same
 * page as its wordmark and never change under it:
 *
 * - **A trace.** One long wandering line down the side of the page, drawn by
 *   the scroll itself. It is a progress bar that does not look like a progress
 *   bar, and it is the thing that makes a long page feel drawn rather than laid
 *   out.
 * - **An underline.** A short scribble under a heading, in two passes, the way
 *   somebody underlines a word twice without lifting the pen. Drawn when it
 *   scrolls into view.
 *
 * Both are stroked paths with `pathLength="100"`, so the same CSS that writes
 * the wordmark on writes these on too — see `motion.ts`. No JavaScript.
 *
 * The wobble is the whole point. A perfectly smooth sine wave reads as a
 * decoration a machine added; a line whose amplitude and period drift, and
 * which overshoots slightly on the way back, reads as a line somebody drew.
 */

import { hash } from "./palette";

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

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A long vertical line that wanders as it descends.
 *
 * The viewBox is a fixed 40 × 1000 and the caller stretches it with
 * `preserveAspectRatio="none"`; `vector-effect="non-scaling-stroke"` keeps the
 * stroke an even weight however far it is stretched, which is the difference
 * between a drawn line and a smeared one.
 */
export function scribbleTrace(seed: string, opts: { steps?: number } = {}): string {
  const pick = picker(`trace:${seed}`);
  const steps = opts.steps ?? 22;
  const H = 1000;
  const mid = 20;
  // How far the line is allowed to stray, and how much that drifts on the way
  // down — a constant amplitude is a wave, a drifting one is a hand.
  const base = 6 + pick() * 5;

  let d = `M ${r1(mid + (pick() - 0.5) * base)} 0`;
  let prevX = mid;
  for (let i = 1; i <= steps; i++) {
    const y = (H / steps) * i;
    const amp = base * (0.55 + pick() * 0.9);
    const x = mid + (pick() - 0.5) * 2 * amp;
    // Control points pushed past the midpoint, so the curve leans into each
    // turn instead of easing symmetrically through it.
    const cy1 = y - H / steps / 2 - (pick() - 0.5) * 18;
    const cy2 = y - H / steps / 4 + (pick() - 0.5) * 14;
    d += ` C ${r1(prevX + (pick() - 0.5) * 9)} ${r1(cy1)}, ${r1(x + (pick() - 0.5) * 9)} ${r1(cy2)}, ${r1(x)} ${r1(y)}`;
    prevX = x;
  }

  return `<svg class="scribble-trace" viewBox="0 0 40 ${H}" preserveAspectRatio="none" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" vector-effect="non-scaling-stroke"><path d="${d}" pathLength="100" vector-effect="non-scaling-stroke" style="--i:0"/></svg>`;
}

/**
 * A scribbled underline, in two passes.
 *
 * The second pass is deliberately not a copy of the first: it starts short,
 * ends long and sits a little lower, which is what a real double underline
 * does and what stops the two reading as one thick line.
 */
export function scribbleUnderline(seed: string, opts: { passes?: number } = {}): string {
  const pick = picker(`rule:${seed}`);
  const passes = opts.passes ?? 2;
  const W = 100;
  const paths: string[] = [];

  for (let p = 0; p < passes; p++) {
    const y = 5 + p * 3.4 + (pick() - 0.5) * 1.6;
    const from = p === 0 ? 1 + pick() * 3 : 3 + pick() * 6;
    const to = p === 0 ? W - 2 - pick() * 5 : W - pick() * 2;
    const segs = 4 + Math.floor(pick() * 3);
    let d = `M ${r1(from)} ${r1(y + (pick() - 0.5) * 2)}`;
    for (let i = 1; i <= segs; i++) {
      const x = from + ((to - from) / segs) * i;
      const cx = x - (to - from) / segs / 2;
      const cy = y + (pick() - 0.5) * 4.4;
      d += ` Q ${r1(cx)} ${r1(cy)}, ${r1(x)} ${r1(y + (pick() - 0.5) * 2.4)}`;
    }
    paths.push(
      `<path d="${d}" pathLength="100" vector-effect="non-scaling-stroke" style="--i:${p}"/>`,
    );
  }

  return `<svg class="scribble-rule" viewBox="0 0 ${W} 14" preserveAspectRatio="none" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">${paths.join("")}</svg>`;
}
