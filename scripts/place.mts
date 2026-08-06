/**
 * Puts a designed page through the same gate a model's output goes through.
 *
 *   npm run place -- drafts/barmuda-253346.html
 *
 * Reads the cached brief for that slug, audits the page against its facts,
 * refuses it if anything is invented or executable, and only then assembles it
 * — map substituted, `noindex` forced, draft banner and credits injected — and
 * records it as a built site.
 *
 * The point is that the audit is not something the API path opts into. Any page
 * that reaches `sites/` has been through it, whoever wrote it.
 */
import fs from "node:fs";
import path from "node:path";
import { audit } from "../src/lib/audit";
import { assemble } from "../src/lib/design";
import { recordSite, writeSite } from "../src/lib/db";
import type { SiteSpec } from "../src/lib/spec";

const BRIEFS = process.env.BRIEFS ?? path.join(process.cwd(), ".briefs");
const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: npm run place -- drafts/<slug>.html [...]");
  process.exit(1);
}

let failed = 0;

for (const file of files) {
  const slug = path.basename(file).replace(/\.html$/, "");
  const briefFile = path.join(BRIEFS, `${slug}.json`);
  if (!fs.existsSync(briefFile)) {
    console.error(`${slug}: no brief — run \`npm run brief -- "<business>"\` first`);
    failed++;
    continue;
  }

  const spec = JSON.parse(fs.readFileSync(briefFile, "utf8")) as SiteSpec;
  const raw = fs.readFileSync(file, "utf8");

  const violations = audit(raw, spec.facts);
  if (violations.length) {
    console.error(`\n✗ ${spec.business} — rejected`);
    for (const v of violations) console.error(`    [${v.kind}] ${v.rule}: ${v.detail}`);
    failed++;
    continue;
  }

  const html = assemble(raw, spec);
  const bytes = writeSite(spec.slug, html);
  spec.design = { by: "claude", direction: process.env.DIRECTION ?? "hand", model: null, usd: 0, priced: true };
  recordSite(spec, bytes);

  console.log(
    `✓ ${spec.business.padEnd(30)} ${String(Math.round(bytes / 1000)).padStart(4)}KB  ` +
      `/api/site/${spec.slug}`,
  );
}

process.exit(failed ? 1 : 0);
