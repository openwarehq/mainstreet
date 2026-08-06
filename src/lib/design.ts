/**
 * Claude designs the page.
 *
 * The template renderer in `render.ts` produces a competent site, and after
 * eight of them you can see the template through it — same rhythm, same
 * section order, same hero. That is the ceiling of a template, and no amount of
 * palette variation raises it, because the *layout* is the thing that repeats.
 *
 * So the layout is written per business. Claude is handed the verified facts,
 * a generated palette, a named art direction and the imagery, and writes the
 * whole document. What it is not handed is any freedom about the truth: the
 * facts are the only material, and `audit.ts` checks the finished page against
 * them before it reaches disk.
 *
 * Three things are pinned rather than generated, because they are the parts
 * that must not depend on a model doing as it was told:
 *
 * - `noindex, nofollow`
 * - the draft banner naming the page as a proposal
 * - the photographer credits and the OpenStreetMap attribution
 *
 * All three are injected afterwards by code that cannot be talked out of it.
 */

import { audit, violationReport, type Violation } from "./audit";
import { complete, DEFAULT_MODEL, hasKey, type Completion } from "./claude";
import { hash } from "./palette";
import type { SiteSpec } from "./spec";

export type DesignResult = {
  html: string;
  direction: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  priced: boolean;
  ms: number;
  attempts: number;
  /** Violations from the first pass, if a rewrite was needed. Kept for the log. */
  repaired: Violation[];
};

export class DesignRejected extends Error {
  constructor(readonly violations: Violation[]) {
    super(`design rejected: ${violations.map((v) => v.rule).join(", ")}`);
    this.name = "DesignRejected";
  }
}

/**
 * Named art directions.
 *
 * The reason these exist rather than "make it look nice": asked the same
 * open-ended question twelve times, a model converges. Twelve cafés came back
 * with twelve variations of a centred hero and a three-card services row —
 * better than the template, and still recognisably one design. Naming the
 * direction and picking it from a hash forces the spread that a temperature
 * setting does not.
 *
 * Each is written as instructions to a designer, not adjectives, because
 * "editorial" produces a mood and "the headline breaks across three lines at
 * 12vw, flush left, with the section index set in the margin" produces a page.
 */
