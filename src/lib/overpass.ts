import fs from "node:fs";
import path from "node:path";

/**
 * Finds local businesses in OpenStreetMap.
 *
 * OSM is the right source for this and the others are not. Google Places needs
 * a billed key and its terms forbid storing most of what it returns; Yelp needs
 * a key and rate-limits hard. OSM is open data under ODbL, needs no key at all,
 * and — the part that matters — it records whether a business has a **website**.
 * A named business with a phone number and no `website` tag is precisely the
 * lead this tool exists to find.
 *
 * Attribution is required by ODbL and is rendered into every generated site.
 */

export type Prospect = {
  /** `node/123456` — stable across runs, so re-discovery updates rather than duplicates. */
  id: string;
  name: string;
  /** Raw OSM category value, e.g. `cafe`, `hairdresser`. */
  kind: string;
  /** Which OSM key it came from: `amenity`, `shop`, `craft`, `office`, `leisure`. */
  kindKey: string;
  lat: number;
  lon: number;
  phone: string | null;
  email: string | null;
  website: string | null;
  street: string | null;
  housenumber: string | null;
  city: string | null;
  postcode: string | null;
  openingHours: string | null;
  cuisine: string | null;
  /** Social links found on the record — often the only web presence they have. */
  facebook: string | null;
  instagram: string | null;
};

/** Categories worth a website, grouped by the OSM key they live under. */
export const CATEGORIES: Record<string, string[]> = {
  amenity: [
    "cafe", "restaurant", "fast_food", "bar", "pub", "ice_cream",
    "dentist", "doctors", "veterinary", "pharmacy", "childcare", "driving_school",
  ],
  shop: [
    "hairdresser", "beauty", "bakery", "butcher", "florist", "optician",
    "jewelry", "shoes", "clothes", "furniture", "hardware", "bicycle",
    "car_repair", "greengrocer", "tattoo", "massage", "pet",
  ],
  craft: [
    "plumber", "electrician", "carpenter", "painter", "roofer", "builder",
    "gardener", "locksmith", "photographer",
  ],
  leisure: ["fitness_centre", "sports_centre", "dance"],
  office: ["accountant", "lawyer", "estate_agent", "insurance", "architect"],
};

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
];

/**
 * Per-endpoint client timeout.
 *
 * The `[out:json][timeout:40]` in the query is the *server's* execution budget.
 * It says nothing about how long the request sits in the queue first, and under
 * load a mirror will happily hold the connection open for minutes before it
 * starts. Without a client timeout the whole run hangs on the first mirror and
 * the fallback to the second one — the entire reason there are two — never
 * happens. Measured: one Newtown query held for two full minutes.
 */
const PER_ENDPOINT_MS = 45_000;

/**
 * Builds the Overpass query.
 *
 * Searched by named area rather than a bounding box: an operator types
 * "Newtown", not four coordinates. Both nodes and ways are fetched with
 * `out center` because a business mapped as a building outline is a way, and
 * skipping ways loses a large share of the high-street shops that are exactly
 * the target.
 */
