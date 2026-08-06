/**
 * Real photography, from Wikimedia Commons.
 *
 * Commons is the only large image source that needs no key, licenses
 * everything for reuse, and ships machine-readable attribution. That last part
 * is what makes it usable: CC-BY and CC-BY-SA require crediting the
 * photographer, and a generator that cannot produce a credit line cannot
 * legally use the image.
 *
 * These are **not photographs of the business.** Nobody has those. They are
 * category photography — what a café counter or a salon floor looks like —
 * which is exactly what a designer would drop into a pitch deck as a mood
 * image. The draft banner on every page says the details are unconfirmed, and
 * the credit line names the photographer and the licence.
 */

export type Photo = {
  /** Commons thumbnail URL. Its width segment can be rewritten — see `thumbAt`. */
  url: string;
  width: number;
  height: number;
  artist: string;
  licence: string;
  page: string;
  /** Higher is better: Commons peer review, then how recent it is. */
  rank: number;
};

const AGENT = "mainstreet/1.0 (local business site generator)";

/**
 * Search terms per category family — two words, and no more.
 *
 * Commons ANDs every term in a query. "modern medical clinic waiting room"
 * matches nothing at all, and the first version of this file shipped five-word
 * queries that returned **zero results for four of the seven families** while
 * looking like a filtering problem. Two words return around fifty hits with
 * forty usable; each extra word roughly halves that.
 *
 * Two queries per family, merged, so neighbouring businesses can be given
 * visibly different photographs.
 */
const QUERIES: Record<string, string[]> = {
  food: ["cafe interior", "restaurant interior"],
  beauty: ["hair salon", "beauty salon"],
  trades: ["carpentry workshop", "auto repair"],
  health: ["dental clinic", "medical clinic"],
  // "office interior" returns post offices and state buildings almost to the
  // exclusion of anything a small practice would recognise.
  professional: ["coworking space", "conference room"],
  fitness: ["gym interior", "gym equipment"],
  retail: ["boutique interior", "clothing store"],
};

/**
 * Overrides for the kinds a family query gets visibly wrong.
 *
 * Seven families is the right grain for palettes and the wrong grain for
 * photography: a **pharmacy** sits in `health`, so it was being given photos of
 * dental surgeries — chairs, drills, a hygienist's tray. Close enough to pass a
 * filter, nowhere near close enough to put on the page.
 *
 * Only the kinds where the family term is actually misleading are listed. The
 * rest inherit, because a bespoke query per category is a hundred queries to
 * keep working and the family term is genuinely fine for most of them.
 */
const KIND_QUERIES: Record<string, string[]> = {
  pharmacy: ["pharmacy interior", "drugstore interior"],
  veterinary: ["veterinary clinic", "animal hospital"],
  optician: ["optician shop", "eyewear store"],
  bakery: ["bakery interior", "bakery shop"],
  butcher: ["butcher shop", "butchery interior"],
  greengrocer: ["greengrocer shop", "vegetable market"],
  pub: ["pub interior", "bar interior"],
  bar: ["bar interior", "cocktail bar"],
  florist: ["flower shop", "florist shop"],
  jewelry: ["jewellery shop", "jewelry store"],
  bicycle: ["bicycle shop", "bike workshop"],
  pet: ["pet shop", "pet store"],
  car_repair: ["auto repair", "car workshop"],
  hardware: ["hardware store", "tool shop"],
  tattoo: ["tattoo studio", "tattoo parlour"],
  dance: ["dance studio", "ballet studio"],
  photographer: ["photography studio", "photo studio"],
  lawyer: ["law library", "conference room"],
  childcare: ["kindergarten classroom", "nursery classroom"],
};

/** The search terms for a category, most specific first. */
export function queriesFor(kind: string, family: string): string[] {
  return KIND_QUERIES[kind] ?? QUERIES[family] ?? QUERIES.retail;
}

/**
 * Titles that mean "archive", not "photograph".
 *
 * Commons holds enormous quantities of scanned documents, museum artworks and
 * military records that match plain-language queries. A 1902 dental prospectus
 * is a fine scan and a terrible hero image.
 */
const REJECT =
  /\b(1[6-9]\d\d|19[0-5]\d)\b|\b(MET DP|museum|painting|drawing|engraving|lithograph|etching|poster|advertisement|announcement|catalogue?|prospectus|archive|navy|army|coat of arms|logo|diagram|blueprint|patent|manuscript|postcard|stamp|banknote)\b/i;

/**
 * Categories that mean the photograph is a historical document.
 *
 * The title filter alone was not enough, and the way that showed up was a
 * generated café opening on a **black-and-white photograph of a 1970s Hungarian
 * dining room** — filename `Restaurant, interior Fortepan 17198.jpg`, which
 * carries no year and reads as a perfectly ordinary result. Commons' own
 * category strings say what the filename does not.
 */
const REJECT_CATEGORY =
  /\b(fortepan|black[- ]and[- ]white|monochrome|paintings?|drawings?|engravings?|lithographs?|postcards?|pd-old|public domain|historical|19\d\d in|18\d\d)\b/i;

/**
 * The year the photograph was taken, from Exif where Commons has it.
 *
 * This is the strongest quality signal available without looking at pixels: a
 * "café interior" from 1958 is a fine photograph and the wrong one to open a
 * pitch with. `circa 1879` and similar prose forms parse to their year and are
 * rejected on the same rule.
 */
