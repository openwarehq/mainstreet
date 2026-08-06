import type { Prospect } from "./overpass";

/**
 * Ranks prospects by how much a website would help them.
 *
 * The whole thesis is in the first rule: a business with **no website** is the
 * lead. Everything else adjusts the ordering within that.
 *
 * A business that already has a real site is not a prospect and is scored to
 * the bottom rather than dropped, so the operator can see the coverage of an
 * area rather than a filtered list that hides how it was filtered.
 */

export type Scored = Prospect & {
  score: number;
  /** Plain-language reasons, shown on the card so the ranking is auditable. */
  reasons: string[];
  /** True when they have social presence but no site of their own. */
  socialOnly: boolean;
};

/** Domains that are somebody else's platform, not a site the business owns. */
const NOT_A_SITE =
  /(facebook\.com|instagram\.com|linktr\.ee|linktree|wixsite\.com\/blank|business\.site|yelp\.|tripadvisor\.|ubereats\.|doordash\.|deliveroo\.|menulog\.|square\.site|linktr)/i;

/** Categories where a site converts hardest — bookings, menus, quotes. */
const HIGH_INTENT = new Set([
  "restaurant", "cafe", "bar", "pub", "hairdresser", "beauty", "massage",
  "tattoo", "dentist", "doctors", "veterinary", "plumber", "electrician",
  "carpenter", "roofer", "builder", "gardener", "locksmith", "photographer",
  "fitness_centre", "driving_school", "accountant", "lawyer", "estate_agent",
]);

export function scoreProspect(p: Prospect): Scored {
  const reasons: string[] = [];
  let score = 0;

  const platformOnly = p.website ? NOT_A_SITE.test(p.website) : false;
  const socialOnly = (!p.website || platformOnly) && Boolean(p.facebook || p.instagram);

  if (!p.website) {
    score += 50;
    reasons.push("no website");
  } else if (platformOnly) {
    // A Facebook page or a delivery-app listing is a page on someone else's
    // platform. They cannot change it, cannot rank on it, and lose the customer
    // to a competitor listed beside them.
    score += 38;
    reasons.push("only a platform page");
  } else {
    score -= 40;
    reasons.push("already has a site");
  }

  if (socialOnly) {
    score += 6;
    reasons.push("active on social");
  }

  // Contactable means the pitch can actually reach them.
  if (p.phone) {
    score += 14;
    reasons.push("phone listed");
  }
  if (p.email) {
    score += 10;
    reasons.push("email listed");
  }
  if (!p.phone && !p.email) reasons.push("no contact route");

  // Detail in the record is material the generated site can use, which makes
  // the demo better and the pitch easier.
  if (p.openingHours) {
    score += 8;
    reasons.push("hours mapped");
  }
  if (p.street && p.housenumber) {
    score += 6;
    reasons.push("full address");
  }
  if (p.cuisine) score += 3;

  if (HIGH_INTENT.has(p.kind)) {
    score += 12;
    reasons.push("high-intent category");
  }

  return { ...p, score, reasons, socialOnly };
}

export function rank(prospects: Prospect[]): Scored[] {
  return prospects
    .map(scoreProspect)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
