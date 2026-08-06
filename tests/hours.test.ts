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
