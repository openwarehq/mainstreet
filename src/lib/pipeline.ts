import { recordSite, upsertProspects, writeSite } from "./db";
import { discover } from "./overpass";
import { renderSite } from "./render";
import { rank, type Scored } from "./score";
import { buildSpec, collectAssets } from "./spec";

/**
 * Discover → score → spec → build, with no approval gate.
 *
 * The whole point of the tool is that nobody sits between finding a business
 * and having a site to show them. A queue that waits for a human to click
 * "approve spec" forty times is the thing this replaces, so the stages exist to
 * be *watched*, not to be gated.
 *
 * Every stage emits an event. The dashboard renders them as they arrive, which
 * is also how a long Overpass query stops looking like a hang.
 */

export type PipelineEvent =
  | { t: "started"; area: string; limit: number }
  | { t: "discovering"; area: string }
  | { t: "discovered"; found: number; endpoint: string; ms: number }
  | { t: "scored"; total: number; leads: number; skipped: number }
  | { t: "queued"; slugs: string[] }
  | { t: "spec"; slug: string; business: string; category: string; sections: number }
  | { t: "built"; slug: string; business: string; bytes: number; ms: number }
  | { t: "skipped"; business: string; why: string }
  | { t: "done"; built: number; ms: number }
  | { t: "failed"; message: string };

export type RunOptions = {
  area: string;
  /** How many sites to build this run. */
  build: number;
  /** Discovery ceiling; Overpass gets slower the higher this goes. */
  limit?: number;
  kinds?: string[];
  /** Build for businesses that already have a real site too. Off by default. */
  includeExisting?: boolean;
  /** Skip prospects already built. */
  skip?: Set<string>;
};

export async function* run(opts: RunOptions): AsyncGenerator<PipelineEvent> {
  const started = Date.now();
  const limit = opts.limit ?? 200;
  yield { t: "started", area: opts.area, limit };

  let scored: Scored[];
  try {
    yield { t: "discovering", area: opts.area };
    const found = await discover(opts.area, opts.kinds ?? [], limit);
    yield { t: "discovered", found: found.prospects.length, endpoint: found.endpoint, ms: found.ms };

    scored = rank(found.prospects);
    upsertProspects(opts.area, scored);
  } catch (e) {
    yield { t: "failed", message: (e as Error).message };
    return;
  }

  // A business that already runs a real site is not a lead. It stays in the
  // database so the operator can see the coverage of an area, but nothing gets
  // built for it unless they ask.
  const leads = scored.filter((p) => (opts.includeExisting ? true : !p.website || p.socialOnly));
  const skipped = scored.length - leads.length;
  yield { t: "scored", total: scored.length, leads: leads.length, skipped };

  const queue = leads.filter((p) => !opts.skip?.has(p.id)).slice(0, opts.build);
  const specs = queue.map(buildSpec);
  yield { t: "queued", slugs: specs.map((s) => s.slug) };

  let built = 0;
  for (const spec of specs) {
    const t0 = Date.now();
    yield {
      t: "spec",
      slug: spec.slug,
      business: spec.business,
      category: spec.categoryLabel,
      sections: spec.sections.length,
    };

    try {
      // Imagery is fetched per site. The category pool is cached across the run,
      // so this is one map fetch each after the first site of a category.
      spec.assets = await collectAssets(spec);
      const html = renderSite(spec);
      const bytes = writeSite(spec.slug, html);
      recordSite(spec, bytes);
      built++;
      yield { t: "built", slug: spec.slug, business: spec.business, bytes, ms: Date.now() - t0 };
    } catch (e) {
      // One business failing to render must not end the run — the operator
      // wants the other thirty-nine.
      yield { t: "skipped", business: spec.business, why: (e as Error).message };
    }
  }

  yield { t: "done", built, ms: Date.now() - started };
}
