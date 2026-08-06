/**
 * Parses OSM `opening_hours` into something a website can show.
 *
 * The full specification is enormous — it covers public holidays, sunset
 * offsets, week numbers and month ranges. This handles the shape that actually
 * appears on high-street businesses:
 *
 *   Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off
 *   Mo-Su 11:30-14:30,17:30-22:00
 *   Mo-Th 07:00-24:00, Fr,Sa 07:00-02:00, Su 10:00-24:00
 *   24/7
 *
 * Anything it does not understand is returned as `raw` and rendered verbatim
 * rather than guessed at. Printing wrong opening hours on a business's own
 * website is worse than printing none, because someone drives there.
 *
 * That promise was broken once, and it is worth writing down how. The first
 * version split rules on `;` alone. Given a real pub —
 *
 *   Mo-Th 07:00-24:00, Fr,Sa 07:00-02:00, Su 10:00-24:00
 *
 * — it read the whole string as one rule for `Mo-Th`, took the first time range
 * and discarded the rest, and produced a schedule saying the pub was **closed
 * on Friday, Saturday and Sunday**. It is open until two in the morning on
 * those days. Nothing failed; a wrong answer was printed confidently.
 *
 * So parsing is no longer "find what you recognise and ignore the rest". Whole
 * rules are matched, and then what is left over is checked: if any of the
 * string was not consumed by a rule, the parse is thrown away and the raw value
 * is shown verbatim. A parser that cannot tell you what it did not understand
 * is a parser that will do this again.
 *
 * The separators are not interchangeable either, which is the third thing the
 * first version had wrong. In the grammar a `;` **replaces** what came before
 * for those days and a `,` **adds** to it. So
 *
 *   Mo-Su 17:00-22:00, Th-Sa 11:30-14:00
 *
 * is a restaurant open every evening that also does lunch Thursday to Saturday
 * — not one that stops serving dinner at the weekend.
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
  /** Rules that are real but do not belong in a weekly table, e.g. "PH off". */
  notes: string[];
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

const D = "(?:Mo|Tu|We|Th|Fr|Sa|Su)";
/** `Mo`, `Mo-Fr`, `Fr,Sa`, `Mo-We,Fr` — a day list with optional ranges. */
const DAYSPEC = `${D}(?:\\s*-\\s*${D})?(?:\\s*,\\s*${D}(?:\\s*-\\s*${D})?)*`;
const TIME = "\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2}";
/** `09:00-17:00`, `11:30-14:30,17:30-22:00`, `off`, `closed`, `24 hours`. */
const TIMESPEC = `(?:${TIME}(?:\\s*,\\s*${TIME})*|off|closed|24\\s*hours?)`;
/** Times with no days apply to every day — but only *times*. */
const OPEN_SPEC = `(?:${TIME}(?:\\s*,\\s*${TIME})*|24\\s*hours?)`;
/**
 * A whole rule: days and their times, or times alone meaning every day.
 *
 * A day-less `off` is deliberately not a rule. Allowing it meant the trailing
 * `off` of `PH off`, once the `PH` had been consumed as a qualifier, matched as
 * a rule with no days and closed all seven of them.
 */
const RULE = new RegExp(`(?:(${DAYSPEC})\\s+(${TIMESPEC}))|(${OPEN_SPEC})`, "gi");

/**
 * Rules about days that are not days of the week.
 *
 * `PH off` — closed on public holidays — is on a large share of real records,
 * and it says nothing about any Monday. Refusing to parse the whole string
 * because of it threw away a perfectly good week and fell back to showing the
 * raw OSM syntax to a customer. So these are consumed and carried separately,
 * to be shown as a note beside the table rather than folded into it.
 */
const QUALIFIER = /\b(PH|SH|easter)\b\s*(off|closed|open|\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})?/gi;
const QUALIFIER_NAMES: Record<string, string> = {
  ph: "Public holidays",
  sh: "School holidays",
  easter: "Easter",
};

/** Everything a rule separator may legally be, for the leftovers check. */
const SEPARATORS = /[;,\s]+/g;

