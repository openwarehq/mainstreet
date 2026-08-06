# mainstreet

**An automated web agency. It finds local businesses with no website and builds
them one — discovery, spec, design and build with nothing to approve.**

```bash
npm install
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env.local   # optional; see "Who designs the page"
npm run dev                                         # http://localhost:4340
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

On the captured Newtown fixture: **389 businesses, 268 with no site of their own.**

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

One HTML file per business. Inline CSS, no framework, no build step, **no
JavaScript at all.**

### Who designs the page

**Claude**, when `ANTHROPIC_API_KEY` is set. It is handed the verified facts, a
generated palette, a named art direction and the imagery, and writes the whole
document — layout included.

That last part is the reason it exists. The built-in renderer produces a
competent site, and after eight of them you can see the template through it:
same rhythm, same section order, same hero. Palette variation does not fix that,
because the thing that repeats is the *layout*.

Without a key the built-in renderer builds every site instead, and the dashboard
says which one is running. Nothing else changes — same facts, same map, same
credits, same draft banner.

| variable | effect |
|:--|:--|
| `ANTHROPIC_API_KEY` | unset → the built-in renderer |
| `MAINSTREET_MODEL` | default `claude-sonnet-5` |
| `MAINSTREET_DESIGN=off` | keep the key, use the renderer |

```bash
npm run design:one -- "Alba Coffee" cafe   # one site, to check the key works
```

Twelve art directions, picked from a hash of the business name — `editorial`,
`swiss`, `cinematic`, `brutalist`, `boutique`, `split`, `catalogue`, `marquee`,
`quiet`, `collage`, `service`, `gallery` and `liquidglass`.

Or design one yourself. `npm run brief -- "<business>"` prints the facts, the
palette, the art direction and the imagery — the exact brief the model gets —
and caches it; `npm run place -- drafts/<slug>.html` puts your page through the
same gate the model's output goes through and refuses it the same way. The audit
is not something the API path opts into.

Three sites are designed at once. Each run reports tokens and cost per site; a
model that is not in the price table is reported as **unpriced** rather than
free, because silently showing $0 for work that cost money is the one accounting
failure that matters.

### It moves, with no JavaScript

Every page animates: content reveals as it scrolls in, the hero photograph
drifts against the scroll, a progress bar runs across the top, images ease on
hover. There is still **no script on the page** — CSS scroll-driven animation
does all of it, keyed off `animation-timeline: view()` and `scroll()`.

The motion layer is **injected**, not asked for, because the two things most
likely to be got wrong are the two that matter and neither is a design decision:

- **Reduced motion.** Vestibular disorders make unstoppable movement a real
  harm, not a taste question. Everything is inert under
  `prefers-reduced-motion: reduce` — not a gentler version, none of it — and the
  audit rejects a page that writes its own `@keyframes` without that escape.
- **Degrading.** The obvious way to write a scroll reveal is `opacity: 0` plus
  an animation that restores it, which in a browser without scroll timelines
  leaves the whole page invisible. Every scroll-driven rule sits inside
  `@supports (animation-timeline: view())`, so a browser that cannot animate
  simply shows the content.

The designer applies classes — `m-rise`, `m-stagger`, `m-parallax`, `m-wipe`,
`m-mask`, `m-lift`, `m-zoom` — and the guards are not theirs to forget.

### Twelve businesses, twelve palettes

Palettes are generated, not chosen. A hash of the business name picks a hue from
a pool the category can plausibly wear, one of seven schemes (how light the page
is and where the colour sits), a type pairing and a corner radius — so two cafés
on the same street get visibly different sites, and the same café gets the same
site every time it is regenerated.

The constraint is the useful half. Unconstrained generation gives a dental
practice a blood-red duotone and the page stops being something you could send
to the owner. Contrast is computed rather than eyeballed, so no combination can
come out unreadable — there is a test that walks every family against a dozen
names and checks all of it.

### The map is the point

Every site carries a real map of the business's own corner, built from
OpenStreetMap tiles and **embedded** in the page as data URIs. It is the only
image on the page that is specifically theirs, and it is what stops a batch of
generated sites looking like a batch of generated sites.

It is embedded rather than linked because OSM's tile servers are donated
infrastructure whose usage policy discourages automated bulk use — linking would
mean every visitor to every generated site pulling from them forever. Tiles are
cached across a run, so a whole high street costs about a dozen fetches.

### Photography

Category imagery from Wikimedia Commons: CC-licensed, no API key, and shipping
machine-readable attribution — which matters, because CC-BY requires a credit
line and a generator that cannot produce one cannot legally use the image. Every
photograph is credited to its photographer with its licence in the footer.

These are **not photographs of the business** — nobody has those. They are what a
café counter or a salon floor looks like, the same thing a designer drops into a
pitch deck, and the draft banner says the details are unconfirmed. A pool of
sixty-odd images per category is fetched once and picked from by a hash of the
business name, so two cafés on the same street get different photographs and any
one café keeps its own every time it is regenerated.

Commons is full of scans, and a plain search will hand you one: the first build
opened a café on a **black-and-white photograph of a 1970s Hungarian dining
room** — a perfectly ordinary-looking result with no year in its filename. Three
filters fix it. Commons' own category strings catch what filenames do not,
Exif dates rule out anything before 2008, and images that have passed Commons'
peer review (*Quality images*, *Featured pictures*) sort to the front, which is
by a wide margin the best quality signal a keyless search can reach.

Unlike the map, photographs are **linked** to Wikimedia's CDN, which is built to
be linked and explicitly permits it. Inlining three would put a megabyte in every
file for no benefit. Page weight is roughly 300–400KB of imagery above the fold,
with the gallery lazy-loaded.

If Commons returns nothing usable for a category, the hero falls back to
generated SVG artwork seeded from the business name and the page still builds.

---

## The rule the generator follows

**Nothing on a generated page is invented about the business.**

Every fact traces to an OpenStreetMap tag — name, category, address, opening
hours, phone. There are no reviews, no testimonials, no "serving the community
since 1998", no stock photographs of premises nobody has seen, and no awards.
Those are the things that would make one of these a lie rather than a proposal,
and they are also the first things an owner notices are wrong.

### Which is why the model's page is audited

Letting a model design the site is what stops every business getting the same
layout. It is also the moment this could start lying: the most natural thing for
a model handed *"Alba Coffee, a café on King Street"* to write is *"Newtown's
finest coffee since 1998 — ★★★★★ from over 500 happy customers"*, and every word
of that is invented about a business nobody has contacted.

So every finished page is checked against the facts before it is saved:

- **Invention** — ratings, reviews, trading history, years of experience,
  awards, customer counts, prices, guarantees, free offers, credentials,
  "family-run", claims about a team. And any phone number or email address that
  is not the one on record, which is the dangerous one: a hallucinated phone
  number on a real business's page sends their customers to a stranger.
- **Unsafe** — script, event handlers, `javascript:` links, iframes, external
  stylesheets, `@import`, and any URL pointing somewhere that was not supplied.
  A model asked for photographs will reach for Unsplash unprompted, which is a
  hotlink to a service that never agreed to serve it.

A failing page is **not patched into compliance** — deleting the sentence
containing "★★★★★" leaves a layout built around a rating that is no longer
there. The violations go back to the model, which rewrites once; if it fails
again the built-in renderer builds the site instead. A plainer site is a much
better outcome than a handsome one carrying a phone number nobody can answer.

Three things are injected by code rather than asked for in the prompt, because a
promise that depends on a model following instructions is not a promise:
`noindex, nofollow`, the draft banner, and the photographer and OpenStreetMap
credits.

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

## Examples

`examples/` holds seven finished pages, built for seven real Newtown businesses
that have no website of their own. Open any of them in a browser — they are
single files.

Three of them are the `liquidglass` direction: frosted panels floating over a
colour field built from the business's own palette, with the aurora drifting
behind and everything revealing as it scrolls. **Luke Avenue** (a bakery, deep
crimson), **Local Store Newtown** (a clothing shop, indigo, monospace, sticky
glass sidebar) and **Gents Cuts Barbers** (a barber, teal, sharp 6px glass
because that is the radius its palette asked for).

The other four are `editorial`, `swiss` twice — the same brief on two palettes,
which is the pair worth comparing — and `cinematic`.

Note what happens where the record is thin. Luke Avenue has no street address,
so the map is the only thing on the page that says where to go, and it says so.
Gents Cuts Barbers has opening hours of `"Appointment only"`, reproduced
verbatim and given its own panel rather than guessed at. Three of the seven have
a **What is missing** block, which turns the hole in the data into the pitch.

## Running it offline

Overpass is run by volunteers and goes down. During this build both mirrors
timed out for twenty minutes straight, which is a normal day for it.

```bash
MAINSTREET_FIXTURE=./fixtures/newtown.json npm run dev
npm run capture -- Newtown fixtures/newtown.json   # refresh it from a live run
```

`fixtures/newtown.json` is real captured data — 389 Newtown businesses — so the
pipeline can be run, filmed and tested without depending on somebody else's free
service being healthy. It deliberately stores no scores, so a change that breaks
the ranking still shows up in the tests.

---

## Configuration

| variable | default |
|:--|:--|
| `ANTHROPIC_API_KEY` | unset — the built-in renderer designs the pages |
| `MAINSTREET_MODEL` | `claude-sonnet-5` |
| `MAINSTREET_DESIGN` | `off` forces the renderer even with a key |
| `ANTHROPIC_BASE_URL` | point at a gateway instead of the API |
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
npm test          # 116 tests
npm run typecheck
npm run build
```

