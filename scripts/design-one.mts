/**
 * Designs one site and writes it, so the Claude path can be checked in one
 * command without running a whole discovery pass.
 *
 *   npm run design:one -- "Alba Coffee" cafe
 *
 * Exists because every other failure in this pipeline is loud and this one is
 * not: a rejected key, a model id that is not on the account, or a page that
 * keeps failing the fact audit all look identical from the dashboard — sites
 * appear, they are just plainer than expected.
 */
import fs from "node:fs";
import path from "node:path";
import { designSite, designerAvailable, DesignRejected } from "../src/lib/design";
import { scoreProspect } from "../src/lib/score";
import { buildSpec, collectAssets } from "../src/lib/spec";
import type { Prospect } from "../src/lib/overpass";

const name = process.argv[2] ?? "Alba Coffee";
const kind = process.argv[3] ?? "cafe";
const out = process.env.OUT ?? path.join(process.cwd(), "sites");

if (!designerAvailable()) {
  console.error(
    process.env.ANTHROPIC_API_KEY
      ? "MAINSTREET_DESIGN=off — unset it to let Claude design."
      : "No ANTHROPIC_API_KEY. Put it in .env.local:\n\n  ANTHROPIC_API_KEY=sk-ant-...\n",
  );
  process.exit(1);
}

const prospect: Prospect = {
  id: "node/1",
  name,
  kind,
  kindKey: "amenity",
  lat: -33.8974,
  lon: 151.1794,
  phone: "+61 2 9516 3341",
  email: null,
  website: null,
  street: "King Street",
  housenumber: "412",
  city: "Newtown",
  postcode: "2042",
  openingHours: "Mo-Fr 07:30-16:00; Sa-Su 08:00-15:00",
  cuisine: null,
  facebook: null,
  instagram: null,
};

const spec = buildSpec(scoreProspect(prospect));
console.log(`${spec.business} — ${spec.palette.id}, radius ${spec.palette.radius}px`);

spec.assets = await collectAssets(spec);
console.log(`assets: ${spec.assets.photos.length} photographs, map ${spec.assets.map ? "yes" : "no"}`);

try {
  const d = await designSite(spec);
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `${spec.slug}.html`);
  fs.writeFileSync(file, d.html);
  console.log(
    `\n${d.model} · brief "${d.direction}" · ${d.inputTokens} in / ${d.outputTokens} out · ` +
      `${d.priced ? `$${d.usd.toFixed(4)}` : "unpriced model"} · ${(d.ms / 1000).toFixed(1)}s` +
      (d.attempts > 1 ? `\nrewritten once — first attempt broke: ${d.repaired.map((v) => v.rule).join(", ")}` : ""),
  );
  console.log(`\nwrote ${file} (${Math.round(Buffer.byteLength(d.html) / 1000)}KB)`);
} catch (e) {
  if (e instanceof DesignRejected) {
    console.error("\nthe page failed the fact audit twice:");
    for (const v of e.violations) console.error(`  [${v.kind}] ${v.rule}: ${v.detail}`);
  } else {
    console.error(`\n${(e as Error).message}`);
  }
  process.exit(1);
}
