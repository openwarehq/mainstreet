import type { Palette, Section, SiteSpec } from "./spec";

/**
 * Renders a spec into one self-contained HTML file.
 *
 * One file, inline CSS, no build step, no framework, no JavaScript. A local
 * business site does not need 200KB of script to show an address and a phone
 * number, and a single file is something you can hand over, host anywhere, or
 * attach to an email — which matters when the whole point is to put it in front
 * of an owner who has not asked for it yet.
 *
 * Two kinds of image, treated differently on purpose:
 *
 * - **The map is embedded.** Its tiles are inlined as data URIs at build time,
 *   because OpenStreetMap's tile servers are donated infrastructure and linking
 *   them would mean every visitor to every generated site pulls from them
 *   forever.
 * - **Photographs are linked** to Wikimedia's CDN, which is built to be linked
 *   and explicitly permits it. Inlining three photographs would put a megabyte
 *   in every file for no benefit.
 *
 * Photographs are category imagery, not pictures of the premises — nobody has
 * those. Every one carries a credit line naming the photographer and licence,
 * which CC-BY and CC-BY-SA require.
 */

const esc = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Only protocols that cannot execute. `javascript:` is the reason this exists. */
const safeHref = (href: string) =>
  /^(https?:|tel:|mailto:|#|\/)/i.test(href) ? esc(href) : "#";

/** Deterministic hash, so the same business always gets the same artwork. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Generated hero artwork.
 *
 * A layered arrangement driven by the business name, so every site is visually
 * distinct without anyone choosing anything, and re-running the generator never
 * changes an existing one.
 */
function heroArt(spec: SiteSpec): string {
  const h = hash(spec.business);
  const p = spec.palette;
  const rot = h % 40 - 20;
  const cx = 30 + (h >> 3) % 40;
  const cy = 30 + (h >> 7) % 30;
  const rings = 3 + ((h >> 11) % 3);

  const circles = Array.from({ length: rings }, (_, i) => {
    const r = 16 + i * 11;
    const o = (0.5 - i * 0.09).toFixed(2);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${p.accent}" stroke-opacity="${o}" stroke-width="0.7"/>`;
  }).join("");

  const bars = Array.from({ length: 5 }, (_, i) => {
    const w = 6 + ((h >> (i * 3)) % 26);
    const y = 60 + i * 7;
    return `<rect x="8" y="${y}" width="${w}" height="2.2" rx="1.1" fill="${p.accent}" fill-opacity="${(0.34 - i * 0.05).toFixed(2)}"/>`;
  }).join("");

  return `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="hg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${p.accent}" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="${p.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" fill="${p.surface}"/>
  <rect width="100" height="100" fill="url(#hg)"/>
  <g transform="rotate(${rot} ${cx} ${cy})">${circles}</g>
  ${bars}
</svg>`;
}

function css(p: Palette): string {
  return `
:root{
  --bg:${p.bg}; --surface:${p.surface}; --ink:${p.ink}; --muted:${p.muted};
  --accent:${p.accent}; --accent-ink:${p.accentInk}; --line:${p.line};
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0;background:var(--bg);color:var(--ink);
  font-family:${p.body};line-height:1.65;font-size:17px;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1040px;margin:0 auto;padding:0 24px}
h1,h2,h3{font-family:${p.display};line-height:1.15;margin:0;font-weight:${p.mood === "elegant" ? 400 : 700}}
h1{font-size:clamp(38px,7vw,68px);letter-spacing:-0.02em}
h2{font-size:clamp(24px,3.4vw,34px);letter-spacing:-0.01em}
h3{font-size:19px}
p{margin:0 0 1em}
a{color:inherit}

/* draft bar */
.draft{
  background:var(--accent);color:var(--accent-ink);
  font-size:13px;font-weight:600;letter-spacing:0.02em;
  padding:9px 24px;text-align:center;
}

/* header */
header.nav{
  position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 88%,transparent);
  backdrop-filter:blur(10px);border-bottom:1px solid var(--line);
}
.nav .wrap{display:flex;align-items:center;gap:20px;height:66px}
.brand{font-family:${p.display};font-weight:700;font-size:18px;letter-spacing:-0.01em;text-decoration:none}
.nav nav{margin-left:auto;display:flex;gap:22px}
.nav nav a{color:var(--muted);text-decoration:none;font-size:14.5px}
.nav nav a:hover{color:var(--ink)}

/* hero */
.hero{position:relative;overflow:hidden;border-bottom:1px solid var(--line)}
.hero .art{position:absolute;inset:0}
.hero .art svg,.hero .art img{width:100%;height:100%;display:block;object-fit:cover}
.hero .scrim{position:absolute;inset:0}
/* A photograph needs a heavier scrim than generated art or the headline sits on
   whatever happens to be behind it. Two layers: a vertical wash for legibility
   at the bottom, and a horizontal one so the left column always has ground. */
.hero-photo .scrim{
  background:
    linear-gradient(to top, var(--bg) 2%, color-mix(in srgb,var(--bg) 55%,transparent) 46%, color-mix(in srgb,var(--bg) 18%,transparent) 100%),
    linear-gradient(to right, color-mix(in srgb,var(--bg) 82%,transparent), transparent 62%);
}
.hero .inner{position:relative;padding:150px 0 110px}
.hero-photo h1{text-shadow:0 2px 30px color-mix(in srgb,var(--bg) 70%,transparent)}
.eyebrow{
  display:inline-block;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;
  color:var(--accent);margin-bottom:18px;
}
.hero p.sub{color:var(--muted);font-size:20px;max-width:44ch;margin-top:18px}
.ctas{display:flex;flex-wrap:wrap;gap:12px;margin-top:34px}
.btn{
  display:inline-block;padding:14px 26px;border-radius:6px;text-decoration:none;
  font-weight:600;font-size:15.5px;
}
.btn-primary{background:var(--accent);color:var(--accent-ink)}
.btn-ghost{border:1px solid var(--line);color:var(--ink)}
.btn:hover{opacity:.88}

/* sections */
section{padding:76px 0;border-bottom:1px solid var(--line)}
section:last-of-type{border-bottom:0}
.lede{color:var(--muted);font-size:19px;max-width:60ch;margin-top:18px}
.grid{display:grid;gap:22px;margin-top:40px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:26px}
.card h3{margin-bottom:8px}
.card p{color:var(--muted);font-size:15.5px;margin:0}
.note{
  margin-top:18px;font-size:13px;color:var(--muted);
  border-left:2px solid var(--accent);padding-left:12px;
}

/* hours */
.hours{margin-top:34px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--surface)}
.hours .row{display:flex;justify-content:space-between;gap:16px;padding:13px 20px;border-bottom:1px solid var(--line);font-size:15.5px}
.hours .row:last-child{border-bottom:0}
.hours .row.closed{color:var(--muted)}
.hours .day{font-weight:600}
.hours .times{text-align:right;color:var(--muted)}
.hours .row.closed .times{font-style:italic}

/* location + contact */
.split{display:grid;gap:28px;margin-top:36px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
address{font-style:normal;font-size:17px;line-height:1.9}
.pin{
  background:var(--surface);border:1px solid var(--line);border-radius:10px;
  padding:26px;display:flex;align-items:center;gap:16px;
}
.pin svg{flex:0 0 auto}
.contact-list{list-style:none;padding:0;margin:0;font-size:17px}
.contact-list li{padding:10px 0;border-bottom:1px solid var(--line)}
.contact-list li:last-child{border-bottom:0}
.contact-list a{text-decoration:none;color:var(--accent);font-weight:600}
.social{display:flex;gap:12px;margin-top:18px}
.social a{
  border:1px solid var(--line);border-radius:6px;padding:9px 16px;
  text-decoration:none;font-size:14.5px;color:var(--muted);
}
.social a:hover{color:var(--ink);border-color:var(--accent)}

/* gallery */
.gallery{display:grid;gap:18px;margin-top:36px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.gallery figure{margin:0;border-radius:12px;overflow:hidden;border:1px solid var(--line);background:var(--surface)}
.gallery img{display:block;width:100%;height:290px;object-fit:cover;transition:transform .5s ease}
.gallery figure:hover img{transform:scale(1.03)}

/* map */
.mapsection{padding-top:0;border-bottom:1px solid var(--line)}
.mapframe{position:relative;border-radius:14px;overflow:hidden;border:1px solid var(--line);background:var(--surface)}
.mapframe svg{display:block;width:100%;height:auto}
.mapcard{
  position:absolute;left:22px;bottom:22px;max-width:300px;
  background:color-mix(in srgb,var(--bg) 92%,transparent);
  border:1px solid var(--line);border-radius:10px;padding:18px 20px;
  display:flex;flex-direction:column;gap:8px;
  backdrop-filter:blur(8px);font-size:15px;
}
.mapcard strong{font-family:${p.display};font-size:18px}
.mapcard span{color:var(--muted);line-height:1.6;font-size:14.5px}
.mapcard a{color:var(--accent);font-weight:600;text-decoration:none;font-size:14.5px}
.credit{margin-top:12px;font-size:12px;color:var(--muted)}

footer{padding:44px 0;color:var(--muted);font-size:13.5px}
footer a{color:var(--muted)}
footer .wrap{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between}

@media (max-width:640px){
  body{font-size:16px}
  .hero .inner{padding:96px 0 68px}
  .nav nav{display:none}
  section{padding:56px 0}
  .gallery img{height:220px}
  .mapcard{position:static;max-width:none;border:0;border-top:1px solid var(--line);border-radius:0;backdrop-filter:none}
  .mapframe{border-radius:12px}
}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`.trim();
}

function renderSection(s: Section, spec: SiteSpec): string {
  switch (s.kind) {
    case "hero": {
      const photo = spec.assets?.photos?.[0];
      return `<div class="hero${photo ? " hero-photo" : ""}">
  <div class="art">${
    photo
      ? `<img src="${safeHref(photo.url)}" alt="" loading="eager" decoding="async" fetchpriority="high">`
      : heroArt(spec)
  }</div>
  <div class="scrim"></div>
  <div class="inner"><div class="wrap">
    <span class="eyebrow">${esc(spec.categoryLabel)}${spec.locality ? ` · ${esc(spec.locality)}` : ""}</span>
    <h1>${esc(s.headline)}</h1>
    <p class="sub">${esc(s.sub)}</p>
    <div class="ctas">
      ${s.ctas
        .map(
          (c, i) =>
            `<a class="btn ${i === 0 ? "btn-primary" : "btn-ghost"}" href="${safeHref(c.href)}"${/^https?:/i.test(c.href) ? ' target="_blank" rel="noopener"' : ""}>${esc(c.label)}</a>`,
        )
        .join("\n      ")}
    </div>
  </div></div>
</div>`;
    }

    case "intro":
      return `<section id="about"><div class="wrap">
  <h2>${esc(s.heading)}</h2>
  <p class="lede">${esc(s.body)}</p>
</div></section>`;

    case "services":
      return `<section id="services"><div class="wrap">
  <h2>${esc(s.heading)}</h2>
  <div class="grid">
    ${s.items
      .map((i) => `<div class="card"><h3>${esc(i.title)}</h3><p>${esc(i.body)}</p></div>`)
      .join("\n    ")}
  </div>
  ${spec.draft ? `<p class="note">${esc(s.note)}</p>` : ""}
</div></section>`;

    case "hours": {
      if (!s.schedule) return "";
      if (s.rawNote) {
        // Unparsed hours are shown exactly as mapped rather than guessed at.
        return `<section id="hours"><div class="wrap">
  <h2>${esc(s.heading)}</h2>
  <div class="hours"><div class="row"><span class="day">As listed</span><span class="times">${esc(s.rawNote)}</span></div></div>
</div></section>`;
      }
      return `<section id="hours"><div class="wrap">
  <h2>${esc(s.heading)}</h2>
  <div class="hours">
    ${s.schedule.days
      .map((d) => {
        const closed = d.ranges.length === 0;
        return `<div class="row${closed ? " closed" : ""}"><span class="day">${esc(d.label)}</span><span class="times">${closed ? "Closed" : esc(d.ranges.join(", "))}</span></div>`;
      })
      .join("\n    ")}
  </div>
</div></section>`;
    }

    case "location":
      return `<section id="find"><div class="wrap">
  <h2>${esc(s.heading)}</h2>
  <div class="split">
    <div>
      <address>${s.address.map(esc).join("<br>")}</address>
      <div class="social"><a href="${safeHref(`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lon}#map=18/${s.lat}/${s.lon}`)}" target="_blank" rel="noopener">Open in maps</a></div>
    </div>
    <div class="pin">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="${spec.palette.accent}" stroke-width="1.7" aria-hidden="true">
        <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>
      </svg>
      <div><strong>${esc(spec.categoryLabel)}</strong><br><span style="color:var(--muted);font-size:14.5px">${esc(spec.locality ?? "")}</span></div>
    </div>
  </div>
</div></section>`;

    case "contact": {
      const items: string[] = [];
      if (s.phone)
        items.push(`<li>Phone <a href="tel:${esc(s.phone.replace(/\s+/g, ""))}">${esc(s.phone)}</a></li>`);
      if (s.email) items.push(`<li>Email <a href="mailto:${esc(s.email)}">${esc(s.email)}</a></li>`);
      if (!items.length) items.push(`<li style="color:var(--muted)">Contact details to be added.</li>`);
      return `<section id="contact"><div class="wrap">
  <h2>${esc(s.heading)}</h2>
  <div class="split">
    <ul class="contact-list">${items.join("")}</ul>
    ${
      s.social.length
        ? `<div><p style="color:var(--muted);font-size:15px;margin-bottom:6px">Also here</p><div class="social">${s.social
            .map((x) => `<a href="${safeHref(x.href)}" target="_blank" rel="noopener">${esc(x.label)}</a>`)
            .join("")}</div></div>`
        : "<div></div>"
    }
  </div>
</div></section>`;
    }
  }
}

/** Two photographs, side by side, under a heading that does not overclaim. */
function renderGallery(spec: SiteSpec): string {
  const photos = spec.assets?.photos?.slice(1, 3) ?? [];
  if (photos.length < 2) return "";
  return `<section id="gallery"><div class="wrap">
  <h2>The look</h2>
  <p class="lede">Reference imagery for the design. Swap in your own photographs before this goes live.</p>
  <div class="gallery">
    ${photos
      .map(
        (p) =>
          `<figure><img src="${safeHref(p.url)}" alt="" loading="lazy" decoding="async"></figure>`,
      )
      .join("\n    ")}
  </div>
</div></section>`;
}

/**
 * The map of where they actually are.
 *
 * Rendered inline as SVG with the tiles already embedded, so the page makes no
 * request to OpenStreetMap's donated tile servers when somebody views it.
 */
function renderMap(spec: SiteSpec): string {
  const map = spec.assets?.map;
  if (!map) return "";
  const loc = spec.sections.find((s) => s.kind === "location");
  const address = loc && loc.kind === "location" ? loc.address : [];
  const { lat, lon } = spec;
  return `<section id="map" class="mapsection"><div class="wrap">
  <div class="mapframe">
    ${map.svg}
    <div class="mapcard">
      <strong>${esc(spec.business)}</strong>
      ${address.length ? `<span>${address.map(esc).join("<br>")}</span>` : ""}
      <a href="${safeHref(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`)}" target="_blank" rel="noopener">Directions</a>
    </div>
  </div>
  <p class="credit">${esc(map.attribution)}</p>
</div></section>`;
}

/** Photographer credits. CC-BY and CC-BY-SA both require them. */
function renderCredits(spec: SiteSpec): string {
  const photos = spec.assets?.photos ?? [];
  if (!photos.length) return "";
  const seen = new Set<string>();
  const items = photos
    .filter((p) => (seen.has(p.page) ? false : (seen.add(p.page), true)))
    .map(
      (p) =>
        `<a href="${safeHref(p.page)}" target="_blank" rel="noopener">${esc(p.artist)}</a> (${esc(p.licence)})`,
    );
  return `<span>Photography: ${items.join(", ")} via Wikimedia Commons</span>`;
}

export function renderSite(spec: SiteSpec): string {
  const nav = [
    ["about", "About"],
    ["services", "Services"],
    spec.sections.some((s) => s.kind === "hours") ? ["hours", "Hours"] : null,
    spec.sections.some((s) => s.kind === "location") ? ["find", "Find us"] : null,
    ["contact", "Contact"],
  ].filter(Boolean) as Array<[string, string]>;

  const title = spec.locality
    ? `${spec.business} — ${spec.categoryLabel} in ${spec.locality}`
    : `${spec.business} — ${spec.categoryLabel}`;

  const description = `${spec.business} is a ${spec.categoryLabel.toLowerCase()}${spec.locality ? ` in ${spec.locality}` : ""}. Opening hours, address and contact details.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta name="robots" content="${spec.draft ? "noindex, nofollow" : "index, follow"}">
<style>${css(spec.palette)}</style>
</head>
<body>
${spec.draft ? `<div class="draft">Draft proposal for ${esc(spec.business)} — not an official website. Details from public map data and yet to be confirmed.</div>` : ""}
<header class="nav"><div class="wrap">
  <a class="brand" href="#">${esc(spec.business)}</a>
  <nav>${nav.map(([id, label]) => `<a href="#${id}">${esc(label)}</a>`).join("")}</nav>
</div></header>

${(() => {
  // The map is its own section, not part of the location block. Coupling them
  // meant a business with no mapped street address got no map either — and
  // those are exactly the ones a map helps most, because it is then the only
  // thing on the page that says where they are.
  const out: string[] = [];
  let mapPlaced = false;
  for (const sec of spec.sections) {
    out.push(renderSection(sec, spec));
    if (sec.kind === "services") out.push(renderGallery(spec));
    if (sec.kind === "location") {
      out.push(renderMap(spec));
      mapPlaced = true;
    }
    // No address section, so the map goes immediately before contact instead.
    if (sec.kind === "hours" && !spec.sections.some((x) => x.kind === "location")) {
      out.push(renderMap(spec));
      mapPlaced = true;
    }
  }
  if (!mapPlaced) out.splice(out.length - 1, 0, renderMap(spec));
  return out.filter(Boolean).join("\n\n");
})()}

<footer><div class="wrap">
  <span>© ${new Date(spec.generatedAt).getFullYear()} ${esc(spec.business)}</span>
  ${renderCredits(spec)}
  <span>${esc(spec.attribution)}</span>
</div></footer>
</body>
</html>
`;
}
