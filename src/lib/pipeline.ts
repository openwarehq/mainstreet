import { recordSite, upsertProspects, writeSite } from "./db";
import { designerAvailable, designSite, DesignRejected, directionFor } from "./design";
import { discover } from "./overpass";
import { renderSite } from "./render";
import { rank, type Scored } from "./score";
import { buildSpec, collectAssets } from "./spec";

/**
 * Discover → score → design → build, with no approval gate.
 *
 * The whole point of the tool is that nobody sits between finding a business
 * and having a site to show them. A queue that waits for a human to click
 * "approve spec" forty times is the thing this replaces, so the stages exist to
 * be *watched*, not to be gated.
 *
 * Every stage emits an event. The dashboard renders them as they arrive, which
 * is also how a long Overpass query — or a model writing four hundred lines of
 * HTML — stops looking like a hang.
 */

export type PipelineEvent =
  | { t: "started"; area: string; limit: number }
  | { t: "designer"; mode: "claude" | "template"; model: string; note: string }
  | { t: "discovering"; area: string }
  | { t: "discovered"; found: number; endpoint: string; ms: number }
  | { t: "scored"; total: number; leads: number; skipped: number }
  | { t: "queued"; slugs: string[] }
  | { t: "spec"; slug: string; business: string; category: string; sections: number }
  | { t: "designing"; slug: string; business: string; direction: string; palette: string }
  | {
      t: "designed";
      slug: string;
      business: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      usd: number;
      priced: boolean;
      ms: number;
      attempts: number;
      /** Rules the first attempt broke, if it took a rewrite. */
      repaired: string[];
    }
  | { t: "fellback"; slug: string; business: string; why: string }
  | { t: "built"; slug: string; business: string; bytes: number; ms: number; by: "claude" | "template" }
  | { t: "skipped"; business: string; why: string }
  | { t: "done"; built: number; ms: number; usd: number; tokens: number; priced: boolean }
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
  /** Force the template renderer even when a key is configured. */
  template?: boolean;
};

/**
 * How many sites are designed at once.
 *
 * Each one is a model call that runs for the better part of a minute, so
 * building eight one after another is eight minutes of watching a spinner.
 * Three at a time keeps a run of forty inside a coffee break without pushing
 * a per-minute token limit, which is the thing that would turn a batch into a
 * cascade of 429s.
 */
const DESIGN_CONCURRENCY = 3;

/**
 * A queue the workers push into and the generator drains.
 *
 * `yield` cannot cross a callback boundary, so a pool of concurrent workers
 * cannot yield events directly. This is the smallest thing that lets three
 * sites be designed at once while the dashboard still sees each event the
 * moment it happens rather than at the end of a batch.
 */
class EventQueue<T> {
  private items: T[] = [];
  private waiting: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    const w = this.waiting.shift();
    if (w) w({ value, done: false });
    else this.items.push(value);
  }

  close(): void {
    this.closed = true;
    for (const w of this.waiting.splice(0)) w({ value: undefined as never, done: true });
  }

  async *drain(): AsyncGenerator<T> {
    for (;;) {
      const next = this.items.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.closed) return;
      const r = await new Promise<IteratorResult<T>>((res) => this.waiting.push(res));
      if (r.done) return;
      yield r.value;
    }
  }
}

export async function* run(opts: RunOptions): AsyncGenerator<PipelineEvent> {
  const started = Date.now();
  const limit = opts.limit ?? 200;
  yield { t: "started", area: opts.area, limit };

  const useClaude = !opts.template && designerAvailable();
  yield {
    t: "designer",
    mode: useClaude ? "claude" : "template",
    model: useClaude ? (process.env.MAINSTREET_MODEL ?? "claude-sonnet-5") : "built-in renderer",
    note: useClaude
      ? "Claude writes each page from the verified facts; every page is audited before it is saved."
      : process.env.ANTHROPIC_API_KEY
        ? "Design is switched off — MAINSTREET_DESIGN=off."
        : "No ANTHROPIC_API_KEY, so the built-in renderer is building the sites.",
  };

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

  const events = new EventQueue<PipelineEvent>();
  let built = 0;
  let usd = 0;
  let tokens = 0;
  let priced = true;

  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= specs.length) return;
      const spec = specs[i];
      const t0 = Date.now();

      events.push({
        t: "spec",
        slug: spec.slug,
        business: spec.business,
        category: spec.categoryLabel,
        sections: spec.sections.length,
      });

      try {
        // Imagery is fetched per site. The category pool is cached across the
        // run, so this is one map fetch each after the first of a category.
        spec.assets = await collectAssets(spec);

        let html: string | null = null;
        let by: "claude" | "template" = "template";

        if (useClaude) {
          events.push({
            t: "designing",
            slug: spec.slug,
            business: spec.business,
            direction: directionFor(spec).name,
            palette: spec.palette.id,
          });
          try {
            const d = await designSite(spec);
            html = d.html;
            by = "claude";
            spec.design = {
              by: "claude",
              direction: d.direction,
              model: d.model,
              usd: d.usd,
              priced: d.priced,
            };
            usd += d.usd;
            tokens += d.inputTokens + d.outputTokens;
            priced = priced && d.priced;
            events.push({
              t: "designed",
              slug: spec.slug,
              business: spec.business,
              model: d.model,
              inputTokens: d.inputTokens,
              outputTokens: d.outputTokens,
              usd: d.usd,
              priced: d.priced,
              ms: d.ms,
              attempts: d.attempts,
              repaired: d.repaired.map((v) => v.rule),
            });
          } catch (e) {
            // The design is the nice-to-have; the site is not. A page that
            // failed the fact audit, or a model call that failed outright,
            // drops to the renderer rather than losing the business.
            const why =
              e instanceof DesignRejected
                ? `failed the fact audit: ${e.violations.map((v) => v.rule).join(", ")}`
                : (e as Error).message;
            events.push({ t: "fellback", slug: spec.slug, business: spec.business, why });
          }
        }

        if (html === null) {
          html = renderSite(spec);
          spec.design = { by: "template", direction: spec.palette.id, model: null, usd: 0, priced: true };
        }

        const bytes = writeSite(spec.slug, html);
        recordSite(spec, bytes);
        built++;
        events.push({
          t: "built",
          slug: spec.slug,
          business: spec.business,
          bytes,
          ms: Date.now() - t0,
          by,
        });
      } catch (e) {
        // One business failing to render must not end the run — the operator
        // wants the other thirty-nine.
        events.push({ t: "skipped", business: spec.business, why: (e as Error).message });
      }
    }
  };

  const pool = Array.from({ length: Math.min(useClaude ? DESIGN_CONCURRENCY : 1, specs.length) }, worker);
  void Promise.all(pool).then(() => events.close());

  for await (const e of events.drain()) yield e;

  yield { t: "done", built, ms: Date.now() - started, usd, tokens, priced };
}