const DIRECTIONS: Array<{ name: string; moods: string[]; brief: string }> = [
  {
    name: "editorial",
    moods: ["elegant", "warm", "modern"],
    brief:
      "A magazine feature. Enormous display headline breaking across two or three lines, flush left, tight leading (0.95). Section numbers set small in the left margin. Hairline rules between blocks, never boxes. One long introductory paragraph set at 1.5–2× body size in a measure of about 30 characters. Asymmetric two-column grid where the right column is roughly 1.6× the left.",
  },
  {
    name: "swiss",
    moods: ["clean", "modern", "bold"],
    brief:
      "Strict grid, no decoration. Twelve columns, everything flush left to a column edge, zero corner radius anywhere. Type does the work: two sizes only for headings, uppercase labels at 11px with 0.18em tracking. Colour appears as flat blocks, not gradients. Generous top padding, tight internal spacing. Nothing is centred.",
  },
  {
    name: "cinematic",
    moods: ["warm", "bold", "elegant"],
    brief:
      "Full-viewport hero photograph, minimum 88vh, with the name set over it at the bottom left and a thin fixed top bar. A heavy bottom-up gradient so the type has ground. Everything after the hero breathes: sections at 140px vertical padding, one idea each, wide measure. The second photograph runs full-bleed edge to edge partway down as a divider.",
  },
  {
    name: "brutalist",
    moods: ["bold", "modern"],
    brief:
      // Not coordinates. Latitude printed as visible text is a run of eight
      // digits, which the audit reads as a phone number that is not on record —
      // the brief would have been asking for a page that fails.
      "Oversized letterforms at the edge of the viewport, hard 2–3px borders, zero radius, high contrast. Labels in monospace, uppercase, with the category, the street and the suburb set as field-and-value data rows. Blocks offset from each other rather than aligned. Colour used at full strength in large fields. Deliberately structural, not pretty.",
  },
  {
    name: "boutique",
    moods: ["elegant", "clean", "warm"],
    brief:
      "Soft and generous. Large corner radii on every surface, pill-shaped buttons, plenty of empty space, a centred hero with a short headline and one line beneath it. Photographs in rounded frames with a soft shadow. Muted, low-contrast section backgrounds alternating with the page colour. Everything calm and unhurried.",
  },
  {
    name: "split",
    moods: ["modern", "clean", "elegant"],
    brief:
      "A two-panel page. Left half is a sticky column (position:sticky, top:0, height:100vh) holding the name, the category, the address and the contact links — it stays put. Right half scrolls through the content. On narrow screens the left panel unsticks and becomes a normal header. The panel and the scroll column use different backgrounds.",
  },
  {
    name: "catalogue",
    moods: ["clean", "modern"],
    brief:
      "An index. Content arranged as bordered rows in a table-like rhythm, each row a label on the left and its value on the right, hairline separators. Monospace for all metadata. A single photograph, large, at the top; the rest is typography. Row hover changes the background subtly. Feels like a well-set reference document.",
  },
  {
    name: "marquee",
    moods: ["bold", "warm", "modern"],
    brief:
      "Bands. Full-width horizontal strips of solid accent colour carrying a single oversized line of text, alternating with content sections on the page background. No animation — the bands are static and rely on scale. The name appears at least twice at very large size. Punchy, poster-like, loud.",
  },
  {
    name: "quiet",
    moods: ["elegant", "clean"],
    brief:
      "Restraint. Small type throughout (16px body, headings no larger than 34px), enormous whitespace, everything centred in a narrow 640px measure. Small caps with wide letter-spacing for labels. One hairline rule as the only decoration. Photographs small and inset, never full-bleed. The confidence comes from what is left out.",
  },
  {
    name: "collage",
    moods: ["warm", "modern", "bold"],
    brief:
      "Layered. Photographs and flat colour blocks overlap with deliberate offsets using negative margins and z-index. Captions set small and rotated slightly. The hero is a photograph with a colour block crossing one corner and the name straddling the boundary. Grid lines visible in places. Handmade rather than mechanical.",
  },
  {
    name: "service",
    moods: ["bold", "modern", "clean"],
    brief:
      "Built to be phoned. The number is the largest element on the page after the name, set as a huge tappable link in a full-width accent band directly under the hero, repeated in a sticky bottom bar on mobile. Everything else is short and scannable: what they do, where they are, when they are open. Practical, direct, no ornament.",
  },
  {
    name: "gallery",
    moods: ["warm", "elegant", "modern"],
    brief:
      "Photograph-led. An asymmetric masonry-feeling arrangement built with CSS grid where images span different numbers of columns and rows. Minimal text sitting in the gaps between images. The name appears once, large, in an empty grid cell rather than over a photograph. Dense at the top, opening out further down.",
  },
];

export function directionFor(spec: SiteSpec): (typeof DIRECTIONS)[number] {
  const fits = DIRECTIONS.filter((d) => d.moods.includes(spec.palette.mood));
  const pool = fits.length ? fits : DIRECTIONS;
  // Seeded on the name *and* the palette id, so a business whose palette is
  // regenerated does not keep a direction that no longer suits it.
  return pool[hash(`${spec.business}|${spec.palette.id}`) % pool.length];
}

