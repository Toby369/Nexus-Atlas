import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { zoneAlarms, zoneAlarmsForPush } from "../supabase/functions/_shared/zoneAlarmCore";
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
    expect(alarms[0].body).toMatch(/^1h-Schluss .* unter der Zone \(\d\d\.\d\d\. \d\d:\d\d\)\. Seit Bruch 05\.11\. jetzt R \(1\. Retest\)\.$/);
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
      "Zone 99–100 (1h · test): Retest abgelehnt",
      "Zone 99–100 (1h · test): akzeptiert",
    ]);
  });
});

describe("zoneAlarmsForPush", () => {
  // S-Zone 99-100: Retest (Kerze 07:00), dann zurueckerobert (Bruch ab 11:00, entschieden mit Kerze 12:00)
  const series = candles([103, 102, 98.5, 97, 95, 94, 96, 99.2, 97, 95, 98, 100.8, 101.5, 102]);
  const zone = { low: 99, high: 100, label: "1h, retestzone" };
  const h = computeZoneHistory(series, 99, 100, "1h");
  const since = "2026-11-01T00:00:00Z";

  it("nennt die Zeiteinheit im Titel nur einmal und die Schlusszeit im Text", () => {
    const [a] = zoneAlarms(h, zone, since);
    expect(a.title).toBe("Zone 99–100 (1h · retestzone): Retest abgelehnt");
    expect(a.body).toMatch(/\(\d\d\.\d\d\. \d\d:\d\d\)/);
  });

  it("schickt je Zone nur das juengste Ereignis", () => {
    expect(zoneAlarms(h, zone, since).length).toBeGreaterThan(1);
    const out = zoneAlarmsForPush(h, zone, since, null);
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("akzeptiert");
  });

  it("liefert fuer eine neue Zone keine Ereignisse nach, die vor dem Anlegen entschieden waren", () => {
    const last = series[series.length - 1].openTime;
    // Zone angelegt nach Schluss aller Kerzen: nichts ist mehr frisch
    const afterAll = new Date(new Date(last).getTime() + 3_600_000 + 60_000).toISOString();
    expect(zoneAlarmsForPush(h, zone, since, afterAll)).toEqual([]);
    // Zone angelegt vor der Kerze, die den Bruch entschied (12:00-Kerze schliesst 13:00): Alarm bleibt
    const beforeDecision = "2026-11-01T12:30:00Z";
    const out = zoneAlarmsForPush(h, zone, since, beforeDecision);
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("akzeptiert");
    // Zone angelegt, nachdem nur der Retest entschieden war (Kerze 07:00 schloss 08:00): nur das spaetere Ereignis bleibt
    const mid = zoneAlarmsForPush(h, zone, since, "2026-11-01T09:00:00Z");
    expect(mid).toHaveLength(1);
    expect(mid[0].title).toContain("akzeptiert");
  });
});
