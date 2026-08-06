# mainstreet

**An automated web agency. It finds local businesses with no website and builds
them one — discovery, spec and build with nothing to approve.**

```bash
npm install
npm run dev            # http://localhost:4340
```

Type a suburb. Press **Run agency**. It queries OpenStreetMap, ranks every
business by how much a website would help them, auto-approves the spec, and
writes a finished single-file site for each of the top N. On the fixture that
last step is 12 sites in 12 milliseconds — the slow part is Overpass, not us.

---

## How it finds them

OpenStreetMap, through the Overpass API. No key, no billing, no terms that
forbid storing what comes back — and, the part that matters, **OSM records
whether a business has a website.** A named business with a phone number and no
`website` tag is exactly the lead this tool exists to find.

On the captured Newtown fixture: **117 businesses, 85 with no site of their own.**

Google Places needs a billed key and forbids storing most of its response; Yelp
needs a key and rate-limits hard. Neither is usable for this.

## How it ranks them

Score is the whole thesis, in order of weight:

| signal | effect |
|:--|:--|
| no website at all | **+50** — the lead |
| only a Facebook page or a delivery-app listing | **+38** — a page they cannot change, rank on, or own |
| phone listed | +14 |
| high-intent category (bookings, quotes, menus) | +12 |
| email listed | +10 |
| hours mapped | +8 |
| already has a real site | **−40** |

Businesses that already have a site stay in the list rather than being filtered
out, so you can see the coverage of an area instead of a list that hides how it
was filtered. Every card shows its reasons, so the ranking is auditable.

## What it builds

One self-contained HTML file per business. Inline CSS, no framework, no build
step, no external requests. A local business site does not need 200KB of
JavaScript to show an address and a phone number — and one file is something you
can hand over, host anywhere, or attach to an email.

Seven category palettes (food, beauty, trades, health, professional, fitness,
retail) with matching type, so a plumber and a day spa do not get the same page.
Hero artwork is generated SVG seeded from the business name, so every site is
distinct and re-running never changes an existing one.

---

## The rule the generator follows

**Nothing on a generated page is invented about the business.**

Every fact traces to an OpenStreetMap tag — name, category, address, opening
hours, phone. There are no reviews, no testimonials, no "serving the community
since 1998", no stock photographs of premises nobody has seen, and no awards.
Those are the things that would make one of these a lie rather than a proposal,
and they are also the first things an owner notices are wrong.

What the generator supplies is structure and copy that is true by construction —
"a bakery on King Street" — plus category-typical service headings that are a
starting point, not a claim.

Because of that, **every page ships as a draft**: a banner stating it is a
proposal and not an official website, and `noindex, nofollow` so it cannot turn
up in search results for a business that has not agreed to it. Turn
`spec.draft` off when the owner has said yes.

Opening hours get the same treatment. The OSM `opening_hours` grammar is
enormous; the parser handles what high-street businesses actually use and
returns anything else **verbatim** rather than guessing. Printing wrong hours on
a business's own site is worse than printing none, because somebody drives there.

---

## Running it offline

Overpass is run by volunteers and goes down. During this build both mirrors
timed out for twenty minutes straight, which is a normal day for it.

```bash
MAINSTREET_FIXTURE=./fixtures/newtown.json npm run dev
```

`fixtures/newtown.json` is real captured data — 117 Newtown businesses — so the
pipeline can be run, filmed and tested without depending on somebody else's free
service being healthy. It deliberately stores no scores, so a change that breaks
the ranking still shows up in the tests.

---

## Configuration

| variable | default |
|:--|:--|
| `MAINSTREET_FIXTURE` | unset — live Overpass |
| `MAINSTREET_DB` | `./mainstreet.db` |
| `MAINSTREET_SITES` | `./sites` |
| `PORT` | `4340` |

Overpass is queried with a 45-second client timeout per mirror and three mirrors
in turn. The `timeout:40` inside the query is the *server's* execution budget and
says nothing about how long the request queues first — without a client timeout
the run hangs on the first mirror and the fallback never happens.

---

## Development

```bash
npm test          # 45 tests
npm run typecheck
npm run build
```

The tests cover the parts where being wrong is invisible: the opening-hours
grammar, the scoring, and that the renderer escapes what it is given and never
emits an executable link.

---

## What it does not do

- **It does not contact anyone.** No email, no forms, no outreach. It finds and
  it builds; what you do next is yours.
- **It does not publish.** Sites are written to `./sites` and previewed locally.
  Nothing goes near a real domain, and nothing claims to be the business's
  official site.
- **It cannot see anything OSM does not have.** Coverage varies enormously by
  country and suburb. A thin result usually means thin mapping, not no
  businesses.

MIT. Business data © OpenStreetMap contributors, ODbL — attribution is rendered
into every generated site, which the licence requires.
