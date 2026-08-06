import { parseHours, summarise, type Schedule } from "./hours";
import type { Scored } from "./score";

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

export type Palette = {
  id: string;
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  accentInk: string;
  line: string;
  display: string;
  body: string;
  /** Hero treatment, which changes the whole feel more than colour does. */
  mood: "warm" | "elegant" | "bold" | "clean" | "modern";
};

export type SiteSpec = {
  prospectId: string;
  slug: string;
  business: string;
  category: string;
  categoryLabel: string;
  locality: string | null;
  palette: Palette;
  sections: Section[];
  draft: boolean;
  /** ODbL requires attribution wherever the data is shown. */
  attribution: string;
  generatedAt: number;
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

const PALETTES: Record<string, Palette> = {
  food: {
    id: "food",
    bg: "#12100d", surface: "#1b1814", ink: "#f6f1e8", muted: "#a89a86",
    accent: "#e8a33d", accentInk: "#1a1510", line: "#2b2620",
    display: "'Georgia', 'Times New Roman', serif",
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    mood: "warm",
  },
  beauty: {
    id: "beauty",
    bg: "#fbf7f7", surface: "#ffffff", ink: "#2a1f26", muted: "#7d6a75",
    accent: "#9d4f6c", accentInk: "#ffffff", line: "#ece0e4",
    display: "'Georgia', 'Times New Roman', serif",
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    mood: "elegant",
  },
  trades: {
    id: "trades",
    bg: "#0f1621", surface: "#16202e", ink: "#eef3f9", muted: "#8fa2b8",
    accent: "#ff8a1f", accentInk: "#12100d", line: "#22303f",
    display: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    mood: "bold",
  },
  health: {
    id: "health",
    bg: "#f7fbfb", surface: "#ffffff", ink: "#12262b", muted: "#5d7a80",
    accent: "#0f8f9e", accentInk: "#ffffff", line: "#dceaec",
    display: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    mood: "clean",
  },
  professional: {
    id: "professional",
    bg: "#0e1420", surface: "#151d2b", ink: "#eaf0f7", muted: "#93a3ba",
    accent: "#c9a227", accentInk: "#12100d", line: "#1f2a3a",
    display: "'Georgia', 'Times New Roman', serif",
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    mood: "elegant",
  },
  fitness: {
    id: "fitness",
    bg: "#0b0d0c", surface: "#141816", ink: "#f2f7f3", muted: "#8b9a90",
    accent: "#b6f04a", accentInk: "#0b0d0c", line: "#1f2723",
    display: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    mood: "bold",
  },
  retail: {
    id: "retail",
    bg: "#faf9f7", surface: "#ffffff", ink: "#1d1c1a", muted: "#6f6a63",
    accent: "#2f6f5e", accentInk: "#ffffff", line: "#e7e4df",
    display: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    mood: "modern",
  },
};

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
  const palette = PALETTES[family];
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

  return {
    prospectId: p.id,
    slug: slugify(p.name, p.id),
    business: p.name,
    category: p.kind,
    categoryLabel: label,
    locality,
    palette,
    sections,
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
function normaliseSocial(value: string, host: string): string | null {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  // Anything carrying its own scheme is not a handle.
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  const handle = v.replace(/^@/, "").replace(/^\/+/, "").split(/[?#]/)[0];
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(handle)) return null;
  return `https://${host}/${encodeURIComponent(handle)}`;
}
