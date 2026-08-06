import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildQuery, parseElements, type Prospect } from "@/lib/overpass";
import { rank, scoreProspect } from "@/lib/score";
import { buildSpec, slugify } from "@/lib/spec";
import { renderSite } from "@/lib/render";

function prospect(over: Partial<Prospect> = {}): Prospect {
  return {
    id: "node/1",
    name: "Test Cafe",
    kind: "cafe",
    kindKey: "amenity",
    lat: -33.8971,
    lon: 151.1785,
    phone: null,
    email: null,
    website: null,
    street: "King Street",
    housenumber: "283",
    city: "Newtown",
    postcode: "2042",
    openingHours: "Mo-Fr 07:30-16:00",
    cuisine: null,
    facebook: null,
    instagram: null,
    ...over,
  };
}

describe("buildQuery", () => {
  it("uses nwr so ways and relations come back too", () => {
    // A high-street shop mapped as a building outline is a way; querying only
    // nodes silently loses a large share of the target.
    const q = buildQuery("Newtown");
    expect(q).toContain("nwr[");
    expect(q).not.toContain("node[");
  });

  it("neutralises a quote in the area name", () => {
    const q = buildQuery('Newtown"];out;//');
    expect(q.split("\n")[1]).not.toContain('"];out');
  });

  it("narrows to the requested categories only", () => {
    const q = buildQuery("Newtown", ["cafe"]);
    expect(q).toContain("cafe");
    expect(q).not.toContain("hairdresser");
  });
});

describe("parseElements", () => {
  it("reads a node", () => {
    const [p] = parseElements([
      { type: "node", id: 7, lat: 1, lon: 2, tags: { name: "A", amenity: "cafe" } },
    ]);
    expect(p.id).toBe("node/7");
    expect(p.kind).toBe("cafe");
  });

  it("reads a way through its center", () => {
    const [p] = parseElements([
      { type: "way", id: 9, center: { lat: 3, lon: 4 }, tags: { name: "B", shop: "bakery" } },
    ]);
    expect(p.lat).toBe(3);
    expect(p.kindKey).toBe("shop");
  });

  it("skips unnamed and uncategorised records", () => {
    expect(parseElements([{ type: "node", id: 1, lat: 1, lon: 2, tags: { amenity: "cafe" } }])).toHaveLength(0);
    expect(parseElements([{ type: "node", id: 1, lat: 1, lon: 2, tags: { name: "X" } }])).toHaveLength(0);
  });

  it("finds contact details under either tag spelling", () => {
    const [p] = parseElements([
      {
        type: "node", id: 1, lat: 1, lon: 2,
        tags: { name: "C", amenity: "cafe", "contact:phone": "123", "contact:website": "https://x.test" },
      },
    ]);
    expect(p.phone).toBe("123");
    expect(p.website).toBe("https://x.test");
  });
});

describe("scoring", () => {
  it("ranks a business with no website above one with a site", () => {
    const none = scoreProspect(prospect());
    const has = scoreProspect(prospect({ website: "https://real.example" }));
    expect(none.score).toBeGreaterThan(has.score);
    expect(none.reasons).toContain("no website");
  });

  it("treats a Facebook page as not having a site of their own", () => {
    const p = scoreProspect(prospect({ website: "https://facebook.com/place" }));
    expect(p.reasons).toContain("only a platform page");
    expect(p.score).toBeGreaterThan(0);
  });

  it("treats a delivery-app listing the same way", () => {
    expect(scoreProspect(prospect({ website: "https://ubereats.com/x" })).reasons).toContain(
      "only a platform page",
    );
  });

  it("rewards being contactable", () => {
    const withPhone = scoreProspect(prospect({ phone: "123" }));
    const without = scoreProspect(prospect());
    expect(withPhone.score).toBeGreaterThan(without.score);
  });

  it("keeps already-covered businesses in the list rather than hiding them", () => {
    // Dropping them would hide how the list was filtered.
    const out = rank([prospect({ website: "https://real.example" }), prospect({ id: "node/2" })]);
    expect(out).toHaveLength(2);
    expect(out[0].website).toBeNull();
  });
});

