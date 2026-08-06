import { describe, expect, it } from "vitest";
import { parseHours, summarise } from "@/lib/hours";

const open = (s: ReturnType<typeof parseHours>) =>
  s!.days.filter((d) => d.ranges.length > 0).map((d) => d.day);

describe("parseHours", () => {
  it("expands a weekday range", () => {
    const s = parseHours("Mo-Fr 09:00-17:00")!;
    expect(open(s)).toEqual(["Mo", "Tu", "We", "Th", "Fr"]);
    expect(s.days[0].ranges).toEqual(["09:00 – 17:00"]);
  });

  it("handles several clauses", () => {
    const s = parseHours("Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off")!;
    expect(open(s)).toEqual(["Mo", "Tu", "We", "Th", "Fr", "Sa"]);
    expect(s.days[5].ranges).toEqual(["10:00 – 14:00"]);
    expect(s.days[6].ranges).toEqual([]);
  });

  it("handles a split day", () => {
    const s = parseHours("Mo-Su 11:30-14:30,17:30-22:00")!;
    expect(s.days[0].ranges).toEqual(["11:30 – 14:30", "17:30 – 22:00"]);
  });

  it("wraps a range across the end of the week", () => {
    // Sa-Mo is Saturday, Sunday, Monday — not an empty range.
    expect(open(parseHours("Sa-Mo 10:00-16:00")!).sort()).toEqual(["Mo", "Sa", "Su"]);
  });

  it("handles a comma list of days", () => {
    expect(open(parseHours("Mo,We,Fr 08:00-12:00")!)).toEqual(["Mo", "We", "Fr"]);
  });

  it("understands 24/7", () => {
    const s = parseHours("24/7")!;
    expect(s.alwaysOpen).toBe(true);
    expect(s.days).toHaveLength(7);
    expect(s.days[3].ranges).toEqual(["Open 24 hours"]);
  });

  it("marks closed days closed rather than dropping them", () => {
    // Every day must be present, or the rendered table skips rows and the
    // reader cannot tell "closed" from "not stated".
    const s = parseHours("Mo-Fr 09:00-17:00")!;
    expect(s.days).toHaveLength(7);
    expect(s.days[6].ranges).toEqual([]);
  });

  it("returns the raw string rather than guessing when it cannot parse", () => {
    // Printing wrong opening hours on a business's own site is worse than
    // printing none — somebody drives there.
    const s = parseHours("sunrise-sunset; PH off")!;
    expect(s.unparsed).toBe(true);
    expect(s.raw).toBe("sunrise-sunset; PH off");
  });

  it("is null for no input", () => {
    expect(parseHours(null)).toBeNull();
    expect(parseHours("   ")).toBeNull();
  });

  it("ignores an unknown day token instead of throwing", () => {
    expect(() => parseHours("Xx-Yy 09:00-17:00")).not.toThrow();
  });
});

describe("summarise", () => {
  it("collapses a uniform week", () => {
    expect(summarise(parseHours("Mo-Fr 09:00-17:00"))).toBe("Mon–Fri 09:00 – 17:00");
  });

  it("does not claim uniformity when a day differs", () => {
    const out = summarise(parseHours("Mo-Fr 09:00-17:00; Sa 10:00-14:00"));
    expect(out).not.toContain("Mon–Sat");
  });

  it("passes 24/7 through", () => {
    expect(summarise(parseHours("24/7"))).toBe("Open 24 hours");
  });

  it("is null when nothing is open and null for no schedule", () => {
    expect(summarise(parseHours("Mo-Su off"))).toBeNull();
    expect(summarise(null)).toBeNull();
  });
});

