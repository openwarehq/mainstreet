/**
 * A real map of where the business actually is.
 *
 * This is the one image on the page that is genuinely, specifically theirs, and
 * it is the reason a generated site stops looking generic. Category photography
 * says "a café"; the map says "*this* café, on this corner".
 *
 * Tiles are fetched at build time and embedded as data URIs rather than being
 * linked. That is deliberate. OpenStreetMap's tile servers are donated
 * infrastructure with a usage policy that discourages bulk and automated use —
 * linking them would mean every visitor to every generated site pulls from
 * their servers forever. Fetching once per build and inlining the result is a
 * few hundred requests total instead of unbounded.
 */

export type StaticMap = {
  svg: string;
  attribution: string;
  /** Number of tiles that actually loaded, for the log. */
  tiles: number;
};

const AGENT = "mainstreet/1.0 (local business site generator)";
const TILE = 256;

/**
 * Tiles already fetched this process, keyed `z/x/y`.
 *
 * Businesses in one suburb overlap almost completely at zoom 16 — a whole run
 * of a high street shares a handful of tiles. Without this, a six-site run
 * asked for forty-eight tiles, OpenStreetMap throttled most of them, and four
 * of the six sites came out with no map at all. With it the same run needs
 * about a dozen distinct fetches.
 */
const tileCache = new Map<string, string | null>();

/**
 * OpenStreetMap's tile policy asks for no heavy parallel use. Two at a time is
 * polite and still fast enough, because the cache absorbs most of the work.
 */
const CONCURRENCY = 2;

export function clearTileCache(): void {
  tileCache.clear();
}

/** Slippy-map projection: longitude/latitude to fractional tile coordinates. */
export function project(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

async function fetchTileOnce(z: number, x: number, y: number): Promise<string | null> {
  try {
    const res = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
      headers: { "User-Agent": AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function fetchTile(z: number, x: number, y: number): Promise<string | null> {
  const key = `${z}/${x}/${y}`;
  const hit = tileCache.get(key);
  if (hit !== undefined) return hit;

  let data = await fetchTileOnce(z, x, y);
  if (!data) {
    // One retry after a pause. A throttled tile usually succeeds the second
    // time, and a map missing a quarter of itself is worse than a slow build.
    await new Promise((r) => setTimeout(r, 400));
    data = await fetchTileOnce(z, x, y);
  }
  tileCache.set(key, data);
  return data;
}

/** Runs jobs a few at a time rather than all at once. */
async function pooled<T>(jobs: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      out[i] = await jobs[i]();
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Builds an SVG map centred on the business, with a marker.
 *
 * `cols x rows` tiles are fetched around the centre and positioned so the exact
 * coordinate lands in the middle of the frame — the tile grid almost never
 * aligns with the point, so the whole group is offset by the sub-tile
 * remainder.
 */
export async function staticMap(
  lat: number,
  lon: number,
  opts: { zoom?: number; cols?: number; rows?: number; accent?: string } = {},
): Promise<StaticMap | null> {
  const zoom = opts.zoom ?? 16;
  const cols = opts.cols ?? 4;
  const rows = opts.rows ?? 2;
  const accent = opts.accent ?? "#e8a33d";

  const centre = project(lat, lon, zoom);
  const originX = Math.floor(centre.x) - Math.floor(cols / 2);
  const originY = Math.floor(centre.y) - Math.floor(rows / 2);

  const jobs: Array<() => Promise<{ col: number; row: number; data: string | null }>> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tx = originX + c;
      const ty = originY + r;
      const col = c;
      const row = r;
      jobs.push(async () => ({ col, row, data: await fetchTile(zoom, tx, ty) }));
    }
  }
  const results = await pooled(jobs, CONCURRENCY);
  const loaded = results.filter((t) => t.data);
  // A map missing most of its tiles looks broken; better to render no map and
  // let the layout close up around it.
  if (loaded.length < results.length / 2) return null;

  const width = cols * TILE;
  const height = rows * TILE;

  // Where the business sits inside the tile grid, in pixels.
  const px = (centre.x - originX) * TILE;
  const py = (centre.y - originY) * TILE;

  const images = loaded
    .map(
      (t) =>
        `<image x="${t.col * TILE}" y="${t.row * TILE}" width="${TILE}" height="${TILE}" href="${t.data}"/>`,
    )
    .join("");

  return {
    tiles: loaded.length,
    attribution: "© OpenStreetMap contributors",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Map of the location">
  <defs>
    <clipPath id="mclip"><rect width="${width}" height="${height}"/></clipPath>
    <radialGradient id="mfade" cx="50%" cy="50%" r="50%">
      <stop offset="70%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.30"/>
    </radialGradient>
  </defs>
  <g clip-path="url(#mclip)">
    ${images}
    <rect width="${width}" height="${height}" fill="url(#mfade)"/>
    <g transform="translate(${px.toFixed(1)} ${py.toFixed(1)})">
      <circle r="26" fill="${accent}" fill-opacity="0.20"/>
      <circle r="14" fill="${accent}" fill-opacity="0.35"/>
      <path d="M0 6 C -9 -4 -13 -9 -13 -15 A 13 13 0 0 1 13 -15 C 13 -9 9 -4 0 6 Z"
            fill="${accent}" stroke="#1a1510" stroke-width="1.5"/>
      <circle cy="-15" r="4.6" fill="#1a1510"/>
    </g>
  </g>
</svg>`,
  };
}
