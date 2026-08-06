import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Scored } from "./score";
import type { SiteSpec } from "./spec";

/**
 * Everything the agency has found and built.
 *
 * Prospects are keyed on their OpenStreetMap id, so re-running discovery over
 * the same area updates what is there instead of piling up duplicates — an
 * operator will run the same suburb repeatedly and a list that doubles each
 * time is useless.
 */

export const SITES_DIR = process.env.MAINSTREET_SITES ?? path.join(process.cwd(), "sites");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const file = process.env.MAINSTREET_DB ?? path.join(process.cwd(), "mainstreet.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS prospects (
      id          TEXT PRIMARY KEY,
      area        TEXT NOT NULL,
      name        TEXT NOT NULL,
      kind        TEXT NOT NULL,
      score       INTEGER NOT NULL,
      has_site    INTEGER NOT NULL,
      data        TEXT NOT NULL,
      found_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sites (
      slug        TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL,
      business    TEXT NOT NULL,
      category    TEXT NOT NULL,
      spec        TEXT NOT NULL,
      bytes       INTEGER NOT NULL,
      built_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS prospects_score ON prospects (score DESC);
    CREATE INDEX IF NOT EXISTS sites_built ON sites (built_at DESC);
  `);

  // SQLite has no ADD COLUMN IF NOT EXISTS, and an existing database from
  // before the designer landed is the normal case rather than the exception —
  // the operator has already run the tool. Adding each column and ignoring the
  // duplicate-column error is the whole migration.
  for (const col of ["designer TEXT", "direction TEXT", "usd REAL"]) {
    try {
      db.exec(`ALTER TABLE sites ADD COLUMN ${col}`);
    } catch {
      /* already there */
    }
  }
  return db;
}

export function upsertProspects(area: string, scored: Scored[]): number {
  const stmt = getDb().prepare(
    `INSERT INTO prospects (id, area, name, kind, score, has_site, data, found_at)
     VALUES (@id, @area, @name, @kind, @score, @has_site, @data, @found_at)
     ON CONFLICT(id) DO UPDATE SET
       area=excluded.area, name=excluded.name, kind=excluded.kind,
       score=excluded.score, has_site=excluded.has_site, data=excluded.data`,
  );
  const now = Date.now();
  const run = getDb().transaction((rows: Scored[]) => {
    for (const p of rows) {
      stmt.run({
        id: p.id,
        area,
        name: p.name,
        kind: p.kind,
        score: p.score,
        has_site: p.website ? 1 : 0,
        data: JSON.stringify(p),
        found_at: now,
      });
    }
  });
  run(scored);
  return scored.length;
}

export type ProspectRow = {
  id: string;
  area: string;
  name: string;
  kind: string;
  score: number;
  has_site: number;
  data: string;
  found_at: number;
};

export function listProspects(limit = 200): Scored[] {
  const rows = getDb()
    .prepare(`SELECT data FROM prospects ORDER BY score DESC, name ASC LIMIT ?`)
    .all(limit) as Array<{ data: string }>;
  return rows.map((r) => JSON.parse(r.data) as Scored);
}

export function recordSite(spec: SiteSpec, bytes: number): void {
  getDb()
    .prepare(
      `INSERT INTO sites (slug, prospect_id, business, category, spec, bytes, built_at, designer, direction, usd)
       VALUES (@slug, @prospect_id, @business, @category, @spec, @bytes, @built_at, @designer, @direction, @usd)
       ON CONFLICT(slug) DO UPDATE SET
         spec=excluded.spec, bytes=excluded.bytes, built_at=excluded.built_at,
         designer=excluded.designer, direction=excluded.direction, usd=excluded.usd`,
    )
    .run({
      slug: spec.slug,
      prospect_id: spec.prospectId,
      business: spec.business,
      category: spec.categoryLabel,
      spec: JSON.stringify(spec),
      bytes,
      built_at: Date.now(),
      designer: spec.design?.by ?? "template",
      direction: spec.design?.direction ?? spec.palette.id,
      usd: spec.design?.usd ?? 0,
    });
}

export type SiteRow = {
  slug: string;
  prospect_id: string;
  business: string;
  category: string;
  bytes: number;
  built_at: number;
  designer: string | null;
  direction: string | null;
  usd: number | null;
};

export function listSites(limit = 100): SiteRow[] {
  return getDb()
    .prepare(
      `SELECT slug, prospect_id, business, category, bytes, built_at, designer, direction, usd
       FROM sites ORDER BY built_at DESC LIMIT ?`,
    )
    .all(limit) as SiteRow[];
}

export function builtProspectIds(): Set<string> {
  const rows = getDb().prepare(`SELECT prospect_id FROM sites`).all() as Array<{
    prospect_id: string;
  }>;
  return new Set(rows.map((r) => r.prospect_id));
}

export function stats() {
  const d = getDb();
  const one = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  return {
    prospects: one(`SELECT COUNT(*) n FROM prospects`),
    withoutSite: one(`SELECT COUNT(*) n FROM prospects WHERE has_site = 0`),
    built: one(`SELECT COUNT(*) n FROM sites`),
    areas: one(`SELECT COUNT(DISTINCT area) n FROM prospects`),
    bytes: (d.prepare(`SELECT COALESCE(SUM(bytes),0) n FROM sites`).get() as { n: number }).n,
    designed: one(`SELECT COUNT(*) n FROM sites WHERE designer = 'claude'`),
    usd: (d.prepare(`SELECT COALESCE(SUM(usd),0) n FROM sites`).get() as { n: number }).n,
  };
}

/** Writes the generated site to disk and returns its size. */
export function writeSite(slug: string, html: string): number {
  fs.mkdirSync(SITES_DIR, { recursive: true });
  const file = path.join(SITES_DIR, `${slug}.html`);
  fs.writeFileSync(file, html);
  return Buffer.byteLength(html);
}

export function readSite(slug: string): string | null {
  // The slug comes from a URL, so it is constrained rather than trusted.
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return null;
  try {
    return fs.readFileSync(path.join(SITES_DIR, `${slug}.html`), "utf8");
  } catch {
    return null;
  }
}
