import { parseHours, summarise, type Schedule } from "./hours";
import { imagePool, pickPhotos, type Photo } from "./images";
import { paletteFor, type Palette } from "./palette";
import type { Scored } from "./score";
import { staticMap } from "./staticmap";

export type { Palette } from "./palette";

/**
 * Turns a prospect into a site specification.
 *
 * **Nothing in here is invented about the business.** Every fact on the
 * generated page traces to an OpenStreetMap tag: the name, the category, the
 * address, the hours, the phone number. There are no reviews, no testimonials,
 * no "serving the community since 1998", no photographs of premises nobody has
 * seen, and no awards. Those are the things that would make one of these pages
 * a lie rather than a proposal, and they are also the first things a business
 * owner notices are wrong.
 *
 * What the generator *does* supply is structure and neutral copy that is true
 * by construction — "a bakery on King Street" — plus category-typical service
 * headings that the owner confirms or replaces. Because some of that is a
 * starting point rather than a fact, every page carries a draft banner until
 * an operator turns it off.
 */

export type Section =
  | { kind: "hero"; headline: string; sub: string; ctas: Array<{ label: string; href: string }> }
  | { kind: "intro"; heading: string; body: string }
  | { kind: "services"; heading: string; note: string; items: Array<{ title: string; body: string }> }
  | { kind: "hours"; heading: string; schedule: Schedule | null; rawNote: string | null }
  | { kind: "location"; heading: string; address: string[]; lat: number; lon: number }
  | { kind: "contact"; heading: string; phone: string | null; email: string | null; social: Array<{ label: string; href: string }> };

/**
 * The verified facts, collected in one place.
 *
 * This is the *only* thing handed to a design model, and the auditor checks the
 * finished page against it. Keeping it separate from the rendered sections is
 * what makes "nothing on the page is invented" checkable rather than a promise:
 * if a phone number appears in the HTML and is not in here, the page is
 * rejected.
 */
export type Facts = {
  name: string;
  categoryLabel: string;
  locality: string | null;
  street: string | null;
  address: string[];
  phone: string | null;
  email: string | null;
  /** Day-by-day lines, already formatted, or null if OSM had nothing usable. */
  hours: string[] | null;
  /** Hours OSM had but the parser would not guess at — shown verbatim. */
  hoursRaw: string | null;
  cuisine: string | null;
  social: Array<{ label: string; href: string }>;
  lat: number;
  lon: number;
};

/**
 * Imagery, fetched separately from the spec.
 *
 * `buildSpec` stays pure and synchronous so it can be tested without a network,
 * and everything that needs one lives here and is attached afterwards. A site
 * with no assets still renders — it falls back to generated artwork.
 */
export type SiteAssets = {
  photos: Photo[];
  map: { svg: string; attribution: string } | null;
};

export type SiteSpec = {
  prospectId: string;
  slug: string;
  business: string;
  category: string;
  categoryLabel: string;
  locality: string | null;
  /** The business's own coordinates. The map needs these whether or not an
   *  address happens to be mapped. */
  lat: number;
  lon: number;
  palette: Palette;
  sections: Section[];
  facts: Facts;
  draft: boolean;
  /** ODbL requires attribution wherever the data is shown. */
  attribution: string;
  generatedAt: number;
  assets?: SiteAssets;
  /** Who laid the page out, and what it cost. Set by the pipeline. */
  design?: {
    by: "claude" | "template";
    /** The art direction Claude was briefed with, or the palette id. */
    direction: string;
    model: string | null;
    usd: number;
    priced: boolean;
  };
};

// ── categories ──────────────────────────────────────────────────────────────

const FAMILIES: Record<string, string[]> = {
  food: ["cafe", "restaurant", "fast_food", "bar", "pub", "ice_cream", "bakery", "butcher", "greengrocer"],
  beauty: ["hairdresser", "beauty", "massage", "tattoo"],
  trades: ["plumber", "electrician", "carpenter", "painter", "roofer", "builder", "gardener", "locksmith", "car_repair", "hardware"],
  health: ["dentist", "doctors", "veterinary", "pharmacy", "optician"],
  professional: ["accountant", "lawyer", "estate_agent", "insurance", "architect", "photographer"],
  fitness: ["fitness_centre", "sports_centre", "dance"],
  retail: ["florist", "jewelry", "shoes", "clothes", "furniture", "bicycle", "pet", "childcare", "driving_school"],
};