describe("rules separated by commas rather than semicolons", () => {
  // The real record for a Newtown pub. The first parser read this as one rule
  // for Mo-Th, took the first time range, dropped the rest, and printed
  // "Closed" for Friday, Saturday and Sunday — for a pub that serves until two
  // in the morning on exactly those days. Nothing threw; it was just wrong.
  const raw = "Mo-Th 07:00-24:00, Fr,Sa 07:00-02:00, Su 10:00-24:00";

  it("reads every rule, not just the first", () => {
    const s = parseHours(raw)!;
    expect(s.unparsed).toBe(false);
    expect(s.days[0].ranges).toEqual(["07:00 – 24:00"]);
    expect(s.days[4].ranges).toEqual(["07:00 – 02:00"]);
    expect(s.days[5].ranges).toEqual(["07:00 – 02:00"]);
    expect(s.days[6].ranges).toEqual(["10:00 – 24:00"]);
  });

  it("never says closed for a day the record says is open", () => {
    const s = parseHours(raw)!;
    expect(s.days.filter((d) => d.ranges.length === 0)).toEqual([]);
  });

  it("keeps a day list inside a rule together", () => {
    // `Fr,Sa` is one rule for two days, not the end of one rule and the start
    // of another — the comma means both things in the same string.
    const s = parseHours("Mo-Th 09:00-17:00, Fr,Sa 10:00-14:00, Su off")!;
    expect(s.days[4].ranges).toEqual(["10:00 – 14:00"]);
    expect(s.days[5].ranges).toEqual(["10:00 – 14:00"]);
    expect(s.days[6].ranges).toEqual([]);
  });
});

describe("what it refuses to parse", () => {
  it("throws the whole parse away if any of the string was not understood", () => {
    // The safety property. A recognised fragment inside an unrecognised string
    // is the most dangerous thing this file can produce, because it looks like
    // an answer.
    const s = parseHours("Mo-Fr 09:00-17:00 || by appointment")!;
    expect(s.unparsed).toBe(true);
    expect(s.raw).toBe("Mo-Fr 09:00-17:00 || by appointment");
    expect(s.days.every((d) => d.ranges.length === 0)).toBe(true);
  });

  it("does not let a stray \"off\" close the entire week", () => {
    // With PH consumed as a qualifier, its trailing "off" used to match as a
    // rule with no days — and a rule with no days applies to all of them.
    const s = parseHours("Mo-Fr 08:00-18:00; Sa 09:00-13:00; PH off")!;
    expect(s.unparsed).toBe(false);
    expect(s.days[0].ranges).toEqual(["08:00 – 18:00"]);
    expect(s.days[5].ranges).toEqual(["09:00 – 13:00"]);
    expect(s.notes).toEqual(["Public holidays: closed"]);
  });
});

describe("summarise", () => {
  it("does not claim a span the days do not have", () => {
    // "Mon–Fri 09:00 – 17:00" for a business open Monday, Wednesday and Friday
    // is a lie of exactly the kind nobody checks.
    const s = parseHours("Mo,We,Fr 09:00-17:00")!;
    expect(summarise(s)).toBe("3 days a week, 09:00 – 17:00");
  });

  it("refuses to pick one day's hours when the week is not uniform", () => {
    const s = parseHours("Mo-Th 07:00-24:00, Fr,Sa 07:00-02:00, Su 10:00-24:00")!;
    expect(summarise(s)).toBe("Seven days, hours vary");
  });

  it("still collapses the uniform case, which is most of them", () => {
    expect(summarise(parseHours("Mo-Fr 09:00-17:00; Sa,Su off")!)).toBe("Mon–Fri 09:00 – 17:00");
  });
});

describe("a comma adds a rule, a semicolon replaces one", () => {
  it("keeps the evening service when a lunch rule is added for some days", () => {
    // A real Newtown restaurant: open every evening, and lunch Thursday to
    // Saturday as well. Treating the comma as a replacement stopped it serving
    // dinner at the weekend.
    const s = parseHours("Mo-Su 17:00-22:00, Th-Sa 11:30-14:00")!;
    expect(s.days[0].ranges).toEqual(["17:00 – 22:00"]);
    expect(s.days[3].ranges).toEqual(["11:30 – 14:00", "17:00 – 22:00"]);
    expect(s.days[6].ranges).toEqual(["17:00 – 22:00"]);
  });

  it("still lets a semicolon override, which is what it means", () => {
    const s = parseHours("Mo-Su 09:00-17:00; We off")!;
    expect(s.days[2].ranges).toEqual([]);
    expect(s.days[3].ranges).toEqual(["09:00 – 17:00"]);
  });
});
