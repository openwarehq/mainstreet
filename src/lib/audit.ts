/**
 * The check that makes a model allowed to write the page.
 *
 * Letting a language model design the site is what stops every business getting
 * the same layout. It is also the moment the tool could start lying: the single
 * most natural thing for a model handed "Alba Coffee, a café on King Street" to
 * write is *"Serving Newtown's finest coffee since 1998 — ★★★★★ from over 500
 * happy customers"*, and every word of that is invented about a business that
 * has not been contacted.
 *
 * So the model's output is audited against the facts before it is written to
 * disk. Two classes of finding:
 *
 * - **Invention** — a claim nobody verified. Ratings, reviews, years in
 *   business, awards, prices, guarantees, "family-run". Also any phone number
 *   or email address that is not the one OpenStreetMap holds, which is the
 *   dangerous case: a hallucinated phone number on a page carrying a real
 *   business's name sends their customers to a stranger.
 * - **Unsafe** — script, event handlers, `javascript:` links, external
 *   stylesheets. A generated page has no reason to execute anything, so the
 *   rule is simply that it does not.
 *
 * A failing page is not patched into compliance. The violations are handed back
 * to the model, which rewrites once; if it fails again the deterministic
 * renderer builds the site instead. Silently deleting the sentence that says
 * "★★★★★" leaves the design built around a rating that is no longer there.
 */

import type { Facts } from "./spec";

export type Violation = {
  rule: string;
  detail: string;
  kind: "invention" | "unsafe" | "structure" | "access";
};

/**
 * Claims a generator cannot possibly know are true.
 *
 * Deliberately blunt. A false positive costs one rewrite; a false negative
 * puts a fabricated five-star rating on a real business's name.
 */
const CLAIMS: Array<{ rule: string; re: RegExp }> = [
  { rule: "ratings", re: /★|⭐|\b\d(?:\.\d)?\s*(?:\/\s*5|out of 5|stars?)\b/i },
  { rule: "reviews", re: /\b(testimonials?|reviews?|what our (?:customers|clients) say)\b/i },
  { rule: "trading history", re: /\b(?:since|est\.?|established)\s*(?:in\s*)?(?:18|19|20)\d{2}\b/i },
  { rule: "years of experience", re: /\b\d+\+?\s*years?\s+(?:of\s+)?(?:experience|serving|in business|trading)\b/i },
  { rule: "awards", re: /\b(?:award[-\s]winning|voted\s+best|#1\b|number\s+one\b)/i },
  { rule: "customer counts", re: /\b(?:over|more than)\s+[\d,]+\+?\s+(?:happy\s+)?(?:customers|clients|patients|members|guests)\b/i },
  { rule: "prices", re: /[$£€]\s?\d/ },
  { rule: "credentials", re: /\b(?:fully\s+)?(?:licen[cs]ed|insured|accredited|certified|award|qualified\s+team)\b/i },
  { rule: "free offers", re: /\bfree\s+(?:quote|consultation|estimate|delivery|trial)\b/i },
  { rule: "guarantees", re: /\b(?:guarantee[ds]?|warranty|money[-\s]back|satisfaction guaranteed)\b/i },
  { rule: "family claims", re: /\bfamily[-\s](?:owned|run|business)\b/i },
  { rule: "team claims", re: /\bour\s+(?:team of|expert|experienced|friendly)\s+\w+/i },
];

/** Hosts a generated page is allowed to reference. */
const ALLOWED_HOSTS = [
  "upload.wikimedia.org",
  "commons.wikimedia.org",
  "www.openstreetmap.org",
  "openstreetmap.org",
  "www.facebook.com",
  "facebook.com",
  "www.instagram.com",
  "instagram.com",
];

/**
 * Elements a reader sees a break at.
 *
 * The distinction matters more than it looks. Collapsing *every* tag to a space
 * runs separate blocks together into one line, and the first real page this
 * audit ever saw was rejected because of it: a phone number in one block was
 * followed by the section label `01` in the next, and
 *
 *     +61 2 9517 1333        01 — Get it booked in
 *
 * became the single run `+61 2 9517 1333 01`, which is not the number on
 * record. Numbered sections are in two of the art-direction briefs, so this
 * would have fired on a large share of real pages.
 */
const BLOCK =
  /^\/?(?:p|div|section|article|header|footer|main|aside|nav|h[1-6]|ul|ol|li|dl|dt|dd|table|thead|tbody|tfoot|tr|td|th|figure|figcaption|blockquote|address|br|hr|form|fieldset|legend|pre|hgroup|details|summary)\b/i;

/**
 * What a visitor reads, one line per block.
 *
 * Inline tags become a space so a claim split across `<strong>` still reads as
 * one sentence; block tags become a newline so two unrelated blocks never merge
 * into one number.
 */
export function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<([^>]+)>/g, (_m, tag: string) => (BLOCK.test(tag) ? "\n" : " "))
    .replace(/&nbsp;/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n[\s\n]*/g, "\n")
    .trim();
}

