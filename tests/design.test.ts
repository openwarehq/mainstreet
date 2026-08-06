import { describe, expect, it } from "vitest";
import { audit } from "../src/lib/audit";
import { assemble, directionFor } from "../src/lib/design";
import { price } from "../src/lib/claude";
import { scoreProspect } from "../src/lib/score";
import { buildSpec, type SiteSpec } from "../src/lib/spec";
import type { Prospect } from "../src/lib/overpass";

/**
 * The audit is the reason a model is allowed to write these pages at all.
 *
 * Everything here is written from the model's point of view: what happens when
 * it does the natural, plausible, *wrong* thing — invents a rating, invents a
 * phone number, reaches for an Unsplash URL, drops the map token. Testing the
 * happy path here would prove nothing; the whole component exists for the
 * unhappy one.
 */

const base: Prospect = {
  id: "node/1",
  name: "Alba Coffee",
  kind: "cafe",
  kindKey: "amenity",
  lat: -33.897,
  lon: 151.179,
  phone: "+61 2 9516 3341",
  email: null,
  website: null,
  street: "King Street",
  housenumber: "412",
  city: "Newtown",
  postcode: "2042",
  openingHours: "Mo-Fr 07:30-16:00; Sa-Su 08:00-15:00",
  cuisine: "coffee_shop",
  facebook: null,
  instagram: null,
};

const spec = (over: Partial<Prospect> = {}): SiteSpec =>
  buildSpec(scoreProspect({ ...base, ...over }));

const page = (body: string, head = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Alba Coffee — Café in Newtown</title>${head}
<style>:root{--bg:#111}body{margin:0}</style></head>
<body>${body}${"<p>Body copy, so the page clears the stub check.</p>".repeat(90)}</body></html>`;

describe("the fact audit", () => {
  const facts = spec().facts;

  it("passes a page built only from the facts", () => {
    const html = page(`<h1>Alba Coffee</h1>
      <p>A café on King Street, Newtown.</p>
      <p>412 King Street, Newtown 2042</p>
      <a href="tel:+61295163341">+61 2 9516 3341</a>
      <p>Monday: 07:30 – 16:00</p>`);
    expect(audit(html, facts)).toEqual([]);
  });

  it("catches a phone number the business does not have", () => {
    // The dangerous one. A hallucinated number on a page carrying a real
    // business's name sends their customers to a stranger.
    const v = audit(page(`<a href="tel:0298887777">02 9888 7777</a>`), facts);
    expect(v.map((x) => x.rule)).toContain("phone number");
  });

  it("accepts the real number written in a different format", () => {
    const v = audit(page(`<p>Call us on (02) 9516 3341</p>`), facts);
    expect(v.map((x) => x.rule)).not.toContain("phone number");
  });

  it("does not mistake an address, a postcode or a year for a phone number", () => {
    // Seven digits is the floor for exactly this reason — anything lower and
    // "412 King Street, Newtown 2042" fails every page.
    const v = audit(page(`<p>412 King Street, Newtown 2042. Est 2042 members.</p>`), facts);
    expect(v.map((x) => x.rule)).not.toContain("phone number");
  });

  it("catches an invented email when none is on record", () => {
    const v = audit(page(`<a href="mailto:hello@albacoffee.com">hello@albacoffee.com</a>`), facts);
    expect(v.map((x) => x.rule)).toContain("email address");
  });

  it.each([
    ["★★★★★ from our customers", "ratings"],
    ["<h2>Testimonials</h2>", "reviews"],
    ["Serving Newtown since 1998", "trading history"],
    ["Over 20 years of experience", "years of experience"],
    ["An award-winning café", "awards"],
    ["Over 5,000 happy customers", "customer counts"],
    ["Flat white $4.50", "prices"],
    ["Fully licensed and insured", "credentials"],
    ["Book a free consultation", "free offers"],
    ["Satisfaction guaranteed", "guarantees"],
    ["A family-run café", "family claims"],
    ["Our team of expert baristas", "team claims"],
  ])("rejects %j as %s", (claim, rule) => {
    const v = audit(page(`<p>${claim}</p>`), facts);
    expect(v.map((x) => x.rule)).toContain(rule);
  });

  it("reads claims through the markup, not around it", () => {
    // A model that splits a rating across elements has still put the rating on
    // the page. Matching raw HTML would miss it.
    const v = audit(page(`<p>Rated <strong>4.8</strong> <span>out of 5</span></p>`), facts);
    expect(v.map((x) => x.rule)).toContain("ratings");
  });

  it("does not read the stylesheet as page copy", () => {
    // `content: "★"` in CSS would otherwise fail every page that uses a bullet.
    const html = page(`<p>A café on King Street.</p>`, `<style>.b::before{content:"★"}</style>`);
    expect(audit(html, facts).map((x) => x.rule)).not.toContain("ratings");
  });

  it("rejects anything executable", () => {
    const rules = (h: string) => audit(h, facts).map((x) => x.rule);
    expect(rules(page(`<script>alert(1)</script>`))).toContain("script");
    expect(rules(page(`<div onclick="go()">x</div>`))).toContain("event handler");
    expect(rules(page(`<a href="javascript:go()">x</a>`))).toContain("javascript: url");
    expect(rules(page(`<iframe src="https://www.openstreetmap.org/"></iframe>`))).toContain("iframe");
  });

  it("rejects a page that depends on the network to look right", () => {
    const rules = (h: string) => audit(h, facts).map((x) => x.rule);
    expect(rules(page("", `<link rel="stylesheet" href="https://fonts.googleapis.com/x">`)))
      .toContain("external stylesheet");
    expect(rules(page("", `<style>@import url(https://fonts.googleapis.com/x);</style>`)))
      .toContain("css import");
  });

  it("rejects a hotlink to a service that never agreed to serve it", () => {
    // A model asked for photographs reaches for Unsplash unprompted.
    const v = audit(page(`<img src="https://images.unsplash.com/photo-1">`), facts);
    expect(v.find((x) => x.rule === "external host")?.detail).toMatch(/images\.unsplash\.com/);
  });

  it("allows the hosts the page is actually given", () => {
    const html = page(
      `<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/a/b/c.jpg/1000px-c.jpg">
       <a href="https://www.openstreetmap.org/?mlat=-33.897&mlon=151.179">Directions</a>`,
    );
    expect(audit(html, facts).map((x) => x.rule)).not.toContain("external host");
  });

  it("rejects a stub, which is what a truncated response looks like", () => {
    const v = audit(`<!doctype html><html><head><style>a{}</style></head><body>hi</body></html>`, facts);
    expect(v.map((x) => x.rule)).toContain("length");
  });

  it("says nothing about a phone number on a page for a business without one", () => {
    const noPhone = spec({ phone: null }).facts;
    expect(audit(page(`<p>Find us on King Street.</p>`), noPhone)).toEqual([]);
  });
});