describe("slugify", () => {
  it("is url-safe and carries the osm id", () => {
    expect(slugify("Kelly's on King", "node/791362")).toBe("kelly-s-on-king-791362");
  });

  it("separates two businesses with the same name", () => {
    expect(slugify("Cafe", "node/111111")).not.toBe(slugify("Cafe", "node/222222"));
  });

  it("survives a name with no usable characters", () => {
    expect(slugify("!!!", "node/5")).toMatch(/^business-/);
  });
});

describe("buildSpec", () => {
  it("states only what the record contains", () => {
    const spec = buildSpec(scoreProspect(prospect()));
    const intro = spec.sections.find((s) => s.kind === "intro")!;
    const body = (intro as { body: string }).body;
    expect(body).toContain("Test Cafe");
    expect(body).toContain("Newtown");
    // The things that would make this a lie rather than a proposal.
    expect(body).not.toMatch(/since \d{4}|award|family-run|best|voted|years of/i);
  });

  it("is a draft until somebody says otherwise", () => {
    expect(buildSpec(scoreProspect(prospect())).draft).toBe(true);
  });

  it("carries the OpenStreetMap attribution ODbL requires", () => {
    expect(buildSpec(scoreProspect(prospect())).attribution).toMatch(/OpenStreetMap/);
  });

  it("omits the hours section when no hours are mapped", () => {
    const spec = buildSpec(scoreProspect(prospect({ openingHours: null })));
    expect(spec.sections.some((s) => s.kind === "hours")).toBe(false);
  });

  it("picks a palette from the category family", () => {
    expect(buildSpec(scoreProspect(prospect({ kind: "cafe" }))).palette.id).toBe("food");
    expect(buildSpec(scoreProspect(prospect({ kind: "plumber", kindKey: "craft" }))).palette.id).toBe("trades");
  });
});