/** Digits only, so "+61 2 9550 1234" and "0295501234" compare equal. */
const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Phone-shaped runs in the text.
 *
 * Seven digits minimum. Below that a street number, a postcode, a year or a
 * time of day all match, and the audit rejects every page it sees.
 */
function phoneCandidates(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\+?[\d][\d\s().-]{6,}\d/g)) {
    if (digits(m[0]).length >= 7) out.push(m[0].trim());
  }
  return out;
}

export function audit(html: string, facts: Facts): Violation[] {
  const v: Violation[] = [];
  const add = (kind: Violation["kind"], rule: string, detail: string) =>
    v.push({ kind, rule, detail });

  // ── structure ─────────────────────────────────────────────────────────────
  if (!/<!doctype html>/i.test(html)) add("structure", "doctype", "no <!doctype html>");
  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html))
    add("structure", "html element", "the document is not closed");
  if (!/<style[\s>]/i.test(html)) add("structure", "styles", "no inline <style> block");
  if (html.length < 4000)
    add("structure", "length", `only ${html.length} bytes — the page is a stub`);

  // ── unsafe ────────────────────────────────────────────────────────────────
  if (/<script[\s>]/i.test(html)) add("unsafe", "script", "the page contains <script>");
  const handler = html.match(/\son[a-z]+\s*=\s*["']/i);
  if (handler) add("unsafe", "event handler", `inline handler ${handler[0].trim()}`);
  if (/javascript:/i.test(html)) add("unsafe", "javascript: url", "a javascript: URL is present");
  if (/<link[^>]+rel=["']?stylesheet/i.test(html))
    add("unsafe", "external stylesheet", "the page links a stylesheet — it must be self-contained");
  if (/@import\s/i.test(html)) add("unsafe", "css import", "@import pulls in a remote stylesheet");
  if (/<iframe[\s>]/i.test(html)) add("unsafe", "iframe", "the page embeds an iframe");

  // ── access ────────────────────────────────────────────────────────────────
  // A page that animates has to offer a way out of it. Vestibular disorders
  // make unstoppable movement a real harm rather than a matter of taste, and
  // the escape hatch is one media query — there is no excuse for omitting it.
  // Only the page's *own* keyframes are checked: the injected motion layer
  // carries its own guard and is added after this runs.
  if (/@keyframes\s/i.test(html) && !/prefers-reduced-motion/i.test(html)) {
    add(
      "access",
      "reduced motion",
      "the page animates with no prefers-reduced-motion escape",
    );
  }

  // Every absolute URL has to be somewhere we sanctioned. A model asked for
  // photographs will happily reach for unsplash.com, which is a hotlink to a
  // service that has not agreed to serve it.
  const hosts = new Set<string>();
  for (const m of html.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) hosts.add(m[1].toLowerCase());
  for (const h of hosts) {
    if (h === "www.w3.org") continue; // SVG namespace
    if (!ALLOWED_HOSTS.includes(h)) add("unsafe", "external host", `links to ${h}`);
  }

  // ── invention ─────────────────────────────────────────────────────────────
  const lines = visibleText(html).split("\n");
  // Claims read as prose, so blocks are joined back up — a sentence broken
  // across an inline tag is still one sentence.
  const prose = lines.join(" ");

  for (const c of CLAIMS) {
    const m = prose.match(c.re);
    if (m) add("invention", c.rule, `"${m[0]}" — nothing verifies this`);
  }

  // Contact details are matched per block, because two adjacent blocks are two
  // separate things however close together they render.
  const known = facts.phone ? digits(facts.phone) : null;
  const knownEmail = facts.email?.toLowerCase() ?? null;

  for (const line of lines) {
    for (const cand of phoneCandidates(line)) {
      const d = digits(cand);
      // Trailing/leading country-code differences are the same number.
      const same = known && (d.endsWith(known.slice(-8)) || known.endsWith(d.slice(-8)));
      if (!same) add("invention", "phone number", `"${cand}" is not the number on record`);
    }
    for (const m of line.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) {
      if (m[0].toLowerCase() !== knownEmail)
        add("invention", "email address", `"${m[0]}" is not the address on record`);
    }
  }

  return v;
}

/** One line per violation, for feeding back to the model. */
export function violationReport(v: Violation[]): string {
  return v.map((x) => `- [${x.kind}] ${x.rule}: ${x.detail}`).join("\n");
}
