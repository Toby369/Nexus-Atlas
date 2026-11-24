import { describe, it, expect } from "vitest";
import {
  groupUsCalendarByDay,
  startOfZurichDayMs,
  usEventInfo,
  zurichDayKey,
  type UsCalendarWeekEvent,
} from "./usCalendarWeek";

function ev(title: string, event_time: string, impact: "High" | "Medium" = "High"): UsCalendarWeekEvent {
  return { title, event_time, impact, forecast: null, previous: null };
}

describe("usEventInfo", () => {
  it("ordnet Core PCE vor dem allgemeinen PCE/CPI-Muster ein", () => {
    expect(usEventInfo("Core PCE Price Index m/m").de).toBe("PCE-Kernrate (Preisindex), Monat");
  });

  it("unterscheidet BIP und BIP-Preisindex", () => {
    expect(usEventInfo("Prelim GDP q/q").rule).toBe("Uneindeutig");
    expect(usEventInfo("Prelim GDP Price Index q/q").rule).toBe("Höher = bärisch");
  });

  it("ADP gewinnt vor Non-Farm", () => {
    expect(usEventInfo("ADP Non-Farm Employment Change").de).toBe("ADP-Beschäftigung (Privatwirtschaft)");
    expect(usEventInfo("Non-Farm Employment Change").de).toBe("Arbeitsmarktbericht (Nonfarm Payrolls)");
  });

  it("nutzt für Inflationswerte 'Höher = bärisch', für PMIs 'Uneindeutig'", () => {
    expect(usEventInfo("CPI m/m").rule).toBe("Höher = bärisch");
    expect(usEventInfo("Flash Services PMI").rule).toBe("Uneindeutig");
  });

  it("fällt für unbekannte Termine auf den Originaltitel und einen Standardtext zurück", () => {
    const info = usEventInfo("Something New");
    expect(info.de).toBe("Something New");
    expect(info.rule).toBe("Uneindeutig");
    expect(info.what.length).toBeGreaterThan(0);
  });
});

describe("groupUsCalendarByDay", () => {
  it("gruppiert nach Schweizer Kalendertag und sortiert nach Zeit", () => {
    // 08:30 ET (Winter) = 14:30 Schweizer Zeit; 19:30 ET = 01:30 am Folgetag.
    const days = groupUsCalendarByDay(
      [
        ev("Late", "2026-11-25T19:30:00-05:00"),
        ev("Core PCE Price Index m/m", "2026-11-25T08:30:00-05:00"),
        ev("Prelim GDP q/q", "2026-11-25T08:30:00-05:00"),
      ],
      false
    );
    expect(days.map((d) => d.dayKey)).toEqual(["2026-11-25", "2026-11-26"]);
    expect(days[0].events.map((e) => e.title)).toEqual(["Core PCE Price Index m/m", "Prelim GDP q/q"]);
    expect(days[1].events.map((e) => e.title)).toEqual(["Late"]);
  });

  it("filtert mit onlyHigh die mittleren Termine heraus", () => {
    const days = groupUsCalendarByDay(
      [ev("A", "2026-11-25T08:30:00-05:00", "High"), ev("B", "2026-11-25T09:45:00-05:00", "Medium")],
      true
    );
    expect(days.flatMap((d) => d.events.map((e) => e.title))).toEqual(["A"]);
  });

  it("liefert bei leerer Eingabe eine leere Liste", () => {
    expect(groupUsCalendarByDay([], false)).toEqual([]);
  });
});

describe("startOfZurichDayMs", () => {
  it("liefert Mitternacht Schweizer Zeit (Winter: 23:00 UTC am Vortag)", () => {
    const now = new Date("2026-11-24T10:28:00+01:00").getTime();
    expect(zurichDayKey(now)).toBe("2026-11-24");
    expect(startOfZurichDayMs(now)).toBe(new Date("2026-11-23T23:00:00Z").getTime());
  });
});