const SYSTEM = `You are a senior web designer who builds single-file websites for local businesses. You write finished, production-quality HTML with the CSS inline in one <style> block. You have strong opinions about typography, spacing and colour, and you never ship a page that looks like a template.

Two rules override everything else, including the design brief:

1. YOU ONLY KNOW WHAT YOU ARE TOLD. The facts given to you come from public map data about a real business that has not been contacted and has not asked for this page. Write nothing about them that is not in those facts. No reviews, no ratings, no stars, no testimonials, no "since 1998", no years of experience, no awards, no customer counts, no prices, no guarantees, no "free quote", no "licensed and insured", no "family-run", no claims about a team you have never met, and above all NO phone number or email address other than the exact ones supplied. An invented phone number on a real business's page sends their customers to a stranger.

   When you need copy and have no fact for it, write about what is true by construction — the category, the street, the suburb, the hours — or write a heading with no claim under it. Short and true beats long and invented.

2. THE PAGE EXECUTES NOTHING. No <script>, no event handler attributes, no javascript: URLs, no iframes, no external stylesheets, no @import, no web fonts. Use only the system font stacks you are given. The only external URLs permitted anywhere in the document are the exact image URLs supplied to you.

Output the complete HTML document and nothing else. No markdown fences, no commentary before or after.`;

function brief(spec: SiteSpec, direction: (typeof DIRECTIONS)[number]): string {
  const p = spec.palette;
  const f = spec.facts;
  const photos = spec.assets?.photos ?? [];

  const facts: string[] = [
    `Name: ${f.name}`,
    `Category: ${f.categoryLabel}`,
    f.cuisine ? `Cuisine tag: ${f.cuisine}` : null,
    f.locality ? `Suburb: ${f.locality}` : null,
    f.street ? `Street: ${f.street}` : null,
    f.address.length ? `Address: ${f.address.join(", ")}` : `Address: not mapped — do not invent one`,
    f.phone ? `Phone (use this string exactly): ${f.phone}` : `Phone: none on record — do not show a phone number anywhere`,
    f.email ? `Email (use this exactly): ${f.email}` : `Email: none on record — do not show an email address anywhere`,
    f.hours ? `Opening hours:\n${f.hours.map((h) => `  ${h}`).join("\n")}` : null,
    f.hoursRaw ? `Opening hours, unparsed — reproduce this string verbatim and do not interpret it: ${f.hoursRaw}` : null,
    !f.hours && !f.hoursRaw ? `Opening hours: not mapped — omit the section entirely` : null,
    f.social.length ? `Social links: ${f.social.map((s) => `${s.label} ${s.href}`).join(", ")}` : null,
    `Map link for a directions button: https://www.openstreetmap.org/?mlat=${f.lat}&mlon=${f.lon}#map=18/${f.lat}/${f.lon}`,
  ].filter(Boolean) as string[];

  const imagery = photos.length
    ? photos
        .map(
          (ph, i) =>
            `Photograph ${i + 1} — ${ph.width}×${ph.height} — use this URL exactly:\n${ph.url}`,
        )
        .join("\n")
    : "No photographs are available. Build the page on type, colour and layout alone — do not reference any image URL.";

  return `Design and build the website for this business.

## The business — these facts are the only material you have

${facts.join("\n")}

## Art direction: "${direction.name}"

${direction.brief}

Commit to it. A page that could have come from any of the other briefs has failed.

## Palette — use these exact values

Declare them as custom properties on :root and use them throughout.

  --bg: ${p.bg}            page background
  --surface: ${p.surface}  cards and panels
  --raised: ${p.raised}    a second surface step, for nesting
  --ink: ${p.ink}          body text
  --muted: ${p.muted}      secondary text
  --accent: ${p.accent}    the one colour that carries the brand
  --accent-ink: ${p.accentInk}  text placed on the accent
  --accent-2: ${p.accent2} supporting colour, for gradients and second-level emphasis
  --line: ${p.line}        borders and rules

The page is ${p.dark ? "dark" : "light"}. Corner radius: ${p.radius}px — apply it consistently, and if it is 0 let nothing be rounded.

Display face: ${p.display}
Body face: ${p.body}

Do not introduce colours outside this palette except by mixing these with transparency.

## Imagery

${imagery}

Where a photograph carries text over it, put a gradient scrim behind the text — a headline sitting directly on a photograph is unreadable and is the first sign of a generated page.

## The map

Write the exact token {{MAP}} on its own line where the map of the business's location should go, inside whatever section and frame you design for it. It is replaced with an <svg> element that fills its container's width. Give it a container — a frame, a full-bleed band, a panel with the address over it, whatever the art direction calls for. ${spec.assets?.map ? "A map is available for this business, so place the token." : "No map is available for this business — do NOT write the token."}

## Requirements

- One file. All CSS in a single <style> in the head. No JavaScript of any kind.
- Responsive: it must work at 375px as well as 1440px. Use clamp() for type.
- Sensible <title> and <meta name="description">, both naming the business and the suburb.
- Semantic structure: header, main, sections, footer. Skip-link not required.
- Every interactive element reachable by keyboard, with a visible :focus-visible style.
- Include a footer, but leave the credits out of it — they are appended for you.
- Aim for around 300–500 lines. Substantial, not padded.

Return the complete document beginning with <!doctype html>.`;
}