describe("assembling the model's output", () => {
  const s = spec();
  s.assets = {
    photos: [
      {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/b/c.jpg/1000px-c.jpg",
        width: 1000,
        height: 667,
        artist: "A Photographer",
        licence: "CC BY-SA 4.0",
        page: "https://commons.wikimedia.org/wiki/File:C.jpg",
        rank: 0,
      },
    ],
    map: { svg: `<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`, attribution: "© OpenStreetMap contributors" },
  };

  it("strips a markdown fence the model was told not to use", () => {
    const out = assemble("```html\n<!doctype html><html><body><p>hi</p></body></html>\n```", s);
    expect(out).not.toContain("```");
    expect(out.trimStart().startsWith("<!doctype html>")).toBe(true);
  });

  it("drops any preamble before the document", () => {
    const out = assemble("Here is the site you asked for:\n\n<!doctype html><html><body></body></html>", s);
    expect(out.trimStart().startsWith("<!doctype html>")).toBe(true);
  });

  it("puts the map where the token was", () => {
    const out = assemble(`<!doctype html><html><body><div class="frame">{{MAP}}</div></body></html>`, s);
    expect(out).not.toContain("{{MAP}}");
    expect(out).toMatch(/<div class="frame"><svg/);
  });

  it("adds the map anyway when the model forgets the token", () => {
    // The map is the only image on the page that is specifically this
    // business's. Losing it to a dropped token is losing the point.
    const out = assemble(`<!doctype html><html><body><p>no token here</p></body></html>`, s);
    expect(out).toContain("<svg");
  });

  it("forces noindex even when the model wrote the opposite", () => {
    const out = assemble(
      `<!doctype html><html><head><meta name="robots" content="index, follow"></head><body></body></html>`,
      s,
    );
    expect(out).not.toMatch(/content="index, follow"/);
    expect(out).toMatch(/name="robots" content="noindex, nofollow"/);
    expect(out.match(/name="robots"/g)?.length).toBe(1);
  });

  it("adds the draft banner whatever the model did", () => {
    const out = assemble(`<!doctype html><html><body><h1>Alba Coffee</h1></body></html>`, s);
    expect(out).toContain("not an official website");
  });

  it("credits the photographer and OpenStreetMap, which the licences require", () => {
    const out = assemble(`<!doctype html><html><body></body></html>`, s);
    expect(out).toContain("A Photographer");
    expect(out).toContain("CC BY-SA 4.0");
    expect(out).toContain("© OpenStreetMap contributors");
  });

  it("survives a document with no head or body to inject into", () => {
    // A truncated response still has to produce something that is not a
    // half-written page with a promise missing from it.
    const out = assemble(`<h1>Alba Coffee</h1>`, s);
    expect(out).toMatch(/name="robots"/);
    expect(out).toContain("not an official website");
    expect(out).toContain("© OpenStreetMap contributors");
  });

  it("escapes a business name carrying markup into the banner", () => {
    const evil = spec({ name: `Alba <img src=x onerror=alert(1)>` });
    evil.assets = s.assets;
    const out = assemble(`<!doctype html><html><body></body></html>`, evil);
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;img src=x");
  });
});

describe("art direction", () => {
  it("gives the same business the same brief every time", () => {
    expect(directionFor(spec()).name).toBe(directionFor(spec()).name);
  });

  it("spreads different businesses across different briefs", () => {
    // Asked the same open question twelve times a model converges, so the
    // brief is picked rather than left to the model.
    const names = ["Alba Coffee", "Barmuda", "Green Mushroom", "Mary's", "Washoku", "Lune", "Pico", "Everleigh"];
    const briefs = new Set(names.map((n) => directionFor(spec({ name: n })).name));
    expect(briefs.size).toBeGreaterThanOrEqual(3);
  });
});

describe("cost accounting", () => {
  it("prices a known model family", () => {
    const { usd, priced } = price("claude-sonnet-5", 1_000_000, 1_000_000);
    expect(priced).toBe(true);
    expect(usd).toBeCloseTo(18, 5);
  });

  it("matches on family prefix, so a point release is still priced", () => {
    expect(price("claude-sonnet-5-20260501", 1000, 0).priced).toBe(true);
  });

  it("reports an unknown model as unpriced instead of free", () => {
    // Silently reporting $0 for work that cost money is the one failure this
    // must never have.
    const { usd, priced } = price("some-future-model", 1_000_000, 1_000_000);
    expect(priced).toBe(false);
    expect(usd).toBe(0);
  });
});
