import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { zoneAlarms } from "../supabase/functions/_shared/zoneAlarmCore";
import { computeZoneHistory, type ZoneCandle } from "../supabase/functions/_shared/zoneHistoryCore";

const fixture = JSON.parse(
  readFileSync(path.join(__dirname, "__fixtures__", "btc_1h_2026-10-28_2026-11-11.json"), "utf8")
) as { kerzen: [string, number, number, number, number][] };
const real1h: ZoneCandle[] = fixture.kerzen.map(([openTime, open, high, low, close]) => ({ openTime, open, high, low, close }));
const green = { low: 76_270, high: 76_796.4, label: null };

function candles(closes: number[], wick = 0.2): ZoneCandle[] {
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

describe("zoneAlarms", () => {
  it("meldet vor dem ersten Bruch nichts (Fehlausbruch 04.11. ist noch keine gedrehte Zone)", () => {
    const h = computeZoneHistory(real1h, green.low, green.high, "1h");
    const alarms = zoneAlarms(h, green, "2026-10-28T00:00:00Z");
    expect(alarms.some((a) => a.key.includes("fehlausbruch:2026-11-04"))).toBe(false);
  });

  it("meldet nach dem Bruch vom 05.11. jeden Retest als abgelehnt", () => {
    const h = computeZoneHistory(real1h, green.low, green.high, "1h");
    const alarms = zoneAlarms(h, green, "2026-10-28T00:00:00Z");
    expect(alarms.length).toBeGreaterThan(0);
    expect(alarms[0].title).toMatch(/^Zone 76’270–76’796 \(1h\): Retest (knapp )?abgelehnt$/);
    expect(alarms[0].body).toMatch(/^1h-Schluss .* unter der Zone\. Seit Bruch 05\.11\. jetzt R \(1\. Retest\)\.$/);
    expect(new Set(alarms.map((a) => a.key)).size).toBe(alarms.length);
  });

  it("meldet nur Ereignisse, die ab dem Stichzeitpunkt entschieden wurden", () => {
    const h = computeZoneHistory(real1h, green.low, green.high, "1h");
    const all = zoneAlarms(h, green, "2026-10-28T00:00:00Z");
    const late = zoneAlarms(h, green, "2026-11-07T00:00:00Z");
    expect(late.length).toBeLessThan(all.length);
    expect(late.every((a) => a.details[2].startsWith("Retest: 07.11."))).toBe(true);
  });

  it("meldet einen zweiten Bruch als akzeptiert, mit Rollentausch", () => {
    // S-Zone 99-100: Bruch nach unten, Retest, dann zurueckerobert (zwei Schluesse darueber)
    const h = computeZoneHistory(candles([103, 102, 98.5, 97, 95, 94, 96, 99.2, 97, 95, 98, 100.8, 101.5, 102]), 99, 100, "1h");
    const kinds = zoneAlarms(h, { low: 99, high: 100, label: "1h test" }, "2026-11-01T00:00:00Z").map((a) => a.title);
    expect(kinds).toEqual([
      "Zone 99–100 (1h · 1h test): Retest abgelehnt",
      "Zone 99–100 (1h · 1h test): akzeptiert",
    ]);
  });
});
