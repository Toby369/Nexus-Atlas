import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Candle } from "./candles";
import { computeZoneHistory, timeframeFromLabel, zoneHistoryText, zoneHistoryTexts, zoneKey } from "./zoneHistory";

const fixture = JSON.parse(
  readFileSync(path.join(__dirname, "__fixtures__", "btc_1h_2026-10-28_2026-11-11.json"), "utf8")
) as { kerzen: [string, number, number, number, number][] };
const real1h: Candle[] = fixture.kerzen.map(([openTime, open, high, low, close]) => ({ openTime, open, high, low, close }));

/** Synthetische 1h-Kerzen aus Schlusskursen, Docht 0,2 um Eroeffnung und Schluss. */
function candles(closes: number[], wick = 0.2): Candle[] {
  return closes.map((close, i) => {
    const open = i ? closes[i - 1] : close;
    return {
      openTime: new Date(Date.UTC(2026, 10, 1, i)).toISOString(),
      open,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick,
      close,
    };
  });
}

describe("timeframeFromLabel", () => {
  it.each([
    ["1h, 4x angelaufen", "1h"],
    ["1H verkäuferzone", "1h"],
    ["4H Verkäufer Zone", "4h"],
    ["1D verkäufer zone", "1d"],
    ["D support `24", "1d"],
    ["Daily tief, support", "1d"],
  ])("%s -> %s", (label, tf) => expect(timeframeFromLabel(label)).toBe(tf));

  it.each(["verkäufer", "W close 29.6.26", "Dach", null, ""])("%s -> null", (label) =>
    expect(timeframeFromLabel(label)).toBeNull()
  );
});

describe("computeZoneHistory", () => {
  it("zaehlt Beruehrungen nur beim frischen Eintritt", () => {
    // Zone 99-100, Kurs darueber, zwei getrennte Besuche (der erste ueber zwei Kerzen)
    const h = computeZoneHistory(candles([103, 102, 100.1, 100.1, 102, 104, 100.3, 103]), 99, 100, "1h");
    expect(h.initialSide).toBe("above");
    expect(h.events.map((e) => e.kind)).toEqual(["beruehrung", "beruehrung"]);
  });

  it("wertet einen Schluss darunter mit Rueckkehr innerhalb von 3 Kerzen als Fehlausbruch", () => {
    const h = computeZoneHistory(candles([103, 102, 98.5, 99.5, 101, 103]), 99, 100, "1h");
    expect(h.events.map((e) => e.kind)).toEqual(["fehlausbruch"]);
    expect(h.side).toBe("above");
  });

  it("bestaetigt einen Bruch mit zwei Schluessen in Folge und dreht die Rolle beim Retest", () => {
    const h = computeZoneHistory(candles([103, 101, 98.5, 97, 95, 94, 96, 99.2, 97, 95]), 99, 100, "1h");
    expect(h.events.map((e) => e.kind)).toEqual(["bruch", "beruehrung"]);
    expect(h.side).toBe("below");
    expect(zoneHistoryText(h)).toMatch(/Bruch 01\.11\. · Retest 01\.11\. → jetzt R$/);
  });

  it("bestaetigt einen Bruch, wenn der Kurs 3 Kerzen lang nicht auf die alte Seite zurueckschliesst", () => {
    // 98.5 darunter, 99.5 in der Zone (kein zweiter Schluss darunter), dann 98, 97: keine Rueckkehr ueber 100
    const h = computeZoneHistory(candles([103, 102, 98.5, 99.5, 98, 97, 95]), 99, 100, "1h");
    expect(h.events.map((e) => e.kind)).toEqual(["bruch"]);
  });

  it("laesst einen frischen Schluss jenseits offen, solange Kerzen fehlen", () => {
    const h = computeZoneHistory(candles([103, 102, 98.5]), 99, 100, "1h");
    expect(h.pendingBreak).not.toBeNull();
    expect(zoneHistoryText(h)).toMatch(/Bruch noch offen/);
  });

  it("zaehlt knapp nicht angelaufene Zonen (bis 0,25 ATR davor) als Beruehrung", () => {
    // ATR rund 1.4; Tief der dritten Kerze 100.2 liegt 0.2 ueber der Zone
    const h = computeZoneHistory(candles([103, 102, 100.4, 102, 103]), 99, 100, "1h");
    expect(h.events).toHaveLength(1);
    expect(h.events[0].near).toBe(true);
    expect(zoneHistoryText(h)).toContain("1× berührt, davon 1 knapp");
  });

  it("gruene 1h-Zone 76'270-76'796: 04.11. Fehlausbruch, 05.11. Bruch, danach Retest und Widerstand", () => {
    const h = computeZoneHistory(real1h, 76_270, 76_796.4, "1h");
    const kinds = h.events.map((e) => `${e.kind} ${e.time.slice(0, 13)}`);
    expect(kinds).toContain("fehlausbruch 2026-11-04T02");
    const brk = h.events.find((e) => e.kind === "bruch");
    expect(brk?.time.slice(0, 10)).toBe("2026-11-05");
    expect(h.side).toBe("below");
    const text = zoneHistoryText(h);
    expect(text).toMatch(/^1h: S, \d+× berührt/);
    expect(text).toContain("Fehlausbruch 04.11.");
    expect(text).toContain("Bruch 05.11.");
    expect(text).toMatch(/Retest .* → jetzt R$/);
  });
});

describe("zoneHistoryText", () => {
  it("haengt die Jahreszahl an, wenn ein Datum nicht im Jahr der letzten Kerze liegt", () => {
    const daily: Candle[] = [103, 100.5, 103, 103].map((close, i) => ({
      openTime: new Date(Date.UTC(2025, 11, 30 + i)).toISOString(),
      open: close,
      high: close + 0.2,
      low: close - 0.2,
      close,
    }));
    expect(zoneHistoryText(computeZoneHistory(daily, 99, 100.4, "1d"))).toBe("1D: S, 1× berührt (31.12.25)");
  });
});

describe("zoneHistoryTexts", () => {
  it("gibt Zonen ohne Zeiteinheit einen Hinweis", () => {
    const t = zoneHistoryTexts([{ low: 99, high: 100, label: "verkäufer" }], { "1h": candles([103, 102]) });
    expect(t[zoneKey(99, 100)]).toMatch(/Zeiteinheit/);
  });
});
