import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { designSite, DesignRejected } from "../src/lib/design";
import { scoreProspect } from "../src/lib/score";
import { buildSpec, type SiteSpec } from "../src/lib/spec";
import type { Prospect } from "../src/lib/overpass";

/**
 * The design loop, end to end, against a local stand-in for the API.
 *
 * Everything between "send the prompt" and "write the file" is where this can
 * go wrong in ways nothing else catches: the prefill has to be stitched back
 * onto the front of the response, a rejected page has to be *rewritten* rather
 * than patched, a rate limit has to be retried, and a second failure has to
 * surface as a fallback rather than a lost business.
 *
 * None of that can be tested against the real API without paying to fail, so
 * the endpoint is pointed at a server here that returns whatever the case
 * needs. What is deliberately *not* tested is whether the page looks good —
 * that is the one thing only the real model can answer.
 */

type Handler = (body: any, callNumber: number) => { status: number; json: any };

let server: http.Server;
let calls: any[] = [];
let handler: Handler;

const reply = (text: string, over: Record<string, unknown> = {}) => ({
  status: 200,
  json: {
    model: "claude-sonnet-5",
    content: [{ type: "text", text }],
    usage: { input_tokens: 1200, output_tokens: 3400 },
    ...over,
  },
});

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      calls.push({ url: req.url, headers: req.headers, body });
      const out = handler(body, calls.length);
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(JSON.stringify(out.json));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
});

afterAll(() => {
  server.close();
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
});

const prospect: Prospect = {
  id: "node/1",
  name: "Alba Coffee",
  kind: "cafe",
  kindKey: "amenity",
  lat: -33.897,
  lon: 151.179,
  phone: "+61 2 9516 3341",
  email: null,
  website: null,
  street: "King Street",
  housenumber: "412",
  city: "Newtown",
  postcode: "2042",
  openingHours: "Mo-Fr 07:30-16:00",
  cuisine: null,
  facebook: null,
  instagram: null,
};

function fixture(): SiteSpec {
  const spec = buildSpec(scoreProspect(prospect));
  spec.assets = {
    photos: [
      {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/b/c.jpg/1000px-c.jpg",
        width: 1000,
        height: 667,
        artist: "A Photographer",
        licence: "CC BY-SA 4.0",
        page: "https://commons.wikimedia.org/wiki/File:C.jpg",
        rank: 4,
      },
    ],
    map: {
      svg: `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>`,
      attribution: "© OpenStreetMap contributors",
    },
  };
  return spec;
}

const body = "<p>A café on King Street, Newtown. Open Monday to Friday.</p>".repeat(80);
const CLEAN = `<html lang="en"><head><meta charset="utf-8"><title>Alba Coffee — Café in Newtown</title>
<style>:root{--bg:#111}</style></head><body><h1>Alba Coffee</h1>{{MAP}}${body}</body></html>`;
const LYING = `<html lang="en"><head><meta charset="utf-8"><title>Alba Coffee</title>
<style>a{}</style></head><body><h1>Alba Coffee</h1><p>★★★★★ — serving Newtown since 1998.</p>
<a href="tel:0298887777">02 9888 7777</a>{{MAP}}${body}</body></html>`;