The tests cover the parts where being wrong is invisible: the opening-hours
grammar, the scoring, that no generated palette can come out unreadable, that
the renderer escapes what it is given and never emits an executable link — and
the audit, which is written entirely from the model's point of view. Every case
there is the natural, plausible, *wrong* thing: it invents a rating, invents a
phone number, reaches for Unsplash, drops the map token, returns a fenced code
block, returns a fragment with no `<body>` to inject into.

Checking the motion needs a running server: headless Chrome screenshots the top
of a document and a `#fragment` capture comes back blank, so
`/_scrub.html?slug=<slug>&y=2600` loads a site into a same-origin iframe and
scrolls it there. That harness is the only thing in this repository with
JavaScript in it.

The design loop itself runs against a local stand-in for the API, because the
parts most likely to break — stitching the prefill back on, *rewriting* a
rejected page rather than patching it, retrying a 429, failing fast on a 401 —
cannot be tested against the real thing without paying to fail. What is
deliberately not tested is whether the page looks good. Only the real model
answers that.

---

## What it does not do

- **It does not contact anyone.** No email, no forms, no outreach. It finds and
  it builds; what you do next is yours.
- **It does not publish.** Sites are written to `./sites` and previewed locally.
  Nothing goes near a real domain, and nothing claims to be the business's
  official site.
- **It is not offline once built.** The map is embedded, but photographs load
  from Wikimedia. Strip the `assets.photos` if you need a page that renders with
  no network at all.
- **It cannot see anything OSM does not have.** Coverage varies enormously by
  country and suburb. A thin result usually means thin mapping, not no
  businesses.

MIT. Business data © OpenStreetMap contributors, ODbL — attribution is rendered
into every generated site, which the licence requires.