export function familyOf(kind: string): string {
  for (const [family, kinds] of Object.entries(FAMILIES)) {
    if (kinds.includes(kind)) return family;
  }
  return "retail";
}

const LABELS: Record<string, string> = {
  cafe: "Café", restaurant: "Restaurant", fast_food: "Takeaway", bar: "Bar", pub: "Pub",
  ice_cream: "Ice cream shop", bakery: "Bakery", butcher: "Butcher", greengrocer: "Greengrocer",
  hairdresser: "Hair salon", beauty: "Beauty salon", massage: "Massage studio", tattoo: "Tattoo studio",
  plumber: "Plumber", electrician: "Electrician", carpenter: "Carpenter", painter: "Painter & decorator",
  roofer: "Roofer", builder: "Builder", gardener: "Gardener", locksmith: "Locksmith",
  car_repair: "Auto repair", hardware: "Hardware store",
  dentist: "Dental practice", doctors: "Medical practice", veterinary: "Veterinary clinic",
  pharmacy: "Pharmacy", optician: "Optician",
  accountant: "Accountancy practice", lawyer: "Law practice", estate_agent: "Estate agency",
  insurance: "Insurance broker", architect: "Architecture studio", photographer: "Photography studio",
  fitness_centre: "Gym", sports_centre: "Sports centre", dance: "Dance studio",
  florist: "Florist", jewelry: "Jeweller", shoes: "Shoe shop", clothes: "Clothing shop",
  furniture: "Furniture shop", bicycle: "Bike shop", pet: "Pet shop",
  childcare: "Childcare", driving_school: "Driving school",
};

/**
 * Category-typical service headings.
 *
 * These are a starting point, not a claim — the tool has no way to know what a
 * particular plumber does. They exist so the page has real structure to pitch,
 * and the draft banner says plainly that they need confirming.
 */
const SERVICES: Record<string, Array<{ title: string; body: string }>> = {
  food: [
    { title: "Eat in", body: "Table service in the dining room, with the day's specials on the board." },
    { title: "Takeaway", body: "Order ahead and collect, or eat on the go." },
    { title: "Private bookings", body: "The room can be booked for groups and occasions." },
  ],
  beauty: [
    { title: "Appointments", body: "Book a time that suits you, with a consultation before every treatment." },
    { title: "Treatments", body: "A full service list covering cuts, colour and finishing." },
    { title: "Occasions", body: "Preparation for weddings, events and portraits." },
  ],
  trades: [
    { title: "Callouts", body: "Attendance for faults and breakdowns, with the problem explained before work starts." },
    { title: "Installations", body: "New work fitted, tested and left clean." },
    { title: "Quotes", body: "A written quote before anything is committed to." },
  ],
  health: [
    { title: "Appointments", body: "Routine and urgent appointments, booked by phone." },
    { title: "Check-ups", body: "Regular examinations and preventative care." },
    { title: "New patients", body: "Registrations welcome, with a first consultation to get started." },
  ],
  professional: [
    { title: "Consultations", body: "An initial conversation to understand what you need." },
    { title: "Ongoing work", body: "Regular support, with clear scope and clear fees." },
    { title: "One-off matters", body: "Single pieces of work handled end to end." },
  ],
  fitness: [
    { title: "Membership", body: "Access to the floor, equipment and the class timetable." },
    { title: "Classes", body: "Group sessions across the week, all levels." },
    { title: "Personal training", body: "One-to-one sessions built around your goals." },
  ],
  retail: [
    { title: "In store", body: "Come in and see the range, with someone on hand to help." },
    { title: "Orders", body: "Items not in stock can be ordered in." },
    { title: "Advice", body: "Honest guidance on what suits you, without the upsell." },
  ],
};

export function slugify(name: string, id: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  // The OSM id keeps two businesses with the same name from colliding.
  const suffix = id.replace(/[^0-9]/g, "").slice(-6);
  return `${base || "business"}-${suffix}`;
}

function addressLines(p: Scored): string[] {
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  return [street, [p.city, p.postcode].filter(Boolean).join(" ")].filter((l) => l.trim());
}

