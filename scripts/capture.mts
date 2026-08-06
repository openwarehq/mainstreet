/**
 * Captures a live Overpass result to a fixture.
 *
 *   npm run capture -- Newtown fixtures/newtown.json
 *
 * Overpass is run by volunteers and goes down; it went down between one command
 * and the next while these were being built. Capturing what a good run returned
 * means the next attempt does not depend on somebody else's free service being
 * healthy, and it is how `fixtures/newtown.json` was made in the first place.
 *
 * Scores are deliberately **not** stored. The fixture holds what OpenStreetMap
 * said and nothing this tool decided, so a change that breaks the ranking still
 * shows up in the tests rather than being baked into the input.
 */
import fs from "node:fs";
import path from "node:path";
import { discover } from "../src/lib/overpass";

const area = process.argv[2] ?? "Newtown";
const out = process.argv[3] ?? `fixtures/${area.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
const limit = Number(process.env.LIMIT ?? 400);

// One attempt is not enough against Overpass. Three, spaced out, usually is.
let found: Awaited<ReturnType<typeof discover>> | null = null;
for (let attempt = 1; attempt <= 3 && !found; attempt++) {
  try {
    found = await discover(area, [], limit);
  } catch (e) {
    console.error(`attempt ${attempt}: ${(e as Error).message}`);
    if (attempt < 3) await new Promise((r) => setTimeout(r, 20_000));
  }
}
if (!found) {
  console.error("\nOverpass would not answer. Nothing written — the existing fixture is untouched.");
  process.exit(1);
}

const fixture = {
  area,
  captured: new Date().toISOString().slice(0, 10),
  source: `Overpass (${found.endpoint})`,
  licence: "© OpenStreetMap contributors, ODbL",
  note: "Real captured data. No scores are stored, so a ranking regression still fails the tests.",
  prospects: found.prospects,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(fixture, null, 1));
console.log(
  `${found.prospects.length} businesses from ${found.endpoint} in ${(found.ms / 1000).toFixed(1)}s → ${out}`,
);
