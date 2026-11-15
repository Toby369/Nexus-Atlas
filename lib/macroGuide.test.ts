import { describe, expect, it } from "vitest";
import { dataDayLabel, MACRO_DATA_DAY_KEYS, MACRO_EVENT_GUIDE } from "./macroGuide";

describe("macroGuide", () => {
  it("jeder Datentag-Termin hat einen Lerntext", () => {
    for (const k of MACRO_DATA_DAY_KEYS) expect(MACRO_EVENT_GUIDE[k]?.rules).toContain("Halbe Grösse");
  });

  it("Datentag nach Schweizer Datum, mit Uhrzeit", () => {
    const now = Date.parse("2026-12-09T08:00:00Z");
    const events = [
      { event_key: "fomc", event_date: "2026-12-09" },
      { event_key: "cpi", event_date: "2026-12-10" },
      { event_key: "ism", event_date: "2026-12-09" },
    ];
    expect(dataDayLabel(now, events)).toBe("FOMC 20:00");
    expect(dataDayLabel(Date.parse("2026-12-10T06:00:00Z"), events)).toBe("CPI 14:30");
    expect(dataDayLabel(Date.parse("2026-12-11T06:00:00Z"), events)).toBeNull();
  });
});