export function buildSpec(p: Scored): SiteSpec {
  const family = familyOf(p.kind);
  // Seeded on the name, not the category, so two cafés on the same street come
  // out looking like two different businesses.
  const palette = paletteFor(family, p.name);
  const label = LABELS[p.kind] ?? p.kind.replace(/_/g, " ");
  const locality = p.city ?? null;
  const schedule = parseHours(p.openingHours);
  const address = addressLines(p);

  // Copy that is true by construction: it restates facts already in the record
  // and asserts nothing beyond them.
  const where = locality ? ` in ${locality}` : p.street ? ` on ${p.street}` : "";
  const sub = `${label}${where}`;

  const ctas: Array<{ label: string; href: string }> = [];
  if (p.phone) ctas.push({ label: "Call us", href: `tel:${p.phone.replace(/\s+/g, "")}` });
  ctas.push({
    label: "Find us",
    href: `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=18/${p.lat}/${p.lon}`,
  });

  const social: Array<{ label: string; href: string }> = [];
  const fb = p.facebook ? normaliseSocial(p.facebook, "facebook.com") : null;
  const ig = p.instagram ? normaliseSocial(p.instagram, "instagram.com") : null;
  if (fb) social.push({ label: "Facebook", href: fb });
  if (ig) social.push({ label: "Instagram", href: ig });

  const sections: Section[] = [
    { kind: "hero", headline: p.name, sub, ctas },
    {
      kind: "intro",
      heading: `A ${label.toLowerCase()}${where}`,
      body: [
        `${p.name} is a ${label.toLowerCase()}${where ? where : ""}.`,
        address.length ? `You will find us at ${address.join(", ")}.` : "",
        summarise(schedule) ? `We are open ${summarise(schedule)}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    },
    {
      kind: "services",
      heading: "What we do",
      note: "Draft headings — confirm or replace before this goes live.",
      items: SERVICES[family],
    },
  ];

  if (schedule) {
    sections.push({
      kind: "hours",
      heading: "Opening hours",
      schedule,
      rawNote: schedule.unparsed ? schedule.raw : null,
    });
  }
  if (address.length) {
    sections.push({ kind: "location", heading: "Where to find us", address, lat: p.lat, lon: p.lon });
  }
  sections.push({
    kind: "contact",
    heading: "Get in touch",
    phone: p.phone,
    email: p.email,
    social,
  });

  const facts: Facts = {
    name: p.name,
    categoryLabel: label,
    locality,
    street: p.street,
    address,
    phone: p.phone,
    email: p.email,
    hours: schedule && !schedule.unparsed
      ? schedule.days.map((d) => `${d.label}: ${d.ranges.length ? d.ranges.join(", ") : "Closed"}`)
      : null,
    hoursRaw: schedule?.unparsed ? schedule.raw : null,
    cuisine: p.cuisine,
    social,
    lat: p.lat,
    lon: p.lon,
  };

  return {
    prospectId: p.id,
    slug: slugify(p.name, p.id),
    business: p.name,
    category: p.kind,
    categoryLabel: label,
    locality,
    lat: p.lat,
    lon: p.lon,
    palette,
    sections,
    facts,
    draft: true,
    attribution: "Business details from OpenStreetMap contributors, ODbL.",
    generatedAt: Date.now(),
  };
}

/**
 * Turns whatever is in the tag into a usable profile link, or nothing.
 *
 * OSM social tags hold either a full URL or a bare handle, and occasionally
 * junk. Pasting the value onto the host unchecked turned `javascript:alert(1)`
 * into `https://facebook.com/javascript:alert(1)` — harmless, because it is an
 * https URL, but a link to nowhere on a page being pitched to a business.
 */
/**
 * Fetches the photography and the map for one site.
 *
 * The map is the image that matters. Category photography says "a café"; a map
 * of their corner says "*this* café" — it is the only picture on the page that
 * is specifically theirs, and it is what stops a batch of generated sites
 * looking like a batch of generated sites.
 */
export async function collectAssets(spec: SiteSpec): Promise<SiteAssets> {
  const family = familyOf(spec.category);
  const [pool, map] = await Promise.all([
    imagePool(spec.category, family),
    staticMap(spec.lat, spec.lon, { zoom: 16, cols: 4, rows: 2, accent: spec.palette.accent }),
  ]);
  return {
    photos: pickPhotos(pool, spec.business, 3),
    map: map ? { svg: map.svg, attribution: map.attribution } : null,
  };
}

function normaliseSocial(value: string, host: string): string | null {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  // Anything carrying its own scheme is not a handle.
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  const handle = v.replace(/^@/, "").replace(/^\/+/, "").split(/[?#]/)[0];
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(handle)) return null;
  return `https://${host}/${encodeURIComponent(handle)}`;
}