function shotYear(value: string | undefined): number | null {
  if (!value) return null;
  const m = stripTags(value).match(/\b(1[6-9]\d\d|20\d\d)\b/);
  return m ? Number(m[1]) : null;
}

/** The earliest a photograph can be and still look like a working business. */
const OLDEST = 2008;

/** Commons search returns a page per file; this is the shape we use. */
type CommonsPage = {
  title?: string;
  imageinfo?: Array<{
    thumburl?: string;
    thumbwidth?: number;
    thumbheight?: number;
    width?: number;
    height?: number;
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: string }>;
  }>;
};

const stripTags = (s: string) => s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

/**
 * A pool of usable photos for a category, fetched once per process.
 *
 * Cached because every café in a suburb would otherwise fire the same search.
 * The pool is deliberately larger than any one site needs, so two cafés on the
 * same street can be given different photographs — twelve identical hero images
 * in a row is the thing that makes a batch look generated.
 */
const pools = new Map<string, Promise<Photo[]>>();

export function clearImageCache(): void {
  pools.clear();
}

async function searchCommons(term: string): Promise<CommonsPage[]> {
  const url =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*" +
    "&generator=search&gsrnamespace=6&gsrlimit=100" +
    `&gsrsearch=${encodeURIComponent(`filetype:bitmap ${term}`)}` +
    // The width is requested here rather than rewritten in the URL afterwards.
    // Commons only serves thumbnail sizes it has actually generated: asking for
    // `/900px-` on a file whose thumb was made at 1920 returns a **400**, on
    // purpose, to stop thumbnail-bombing. Every width but the generated one
    // failed when this was tried.
    "&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1000";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": AGENT },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } };
    return Object.values(json.query?.pages ?? {});
  } catch {
    // No photography is a supported outcome — the page falls back to generated
    // artwork rather than failing to build.
    return [];
  }
}

async function fetchPool(key: string, terms: string[]): Promise<Photo[]> {
  const batches = await Promise.all(terms.map(searchCommons));
  const pages = batches.flat();
  const out: Photo[] = [];
  const seen = new Set<string>();

  for (const p of pages) {
    const title = (p.title ?? "").replace(/^File:/, "");
    if (REJECT.test(title)) continue;

    const ii = p.imageinfo?.[0];
    if (!ii?.thumburl) continue;

    if (seen.has(ii.thumburl)) continue;
    seen.add(ii.thumburl);

    const w = ii.thumbwidth ?? 0;
    const h = ii.thumbheight ?? 0;
    if (w < 800) continue;

    // Landscape only. A portrait photo in a full-bleed hero crops to somebody's
    // elbow.
    const ratio = w / Math.max(1, h);
    if (ratio < 1.1 || ratio > 2.6) continue;

    const em = ii.extmetadata ?? {};
    const categories = stripTags(em.Categories?.value ?? "");
    if (REJECT_CATEGORY.test(categories)) continue;

    // No date at all is allowed through — plenty of good modern uploads have
    // stripped Exif — but a date that *is* there and is old is disqualifying.
    const year = shotYear(em.DateTimeOriginal?.value) ?? shotYear(em.DateTime?.value);
    if (year !== null && year < OLDEST) continue;

    const artist = stripTags(em.Artist?.value ?? "").slice(0, 60) || "Unknown";
    const licence = stripTags(em.LicenseShortName?.value ?? "") || "see Commons";

    // Commons runs its own peer review. "Quality images" and "Featured
    // pictures" are the categories that survive it, and they are by a wide
    // margin the best-looking things a keyless search can reach.
    const reviewed = /\b(quality images|featured pictures|valued images)\b/i.test(categories);
    const rank = (reviewed ? 4 : 0) + (year && year >= 2015 ? 2 : year ? 1 : 0);

    out.push({
      url: ii.thumburl,
      width: w,
      height: h,
      artist,
      licence,
      page: ii.descriptionurl ?? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}`,
      rank,
    });
  }

  // Best first, so `pickPhotos` is choosing between good photographs rather
  // than across the whole spread of what a plain search returns.
  return out.sort((a, b) => b.rank - a.rank);
}

/**
 * The pool for a category, fetched once per process.
 *
 * Keyed on the terms rather than the family, so the kinds that override their
 * family query get their own pool and the ones that inherit still share.
 */
export function imagePool(kind: string, family: string): Promise<Photo[]> {
  const terms = queriesFor(kind, family);
  const key = terms.join("|");
  const hit = pools.get(key);
  if (hit) return hit;
  const p = fetchPool(key, terms);
  pools.set(key, p);
  return p;
}

/** Deterministic hash, so a business always gets the same photographs. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Picks `count` distinct photos for one business.
 *
 * Offset by a hash of the name rather than taken from the top, so neighbouring
 * businesses in the same category get different images while any single
 * business keeps the same ones every time it is regenerated.
 */
export function pickPhotos(pool: Photo[], seed: string, count: number): Photo[] {
  if (!pool.length) return [];
  const start = hash(seed) % pool.length;
  const out: Photo[] = [];
  for (let i = 0; i < pool.length && out.length < count; i++) {
    out.push(pool[(start + i) % pool.length]);
  }
  return out;
}
