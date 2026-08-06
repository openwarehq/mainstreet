/**
 * Parses OSM `opening_hours` into something a website can show.
 *
 * The full specification is enormous — it covers public holidays, sunset
 * offsets, week numbers and month ranges. This handles the shape that actually
 * appears on high-street businesses:
 *
 *   Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off
 *   Mo-Su 11:30-14:30,17:30-22:00
 *   24/7
 *
 * Anything it does not understand is returned as `raw` and rendered verbatim
 * rather than guessed at. Printing wrong opening hours on a business's own
 * website is worse than printing none, because someone drives there.
 */

export const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
export type Day = (typeof DAYS)[number];

export const DAY_NAMES: Record<Day, string> = {
  Mo: "Monday",
  Tu: "Tuesday",
  We: "Wednesday",
  Th: "Thursday",
  Fr: "Friday",
  Sa: "Saturday",
  Su: "Sunday",
};

export type Schedule = {
  /** One entry per day, in week order. `null` means closed. */
  days: Array<{ day: Day; label: string; ranges: string[] }>;
  /** True when nothing could be parsed and the raw string should be shown. */
  unparsed: boolean;
  raw: string;
  alwaysOpen: boolean;
};

const DAY_INDEX = new Map<string, number>(DAYS.map((d, i) => [d.toLowerCase(), i]));

/** `Mo-We` → [0,1,2]; `Mo,Fr` → [0,4]; `Mo` → [0]. */
function expandDays(spec: string): number[] {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const range = part.trim().match(/^([A-Za-z]{2})\s*-\s*([A-Za-z]{2})$/);
    if (range) {
      const a = DAY_INDEX.get(range[1].toLowerCase());
      const b = DAY_INDEX.get(range[2].toLowerCase());
      if (a == null || b == null) continue;
      // Wraps across the end of the week: Sa-Mo is Saturday, Sunday, Monday.
      for (let i = a; ; i = (i + 1) % 7) {
        out.add(i);
        if (i === b) break;
      }
      continue;
    }
    const one = DAY_INDEX.get(part.trim().toLowerCase());
    if (one != null) out.add(one);
  }
  return [...out];
}

/** `09:00-17:00,18:00-22:00` → ["09:00 – 17:00", "18:00 – 22:00"]. */
function parseRanges(spec: string): string[] {
  const out: string[] = [];
  for (const part of spec.split(",")) {
    const m = part.trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
    if (!m) continue;
    out.push(`${m[1]} – ${m[2]}`);
  }
  return out;
}

export function parseHours(raw: string | null): Schedule | null {
  if (!raw || !raw.trim()) return null;
  const text = raw.trim();

  const empty = () =>
    DAYS.map((day) => ({ day, label: DAY_NAMES[day], ranges: [] as string[] }));

  if (/^24\s*\/\s*7$/.test(text)) {
    return {
      days: DAYS.map((day) => ({ day, label: DAY_NAMES[day], ranges: ["Open 24 hours"] })),
      unparsed: false,
      raw: text,
      alwaysOpen: true,
    };
  }

  const days = empty();
  let matched = 0;

  for (const chunk of text.split(";")) {
    const part = chunk.trim();
    if (!part) continue;

    // `Mo-Fr 09:00-17:00` or `Mo-Fr off`
    const m = part.match(/^([A-Za-z]{2}(?:\s*[-,]\s*[A-Za-z]{2})*)\s+(.+)$/);
    if (!m) continue;

    const indexes = expandDays(m[1]);
    if (!indexes.length) continue;
    const rest = m[2].trim();

    if (/^(off|closed)$/i.test(rest)) {
      matched++;
      for (const i of indexes) days[i].ranges = [];
      continue;
    }
    if (/^24\s*hours?$/i.test(rest) || rest === "00:00-24:00") {
      matched++;
      for (const i of indexes) days[i].ranges = ["Open 24 hours"];
      continue;
    }

    const ranges = parseRanges(rest);
    if (!ranges.length) continue;
    matched++;
    for (const i of indexes) days[i].ranges = ranges;
  }

  if (matched === 0) {
    return { days: empty(), unparsed: true, raw: text, alwaysOpen: false };
  }
  return { days, unparsed: false, raw: text, alwaysOpen: false };
}

/** A one-line summary for a card, e.g. "Mon–Fri 09:00 – 17:00". */
export function summarise(schedule: Schedule | null): string | null {
  if (!schedule) return null;
  if (schedule.alwaysOpen) return "Open 24 hours";
  if (schedule.unparsed) return schedule.raw;

  const open = schedule.days.filter((d) => d.ranges.length > 0);
  if (!open.length) return null;

  // Collapse when every open day keeps the same hours, which is the common case.
  const first = open[0].ranges.join(", ");
  const uniform = open.every((d) => d.ranges.join(", ") === first);
  if (uniform && open.length > 1) {
    return `${open[0].label.slice(0, 3)}–${open[open.length - 1].label.slice(0, 3)} ${first}`;
  }
  return `${open[0].label.slice(0, 3)} ${first}`;
}
