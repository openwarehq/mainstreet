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
  beauty: ["hair salon", "barbershop interior"],
  trades: ["workshop tools", "carpenter workshop"],
  health: ["dental clinic", "medical clinic"],
  professional: ["office interior", "meeting room"],
  fitness: ["gym interior", "gym equipment"],
  retail: ["shop interior", "boutique interior"],
};

/**
 * Titles that mean "archive", not "photograph".
 *
 * Commons holds enormous quantities of scanned documents, museum artworks and
 * military records that match plain-language queries. A 1902 dental prospectus
 * is a fine scan and a terrible hero image.
 */
const REJECT =
  /\b(1[6-9]\d\d|19[0-5]\d)\b|\b(MET DP|museum|painting|drawing|engraving|lithograph|etching|poster|advertisement|announcement|catalogue?|prospectus|archive|navy|army|coat of arms|logo|diagram|blueprint|patent|manuscript|postcard|stamp|banknote)\b/i;

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
    "&generator=search&gsrnamespace=6&gsrlimit=50" +
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

async function fetchPool(family: string): Promise<Photo[]> {
  const terms = QUERIES[family] ?? QUERIES.retail;
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
    const artist = stripTags(em.Artist?.value ?? "").slice(0, 60) || "Unknown";
    const licence = stripTags(em.LicenseShortName?.value ?? "") || "see Commons";

    out.push({
      url: ii.thumburl,
      width: w,
      height: h,
      artist,
      licence,
      page: ii.descriptionurl ?? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}`,
    });
  }
  return out;
}

export function imagePool(family: string): Promise<Photo[]> {
  const hit = pools.get(family);
  if (hit) return hit;
  const p = fetchPool(family);
  pools.set(family, p);
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
