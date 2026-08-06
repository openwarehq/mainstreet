/**
 * Dumps the brief for named businesses, and caches their imagery.
 *
 *   npm run brief -- "Barmuda" "The Cutting Edge Hair Salon"
 *
 * The same facts, palette, art direction and assets the model would be handed —
 * written to `.briefs/<slug>.json` so a page can be designed against them and
 * assembled later without refetching photographs or re-rendering a map.
 */
import fs from "node:fs";
import path from "node:path";
import { discover } from "../src/lib/overpass";
import { rank } from "../src/lib/score";
import { buildSpec, collectAssets } from "../src/lib/spec";
import { directionFor } from "../src/lib/design";

const DIR = process.env.BRIEFS ?? path.join(process.cwd(), ".briefs");
const wanted = process.argv.slice(2);
if (!wanted.length) {
  console.error('usage: npm run brief -- "Business Name" ["Another"]');
  process.exit(1);
}

const found = await discover(process.env.AREA ?? "Newtown", [], 300);
const all = rank(found.prospects);
fs.mkdirSync(DIR, { recursive: true });

for (const name of wanted) {
  const p = all.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!p) {
    console.error(`not found: ${name}`);
    continue;
  }
  const spec = buildSpec(p);
  spec.assets = await collectAssets(spec);
  const direction = directionFor(spec);

  fs.writeFileSync(path.join(DIR, `${spec.slug}.json`), JSON.stringify(spec, null, 2));

  console.log(`\n${"═".repeat(76)}\n${spec.business}  →  ${spec.slug}\n${"═".repeat(76)}`);
  console.log(`brief      ${direction.name}`);
  console.log(`           ${direction.brief}`);
  const q = spec.palette;
  console.log(
    `palette    ${q.id} · ${q.dark ? "dark" : "light"} · radius ${q.radius}px\n` +
      `           bg ${q.bg}  surface ${q.surface}  raised ${q.raised}  line ${q.line}\n` +
      `           ink ${q.ink}  muted ${q.muted}  accent ${q.accent}  on-accent ${q.accentInk}  accent2 ${q.accent2}\n` +
      `           display ${q.display}\n           body    ${q.body}`,
  );
  console.log(`facts      ${JSON.stringify(spec.facts, null, 2).split("\n").join("\n           ")}`);
  console.log(
    `photos     ${spec.assets.photos.map((x, i) => `\n           ${i + 1}. ${x.width}×${x.height} ${x.artist} (${x.licence})\n              ${x.url}`).join("")}`,
  );
  console.log(`map        ${spec.assets.map ? "yes" : "none"}`);
}
