import { describe, expect, it } from "vitest";
import { getTradingHoursState } from "./tradingHours";

// Referenztag: Dienstag, 08.09.2026 -- normaler US-Handelstag, EDT (UTC-4)
// gilt noch (Sommerzeitende in den USA erst am ersten Sonntag im November).
// London ist im September ebenfalls in der Sommerzeit (BST, UTC+1).
const DI = "2026-09-08";
// Samstag, 05.09.2026 -- fuer den Wochenend-Test.
const SA = "2026-09-05";

function iso(dateIso: string, hhmmss: string): number {
  return Date.parse(`${dateIso}T${hhmmss}Z`);
}

describe("getTradingHoursState", () => {
  it("erkennt die US-Kassa als aktiv innerhalb 09:30-16:00 ET (13:30-20:00 UTC im September)", () => {
    const state = getTradingHoursState(iso(DI, "15:00:00"));
    expect(state.active.map((s) => s.id)).toContain("usCash");
  });

  it("erkennt die Ueberlappung London/US-Kassa (13:30-15:30 UTC im September)", () => {
    const state = getTradingHoursState(iso(DI, "14:00:00"));
    expect(state.overlapLondonUsCash).toBe(true);
  });

  it("keine Session ist am Wochenende aktiv", () => {
    const state = getTradingHoursState(iso(SA, "15:00:00"));
    expect(state.active).toHaveLength(0);
  });

  it("warnt vor der US-Kasseneroeffnung (09:30 ET = 13:30 UTC, Fenster -5/+15min)", () => {
    const state = getTradingHoursState(iso(DI, "13:30:00"));
    expect(state.warnings.some((w) => w.id === "opening" && w.level === "high")).toBe(true);
    expect(state.tradeable).toBe(false);
  });

  it("keine Eroeffnungs-Warnung weit ausserhalb des Fensters", () => {
    const state = getTradingHoursState(iso(DI, "12:00:00"));
    expect(state.warnings.some((w) => w.id === "opening")).toBe(false);
    expect(state.tradeable).toBe(true);
  });

  it("warnt NICHT vor Makro-Daten ohne echten Kalendertermin (kein taeglich blinkendes Fenster)", () => {
    // 08:30 ET = 12:30 UTC -- ohne uebergebene events soll das Fenster stumm bleiben.
    const state = getTradingHoursState(iso(DI, "12:30:00"), []);
    expect(state.warnings.some((w) => w.id === "macro")).toBe(false);
  });

  it("warnt vor Makro-Daten, wenn ein CPI/PCE/NFP-Termin an diesem Tag vorliegt", () => {
    const state = getTradingHoursState(iso(DI, "12:30:00"), [
      { event_key: "cpi", event_date: DI },
    ]);
    expect(state.warnings.some((w) => w.id === "macro" && w.level === "high")).toBe(true);
  });

  it("warnt vor FOMC nur mit echtem fomc-Termin an diesem Tag", () => {
    const mitTermin = getTradingHoursState(iso(DI, "18:00:00"), [
      { event_key: "fomc", event_date: DI },
    ]);
    expect(mitTermin.warnings.some((w) => w.id === "fomc")).toBe(true);

    const ohneTermin = getTradingHoursState(iso(DI, "18:00:00"), []);
    expect(ohneTermin.warnings.some((w) => w.id === "fomc")).toBe(false);
  });

  it("CME-Pause (17:00-18:00 ET, Mo-Do) ist eine mittlere, keine hohe Warnung", () => {
    const state = getTradingHoursState(iso(DI, "21:30:00")); // 17:30 ET
    const cme = state.warnings.find((w) => w.id === "cme");
    expect(cme?.level).toBe("medium");
    expect(state.tradeable).toBe(true); // medium blockt tradeable nicht
  });

  it("liefert kommende Ereignisse aufsteigend sortiert", () => {
    const state = getTradingHoursState(iso(DI, "06:00:00"));
    const times = state.upcoming.map((u) => u.atMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(state.upcoming.length).toBeGreaterThan(0);
  });
});