/** Adds a rule's ranges to a day's, in time order, without duplicating. */
function mergeRanges(existing: string[], extra: string[]): string[] {
  const all = [...existing];
  for (const r of extra) if (!all.includes(r)) all.push(r);
  return all.sort((a, b) => a.localeCompare(b));
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
      notes: [],
      raw: text,
      alwaysOpen: true,
    };
  }

  const days = empty();
  const notes: string[] = [];
  let matched = 0;
  // Whatever no rule claims. If anything is left, the parse is not trusted.
  // Qualifiers come out of the text *before* rules are matched, not just out of
  // the leftovers, or their tails get read as rules in their own right.
  let scan = text;
  for (const q of text.matchAll(QUALIFIER)) {
    scan = scan.replace(q[0], " ");
    const name = QUALIFIER_NAMES[q[1].toLowerCase()] ?? q[1];
    const what = (q[2] ?? "").trim().toLowerCase();
    notes.push(
      what === "off" || what === "closed" ? `${name}: closed`
      : what === "open" ? `${name}: open`
      : what ? `${name}: ${what}`
      : `${name}: see below`,
    );
  }
  let leftovers = scan;

  let cursor = 0;
  for (const m of scan.matchAll(RULE)) {
    const indexes = m[1] ? expandDays(m[1]) : [0, 1, 2, 3, 4, 5, 6];
    const rest = (m[2] ?? m[3] ?? "").trim();

    // What sat between the end of the last rule and the start of this one says
    // whether this rule adds to the day or replaces it.
    const gap = scan.slice(cursor, m.index ?? cursor);
    cursor = (m.index ?? 0) + m[0].length;
    const replaces = gap.includes(";") || matched === 0;

    if (!indexes.length || !rest) continue;

    // Blank out what this rule consumed, so the remainder can be inspected.
    leftovers = leftovers.replace(m[0], " ");

    if (/^(off|closed)$/i.test(rest)) {
      matched++;
      for (const i of indexes) days[i].ranges = [];
      continue;
    }

    const ranges = /^24\s*hours?$/i.test(rest) || /^0?0:00\s*-\s*24:00$/.test(rest)
      ? ["Open 24 hours"]
      : parseRanges(rest);
    if (!ranges.length) continue;
    matched++;
    for (const i of indexes) {
      days[i].ranges = replaces ? ranges : mergeRanges(days[i].ranges, ranges);
    }
  }

  // The safety property. A recognised fragment inside an unrecognised string
  // is not a schedule — it is the most dangerous thing this file can produce.
  if (leftovers.replace(SEPARATORS, "").length > 0) {
    return { days: empty(), unparsed: true, notes: [], raw: text, alwaysOpen: false };
  }

  if (matched === 0) {
    return { days: empty(), unparsed: true, notes: [], raw: text, alwaysOpen: false };
  }
  return { days, unparsed: false, notes, raw: text, alwaysOpen: false };
}

/** A one-line summary for a card, e.g. "Mon–Fri 09:00 – 17:00". */
export function summarise(schedule: Schedule | null): string | null {
  if (!schedule) return null;
  if (schedule.alwaysOpen) return "Open 24 hours";
  if (schedule.unparsed) return schedule.raw;

  const open = schedule.days.filter((d) => d.ranges.length > 0);
  if (!open.length) return null;

  const first = open[0].ranges.join(", ");
  const uniform = open.every((d) => d.ranges.join(", ") === first);

  // "Mon–Fri" is only true if the open days actually run Monday to Friday. For
  // a business open Monday, Wednesday and Friday it is a lie, and it is the
  // kind nobody checks.
  const indexes = schedule.days.flatMap((d, i) => (d.ranges.length ? [i] : []));
  const contiguous = indexes.every((v, k) => k === 0 || v === indexes[k - 1] + 1);

  if (uniform && open.length === 1) return `${open[0].label.slice(0, 3)} ${first}`;
  if (uniform && contiguous) {
    return `${open[0].label.slice(0, 3)}–${open[open.length - 1].label.slice(0, 3)} ${first}`;
  }
  if (uniform) return `${open.length} days a week, ${first}`;

  // Hours differ across the week, so any single line would misrepresent it.
  // The day count is the most that can be said without opening the table.
  return open.length === 7 ? "Seven days, hours vary" : `${open.length} days a week, hours vary`;
}