export function buildQuery(area: string, kinds: string[] = [], limit = 200): string {
  // Narrowing has to happen before the map, not inside it: filtering a list of
  // `T | null` still leaves the element type nullable as far as TypeScript is
  // concerned, and destructuring it in the next step fails to compile.
  const wanted: Array<[string, string[]]> = [];
  for (const [key, all] of Object.entries(CATEGORIES)) {
    const use = kinds.length > 0 ? all.filter((k) => kinds.includes(k)) : all;
    if (use.length) wanted.push([key, use]);
  }

  const clauses = wanted
    .map(([key, values]) => {
      const re = `^(${values.join("|")})$`;
      // `nwr` matches nodes, ways and relations in one statement. Emitting a
      // separate node[] and way[] clause per category doubles the statement
      // count, and Overpass is queue-limited by query cost — which is exactly
      // what makes the difference between a 30s answer and a timeout.
      return `  nwr["${key}"~"${re}"](area.a);`;
    })
    .join("\n");

  // The area name is quoted into the query, so a stray quote would break it.
  const safe = area.replace(/["\\\n]/g, " ").trim();

  return `[out:json][timeout:40];
area["name"="${safe}"]->.a;
(
${clauses}
);
out center ${limit};`;
}

function tag(tags: Record<string, string>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = tags[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function parseElements(elements: unknown[]): Prospect[] {
  const out: Prospect[] = [];
  for (const raw of elements) {
    const e = raw as {
      type?: string;
      id?: number;
      lat?: number;
      lon?: number;
      center?: { lat: number; lon: number };
      tags?: Record<string, string>;
    };
    const tags = e.tags ?? {};
    const name = tag(tags, "name");
    if (!name || !e.type || e.id == null) continue;

    // A way carries its position under `center`, a node carries it directly.
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat == null || lon == null) continue;

    let kindKey = "";
    let kind = "";
    for (const key of Object.keys(CATEGORIES)) {
      if (tags[key]) {
        kindKey = key;
        kind = tags[key];
        break;
      }
    }
    if (!kind) continue;

    out.push({
      id: `${e.type}/${e.id}`,
      name,
      kind,
      kindKey,
      lat,
      lon,
      phone: tag(tags, "phone", "contact:phone", "telephone"),
      email: tag(tags, "email", "contact:email"),
      website: tag(tags, "website", "contact:website", "url"),
      street: tag(tags, "addr:street"),
      housenumber: tag(tags, "addr:housenumber"),
      city: tag(tags, "addr:city", "addr:suburb"),
      postcode: tag(tags, "addr:postcode"),
      openingHours: tag(tags, "opening_hours"),
      cuisine: tag(tags, "cuisine"),
      facebook: tag(tags, "contact:facebook", "facebook"),
      instagram: tag(tags, "contact:instagram", "instagram"),
    });
  }
  return out;
}

export type DiscoverResult = {
  prospects: Prospect[];
  /** Which mirror answered, for the log. */
  endpoint: string;
  ms: number;
};

/**
 * Runs the query, falling back to the second mirror.
 *
 * Overpass is a volunteer-run service that returns 429 and 504 routinely under
 * load. One retry against a different mirror turns most of those into a result
 * instead of an error the operator has to think about.
 */
/**
 * Loads a captured fixture instead of calling Overpass.
 *
 * Overpass is run by volunteers and goes down. During this build both mirrors
 * timed out for twenty minutes straight, which is a normal Tuesday for it — and
 * a tool that can only be demonstrated when somebody else's free service is
 * healthy is not finished. `MAINSTREET_FIXTURE` points at real captured data so
 * the pipeline can be run, filmed and tested offline.
 *
 * The fixture stores raw prospects only. Scores are deliberately *not* stored,
 * so a change that breaks the ranking still shows up when tests run against it.
 */
function loadFixture(file: string): DiscoverResult {
  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw) as { prospects?: Prospect[] };
  return {
    prospects: parsed.prospects ?? [],
    endpoint: `fixture:${path.basename(file)}`,
    ms: 0,
  };
}

export async function discover(
  area: string,
  kinds: string[] = [],
  limit = 200,
): Promise<DiscoverResult> {
  const fixture = process.env.MAINSTREET_FIXTURE;
  if (fixture) return loadFixture(fixture);

  const query = buildQuery(area, kinds, limit);
  const started = Date.now();
  let lastError = "";

  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Overpass asks for a descriptive agent and throttles anonymous ones.
          "User-Agent": "mainstreet (local business site generator)",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(PER_ENDPOINT_MS),
      });
      if (!res.ok) {
        lastError = `${endpoint.split("/")[2]} returned ${res.status}`;
        continue;
      }
      const json = (await res.json()) as { elements?: unknown[] };
      return {
        prospects: parseElements(json.elements ?? []),
        endpoint: endpoint.split("/")[2],
        ms: Date.now() - started,
      };
    } catch (e) {
      const err = e as Error;
      lastError =
        err.name === "TimeoutError" || err.name === "AbortError"
          ? `${endpoint.split("/")[2]} did not respond within ${PER_ENDPOINT_MS / 1000}s`
          : err.message;
    }
  }

  throw new Error(
    `Overpass did not answer (${lastError}). It is a volunteer service that queues requests under load — try again in a minute, or narrow the area.`,
  );
}