describe("the design loop", () => {
  beforeAll(() => {
    calls = [];
  });

  it("sends what the API expects and stitches the prefill back on", async () => {
    calls = [];
    handler = () => reply(CLEAN);
    const d = await designSite(fixture());

    const [call] = calls;
    expect(call.url).toBe("/v1/messages");
    expect(call.headers["x-api-key"]).toBe("sk-ant-test");
    expect(call.headers["anthropic-version"]).toBe("2023-06-01");
    expect(call.body.system).toMatch(/YOU ONLY KNOW WHAT YOU ARE TOLD/);
    // The prefill is an assistant turn, and the API does not echo it back — so
    // the document would otherwise begin at "<html", with no doctype.
    expect(call.body.messages.at(-1)).toEqual({ role: "assistant", content: "<!doctype html>" });
    expect(d.html.startsWith("<!doctype html>")).toBe(true);
    expect(d.attempts).toBe(1);
  });

  it("briefs the model with the facts and nothing else", async () => {
    calls = [];
    handler = () => reply(CLEAN);
    await designSite(fixture());
    const prompt = calls[0].body.messages[0].content as string;
    expect(prompt).toContain("Alba Coffee");
    expect(prompt).toContain("+61 2 9516 3341");
    expect(prompt).toContain("412 King Street");
    expect(prompt).toMatch(/Email: none on record/);
    expect(prompt).toContain("upload.wikimedia.org");
  });

  it("accounts for the tokens it actually used", async () => {
    calls = [];
    handler = () => reply(CLEAN);
    const d = await designSite(fixture());
    expect(d.inputTokens).toBe(1200);
    expect(d.outputTokens).toBe(3400);
    expect(d.priced).toBe(true);
    expect(d.usd).toBeCloseTo((1200 * 3 + 3400 * 15) / 1_000_000, 8);
  });

  it("counts an unpriced model's tokens rather than reporting it free", async () => {
    calls = [];
    handler = () => reply(CLEAN, { model: "claude-experimental-9" });
    const d = await designSite(fixture());
    expect(d.priced).toBe(false);
    expect(d.outputTokens).toBe(3400);
  });

  it("hands the violations back and takes the rewrite", async () => {
    calls = [];
    handler = (_b, n) => reply(n === 1 ? LYING : CLEAN);
    const d = await designSite(fixture());

    expect(d.attempts).toBe(2);
    expect(d.repaired.map((v) => v.rule)).toEqual(
      expect.arrayContaining(["ratings", "trading history", "phone number"]),
    );
    // The retry has to carry the reasons, or it is just a second roll of the
    // dice at the same odds.
    const retry = calls[1].body.messages[0].content as string;
    expect(retry).toMatch(/previous attempt was rejected/);
    expect(retry).toMatch(/phone number/);
    // And the page that ships is the rewritten one, not the patched original.
    expect(d.html).not.toContain("★★★★★");
    expect(d.html).not.toContain("9888 7777");
    expect(d.inputTokens).toBe(2400);
  });

  it("gives up rather than shipping a page that keeps lying", async () => {
    calls = [];
    handler = () => reply(LYING);
    await expect(designSite(fixture())).rejects.toBeInstanceOf(DesignRejected);
    expect(calls).toHaveLength(2);
  });

  it("retries a rate limit instead of losing the business", async () => {
    calls = [];
    handler = (_b, n) =>
      n === 1 ? { status: 429, json: { error: "rate_limit" } } : reply(CLEAN);
    const d = await designSite(fixture());
    expect(calls).toHaveLength(2);
    expect(d.attempts).toBe(1);
  }, 10_000);

  it("fails fast and says so when the key is rejected", async () => {
    calls = [];
    handler = () => ({ status: 401, json: { error: { message: "invalid x-api-key" } } });
    await expect(designSite(fixture())).rejects.toThrow(/key rejected \(401\)/);
    // No point retrying a 401 four times — the key will not become valid.
    expect(calls).toHaveLength(1);
  });

  it("names the model when it is not on the account", async () => {
    calls = [];
    handler = () => ({ status: 404, json: { error: { message: "not_found" } } });
    await expect(designSite(fixture())).rejects.toThrow(/is not available on this key/);
  });

  it("ships the finished page with the promises attached", async () => {
    calls = [];
    handler = () => reply(CLEAN);
    const d = await designSite(fixture());
    expect(d.html).toMatch(/name="robots" content="noindex, nofollow"/);
    expect(d.html).toContain("not an official website");
    expect(d.html).toContain("A Photographer");
    expect(d.html).toContain("© OpenStreetMap contributors");
    expect(d.html).not.toContain("{{MAP}}");
    expect(d.html).toContain("<svg");
    expect(d.html).not.toMatch(/<script/i);
  });
});