/** Wraps the raw model output back into a document if it drifted. */
export function extract(text: string): string {
  const t = text.trim();
  // Fenced output happens occasionally despite the instruction.
  const fenced = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : t;
  const start = body.search(/<!doctype html>/i);
  return start > 0 ? body.slice(start) : body;
}

const esc = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Guarantees there is a document to inject into.
 *
 * A response that was cut short, or that came back as a fragment, still has to
 * end up as a page carrying the draft banner and the credits — those are
 * promises to a business that did not ask for this, and "the model returned
 * something odd" is not an excuse to drop them. A wrapped fragment will
 * usually fail the audit and fall back to the renderer anyway; this just
 * ensures the injection points exist to fail *cleanly*.
 */
function ensureDocument(html: string, spec: SiteSpec): string {
  if (/<body[\s>]/i.test(html)) return html;
  const title = spec.locality
    ? `${spec.business} — ${spec.categoryLabel} in ${spec.locality}`
    : `${spec.business} — ${spec.categoryLabel}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
</head>
<body>
${html}
</body>
</html>`;
}

/**
 * The parts that are not up for negotiation.
 *
 * Injected by code rather than asked for in the prompt, because each one is a
 * promise made to a business that did not ask for this page, and a promise
 * that depends on a model following instructions is not a promise.
 */
