import { describe, expect, it } from "vitest";
import { alreadyPushed, isQuietHour, parseSetupTitle, setupPushMessage, spotDirection4h } from "./setupPush";
import type { SetupIdea } from "./setupEngine";

const idea = (tone: SetupIdea["verdict"]["tone"], halfSize: string[] = []): SetupIdea =>
  ({
    side: "long",
    cluster: { lo: 58960, hi: 59531, levels: [{ name: "AVWAP ab 21.11., 07:15" }, { name: "1h, retestzone" }], score: 6, horizon: "intraday" },
    atCluster: true,
    distancePct: 0,
    entry: 59147,
    stop: 58698,
    stopPct: 0.76,
    stopWidened: true,
    targets: [{ price: 60978, pct: 3.1, crv: 4.1, name: "Linie" }],
    leverage: 13,
    evidence: [{ id: "spot", text: "Spot kauft: letzte und laufende Stunde", points: 3, max: 3, state: "ja" }],
    score: 9,
    against: ["Kurs unter dem Wochen-VWAP"],
    halfSize,
    vetos: [],
    verdict: { tone, short: "x" },
  }) as unknown as SetupIdea;

describe("Setup-Push", () => {
  it("nur bei Setup steht, mit Werten und Ausstiegsregel", () => {
    expect(setupPushMessage(idea("watch"))).toBeNull();
    const m = setupPushMessage(idea("trade", ["Hintergrund gegen dich"]))!;
    expect(m.title).toBe("Long-Setup steht · 58'960–59'531");
    expect(m.body).toContain("Stop 58'698");
    expect(m.body).toContain("halbe Grösse");
    expect(m.explanation).toContain("raus nur nach Plan");
  });

  it("Sperre: gleiche Seite, ueberlappender Bereich", () => {
    const m = setupPushMessage(idea("trade"))!;
    expect(parseSetupTitle("Long-Setup steht · 58'960–59'531")).toEqual({ side: "long", lo: 58960, hi: 59531 });
    expect(alreadyPushed(m, ["Long-Setup steht · 59'000–59'600"])).toBe(true);
    expect(alreadyPushed(m, ["Short-Setup steht · 59'000–59'600"])).toBe(false);
    expect(alreadyPushed(m, ["Long-Setup steht · 60'978"])).toBe(false);
    expect(alreadyPushed(m, ["BTC 59'000 · bärisch"])).toBe(false);
  });

  it("Spot-Richtung ueber 4 Stunden", () => {
    const now = Date.parse("2026-11-22T08:00:00Z");
    const pts = [
      { timestamp_utc: "2026-11-22T03:00:00Z", last_price: 1, taker_buy_vol: 0, taker_sell_vol: 999 },
      { timestamp_utc: "2026-11-22T07:00:00Z", last_price: 1, taker_buy_vol: 300, taker_sell_vol: 100 },
    ];
    expect(spotDirection4h(pts, now)).toBe("up");
    expect(spotDirection4h([], now)).toBeNull();
  });

  it("Ruhezeit 23-06 Uhr Schweizer Zeit", () => {
    expect(isQuietHour(Date.parse("2026-11-26T22:30:00Z"))).toBe(true); // 23:30
    expect(isQuietHour(Date.parse("2026-11-26T04:59:00Z"))).toBe(true); // 05:59
    expect(isQuietHour(Date.parse("2026-11-26T05:00:00Z"))).toBe(false); // 06:00
    expect(isQuietHour(Date.parse("2026-11-26T21:59:00Z"))).toBe(false); // 22:59
  });
});