describe("renderSite", () => {
  const spec = buildSpec(scoreProspect(prospect({ phone: "+61 2 9516 3341" })));
  const html = renderSite(spec);

  it("ships no script and no external stylesheet", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link[^>]+href="http/i);
  });

  it("renders the real hours it was given", () => {
    expect(html).toContain("07:30 – 16:00");
    expect(html).toContain("Closed");
  });

  it("marks a draft noindex so it cannot be found in search", () => {
    expect(html).toContain('content="noindex, nofollow"');
    expect(html).toContain("Draft proposal");
  });

  it("escapes a business name containing markup", () => {
    // Asserting on the absence of the substring "onerror=" would be wrong: it
    // survives inside `&lt;img src=x onerror=alert(1)&gt;`, which is inert text.
    // What matters is that no tag is formed.
    const nasty = buildSpec(scoreProspect(prospect({ name: "<img src=x onerror=alert(1)>" })));
    const out = renderSite(nasty);
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;img src=x");
  });

  it("drops a social value that carries its own scheme", () => {
    const s = buildSpec(scoreProspect(prospect({ facebook: "javascript:alert(1)" })));
    const contact = s.sections.find((x) => x.kind === "contact")!;
    expect((contact as { social: unknown[] }).social).toHaveLength(0);
    expect(renderSite(s)).not.toContain("javascript:");
  });

  it("turns a bare handle into a profile link", () => {
    const s = buildSpec(scoreProspect(prospect({ instagram: "@some.cafe" })));
    const contact = s.sections.find((x) => x.kind === "contact")!;
    expect((contact as { social: Array<{ href: string }> }).social[0].href).toBe(
      "https://instagram.com/some.cafe",
    );
  });

  it("never emits an executable href", () => {
    const s = buildSpec(scoreProspect(prospect({ facebook: "https://facebook.com/ok" })));
    const html = renderSite(s);
    expect(html).not.toMatch(/href="\s*javascript:/i);
    expect(html).not.toMatch(/href="\s*data:/i);
  });

  it("is responsive and declares a viewport", () => {
    expect(html).toContain("width=device-width");
    expect(html).toContain("@media (max-width:640px)");
  });
});

describe("the captured fixture", () => {
  const file = path.join(process.cwd(), "fixtures", "newtown.json");

  it("exists and holds real prospects", () => {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as { prospects: Prospect[] };
    expect(data.prospects.length).toBeGreaterThan(50);
  });

  it("stores no scores, so a ranking regression still shows up in tests", () => {
    const raw = fs.readFileSync(file, "utf8");
    expect(raw).not.toContain('"score"');
    expect(raw).not.toContain('"reasons"');
  });

  it("every fixture prospect specs and renders without throwing", () => {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as { prospects: Prospect[] };
    for (const p of data.prospects) {
      const html = renderSite(buildSpec(scoreProspect(p)));
      expect(html).toContain("<!doctype html>");
    }
  });
});


describe("a site with imagery attached", () => {
  // buildSpec is pure, so the earlier suite only ever renders the no-assets
  // path. These cover what a real generated site actually contains.
  const base = buildSpec(scoreProspect(prospect()));
  const withAssets = {
    ...base,
    assets: {
      photos: [
        {
          url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/b/X.jpg/1000px-X.jpg",
          width: 1000,
          height: 700,
          artist: "A Photographer",
          licence: "CC BY-SA 4.0",
          page: "https://commons.wikimedia.org/wiki/File:X.jpg",
        },
        {
          url: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/d/Y.jpg/1000px-Y.jpg",
          width: 1000,
          height: 700,
          artist: "B Photographer",
          licence: "CC BY 2.0",
          page: "https://commons.wikimedia.org/wiki/File:Y.jpg",
        },
        {
          url: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/f/Z.jpg/1000px-Z.jpg",
          width: 1000,
          height: 700,
          artist: "C Photographer",
          licence: "CC0",
          page: "https://commons.wikimedia.org/wiki/File:Z.jpg",
        },
      ],
      map: {
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AAAA"/></svg>',
        attribution: "© OpenStreetMap contributors",
      },
    },
  };
  const out = renderSite(withAssets);

  it("uses the first photograph as the hero", () => {
    expect(out).toContain("hero-photo");
    expect(out).toContain("1000px-X.jpg");
  });

  it("embeds the map rather than linking OpenStreetMap's tile servers", () => {
    // Linking tiles would mean every visitor to every generated site pulls from
    // donated infrastructure, which their usage policy asks you not to do.
    expect(out).toContain("data:image/png;base64");
    expect(out).not.toContain("tile.openstreetmap.org");
  });

  it("credits every photographer and licence, which CC-BY requires", () => {
    for (const name of ["A Photographer", "B Photographer", "C Photographer"]) {
      expect(out).toContain(name);
    }
    expect(out).toContain("CC BY-SA 4.0");
    expect(out).toContain("Wikimedia Commons");
  });

  it("still ships no JavaScript", () => {
    expect(out).not.toMatch(/<script/i);
  });

  it("lazy-loads the gallery but not the hero", () => {
    expect(out).toMatch(/fetchpriority="high"/);
    expect(out).toMatch(/loading="lazy"/);
  });

  it("renders the map even when no street address is mapped", () => {
    // The businesses with no address are the ones a map helps most; an earlier
    // version coupled the two and silently dropped the map for all of them.
    const noAddr = buildSpec(
      scoreProspect(prospect({ street: null, housenumber: null, city: null, postcode: null })),
    );
    const html2 = renderSite({ ...noAddr, assets: withAssets.assets });
    expect(html2).toContain("mapcard");
    expect(html2).toContain("data:image/png;base64");
  });
});