function pin(html: string, spec: SiteSpec): string {
  const p = spec.palette;
  let out = ensureDocument(html, spec);

  // 1. Never indexable while it is a draft. Any robots meta the model wrote is
  //    replaced rather than added to, so it cannot contradict this one.
  out = out.replace(/<meta[^>]+name=["']robots["'][^>]*>/gi, "");
  const robots = `<meta name="robots" content="${spec.draft ? "noindex, nofollow" : "index, follow"}">`;
  out = /<\/head>/i.test(out)
    ? out.replace(/<\/head>/i, `${robots}\n</head>`)
    : // No head at all. It goes after the opening <html>, never in front of the
      // doctype — a meta tag before the doctype puts the browser into quirks
      // mode, which silently breaks the layout the model just wrote.
      out.replace(/<html[^>]*>/i, (m) => `${m}\n<head>${robots}</head>`);

  // 2. The draft banner. Inline styles only — it must not depend on a class the
  //    model may not have written.
  if (spec.draft) {
    const banner = `<div style="background:${p.accent};color:${p.accentInk};font:600 13px/1.5 ${p.body.replace(/"/g, "'")};padding:10px 20px;text-align:center;letter-spacing:.01em">Draft proposal for ${esc(spec.business)} — not an official website. Details come from public map data and are unconfirmed.</div>`;
    out = out.replace(/<body[^>]*>/i, (m) => `${m}\n${banner}`);
  }

  // 3. Credits. CC-BY requires the photographer; ODbL requires OpenStreetMap.
  const photos = spec.assets?.photos ?? [];
  const seen = new Set<string>();
  const credits = photos
    .filter((x) => (seen.has(x.page) ? false : (seen.add(x.page), true)))
    .map(
      (x) =>
        `<a href="${esc(x.page)}" target="_blank" rel="noopener" style="color:inherit">${esc(x.artist)}</a> (${esc(x.licence)})`,
    );
  const lines = [
    credits.length ? `Photography: ${credits.join(", ")} — via Wikimedia Commons.` : "",
    spec.assets?.map ? `Map: ${esc(spec.assets.map.attribution)}.` : "",
    esc(spec.attribution),
  ].filter(Boolean);
  const block = `<div style="background:${p.bg};color:${p.muted};border-top:1px solid ${p.line};font:400 12px/1.7 ${p.body.replace(/"/g, "'")};padding:22px 20px;text-align:center">${lines.join(" ")}</div>`;
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${block}\n</body>`) : `${out}\n${block}`;

  return out;
}

/** Drops the map in, or appends one if the model forgot the token. */
function placeMap(html: string, spec: SiteSpec): string {
  const map = spec.assets?.map;
  if (!map) return html.replace(/\{\{MAP\}\}/g, "");

  const svg = map.svg.replace(
    /<svg /,
    `<svg style="display:block;width:100%;height:auto" `,
  );
  if (html.includes("{{MAP}}")) return html.replace(/\{\{MAP\}\}/g, svg);

  // The token was dropped. The map is the only image on the page that is
  // specifically this business's, so it goes in regardless — a plain framed
  // band before the credits.
  const p = spec.palette;
  const band = `<section style="background:${p.surface};border-top:1px solid ${p.line};padding:0"><div style="max-width:1200px;margin:0 auto">${svg}</div></section>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${band}\n</body>`) : html + band;
}

/**
 * Model output in, publishable document out.
 *
 * Everything that must be on the page whatever the model wrote happens here:
 * the map lands, the draft banner and the robots meta go on, the credits go in.
 * Separated from `designSite` so it can be tested against a page the model
 * never saw, which is the only way to check what happens when the model
 * *misbehaves*.
 */
export function assemble(html: string, spec: SiteSpec): string {
  return pin(placeMap(extract(html), spec), spec);
}

export function designerAvailable(): boolean {
  return hasKey() && process.env.MAINSTREET_DESIGN !== "off";
}

/**
 * Designs one site.
 *
 * Audited, and rewritten once if the audit fails. Throws `DesignRejected` if
 * the second attempt is still not clean, which the pipeline catches and falls
 * back to the deterministic renderer for — a plainer site is a much better
 * outcome than a handsome one carrying a phone number nobody can answer.
 */
export async function designSite(spec: SiteSpec, opts: { signal?: AbortSignal } = {}): Promise<DesignResult> {
  const direction = directionFor(spec);
  const started = Date.now();

  let prompt = brief(spec, direction);
  let first: Violation[] = [];
  let inTok = 0;
  let outTok = 0;
  let usd = 0;
  let priced = true;
  let model = DEFAULT_MODEL;
  let last: Violation[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res: Completion = await complete({
      system: SYSTEM,
      prompt,
      maxTokens: 16_000,
      prefill: "<!doctype html>",
      signal: opts.signal,
    });
    inTok += res.inputTokens;
    outTok += res.outputTokens;
    usd += res.usd;
    priced = priced && res.priced;
    model = res.model;

    const html = extract(res.text);
    const violations = audit(html, spec.facts);
    last = violations;

    if (!violations.length) {
      return {
        html: assemble(html, spec),
        direction: direction.name,
        model,
        inputTokens: inTok,
        outputTokens: outTok,
        usd,
        priced,
        ms: Date.now() - started,
        attempts: attempt,
        repaired: first,
      };
    }

    if (attempt === 1) {
      first = violations;
      prompt = `${brief(spec, direction)}

## Your previous attempt was rejected

${violationReport(violations)}

Rewrite the whole document. Keep the art direction and the palette; remove the cause of every line above. Where a claim was removed, do not replace it with a different claim — cut it, or replace it with something the facts actually support. Return the complete document again.`;
    }
  }

  throw new DesignRejected(last);
}
