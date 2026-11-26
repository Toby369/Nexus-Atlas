import { describe, expect, it } from "vitest";
import { buildClusters, buildLevels, evaluateSetup, parseSwingInputs, rsiSeries, type SetupInput } from "./setupEngine";

const NOW = Date.parse("2026-11-22T07:20:00Z");

// 260 15m-Kerzen: Abwaertsdrift von 60'300 an die Zone, dann Reaktion nach oben.
function candles(): SetupInput["candles15m"] {
  const out = [];
  for (let i = 0; i < 260; i++) {
    const t = new Date(NOW - (260 - i) * 15 * 60_000).toISOString();
    const base = i < 230 ? 60_300 - i * 3 : i < 245 ? 59_610 - (i - 230) * 33 : 59_120 + (i - 245) * 8;
    out.push({ openTime: t, open: base + 10, high: base + 60, low: base - 60, close: base, volume: i === 259 ? 900 : 2000 });
  }
  return out;
}

const drawings = [
  { autark_id: 1, kind: "rechteck", label: "1h, retestzone", points: [{ t: 0, p: 59372.8 }, { t: 1, p: 59050 }] },
  { autark_id: 2, kind: "avwap", label: null, points: [{ t: Date.parse("2026-11-21T06:15:00Z"), p: 0 }] },
  { autark_id: 3, kind: "strahlH", label: "", points: [{ t: 0, p: 60978.3 }] },
  { autark_id: 4, kind: "rechteck", label: "1h, R, auf 4h", points: [{ t: 0, p: 61956.3 }, { t: 1, p: 62360 }] },
  { autark_id: 5, kind: "strahlH", label: "15m, swing hoch", points: [{ t: 0, p: 58649.7 }] },
  { autark_id: 6, kind: "pfeil", label: "x", points: [{ t: 0, p: 1 }, { t: 1, p: 2 }] },
];

const base: SetupInput = {
  price: 59_150,
  nowMs: NOW,
  candles15m: candles(),
  drawings,
  avwaps: { 2: 58_960 },
  weeklyVwap: 61_581,
  monthlyVwap: 68_371,
  spotBars: [
    { startMs: Date.parse("2026-11-22T06:00:00Z"), netPct: 8.5, complete: true },
    { startMs: Date.parse("2026-11-22T07:00:00Z"), netPct: 10.2, complete: false },
  ],
  spot4h: "down",
  oiChangePct: 1.8,
  fundingPct: 0.0055,
  crowdLongPct: 58,
  noisePct: 0.63,
  upcomingRisk: null,
  dataDay: null,
  tradesToday: 0,
  lossesInRow: 0,
};

describe("Setup-Rechner", () => {
  it("Level aus Zeichnungen: Zone 3, Linie 3, Swing 2, AVWAP 2 mit Ankername; Pfeil zaehlt nicht", () => {
    const levels = buildLevels({ ...base, ema50: 59_500, ema200: 59_960 });
    const byName = Object.fromEntries(levels.map((l) => [l.name, l]));
    expect(byName["1h, retestzone"]).toMatchObject({ lo: 59050, hi: 59372.8, weight: 3, own: true });
    expect(byName["15m, swing hoch"].weight).toBe(2);
    expect(byName["Linie"].weight).toBe(3);
    expect(Object.keys(byName).some((n) => n.startsWith("AVWAP ab 21.11."))).toBe(true);
    expect(byName["EMA 50 (15m)"]).toMatchObject({ weight: 1, own: false });
    expect(levels.some((l) => l.name === "x")).toBe(false);
  });

  it("Trendlinie, Strahl, Kanal und Fibonacci mit ihrem Wert jetzt", () => {
    const t0 = NOW - 10 * 3_600_000;
    const t1 = NOW - 5 * 3_600_000;
    const levels = buildLevels({
      ...base,
      drawings: [
        { autark_id: 10, kind: "trendlinie", label: "TL", points: [{ t: t0, p: 58000 }, { t: t1, p: 58500 }], style: { rechts: true } },
        { autark_id: 11, kind: "trendlinie", label: "kurz", points: [{ t: t0, p: 58000 }, { t: t1, p: 58500 }], style: {} },
        { autark_id: 12, kind: "strahl", label: null, points: [{ t: t0, p: 61000 }, { t: t1, p: 60500 }] },
        { autark_id: 13, kind: "kanal", label: null, points: [{ t: t0, p: 58000 }, { t: t1, p: 58500 }, { t: t0, p: 59000 }] },
        { autark_id: 14, kind: "kanal", label: "kaputt", points: [{ t: t0, p: 1 }, { t: t0, p: 1 }, { t: t1, p: 2 }] },
        { autark_id: 15, kind: "fib", label: "Swing", points: [{ t: t0, p: 60000 }, { t: t1, p: 62000 }], style: { stufen: [{ w: 0.618, an: true }, { w: 0.786, an: false }] } },
      ],
      ema50: null,
      ema200: null,
    });
    const by = (n: string) => levels.find((l) => l.name === n);
    expect(by("TL")?.lo).toBeCloseTo(59000); // 500 pro 5 h weiter bis jetzt
    expect(by("kurz")).toBeUndefined(); // endet vor jetzt, nicht verlaengert
    expect(by("Strahl")?.lo).toBeCloseTo(60000);
    expect(by("Kanal unten")?.lo).toBeCloseTo(59000);
    expect(by("Kanal oben")?.lo).toBeCloseTo(60000);
    expect(levels.some((l) => l.name.startsWith("kaputt"))).toBe(false);
    expect(by("Fib 0,618 (Swing)")).toMatchObject({ weight: 2 });
    expect(by("Fib 0,618 (Swing)")?.lo).toBeCloseTo(62000 - 0.618 * 2000);
    expect(levels.some((l) => l.name.startsWith("Fib 0,786"))).toBe(false);
  });

  it("Cluster: Level innerhalb 0,3 % zusammen, nur mit eigener Zeichnung", () => {
    const clusters = buildClusters(buildLevels({ ...base, ema50: 59_500, ema200: 59_960 }));
    const support = clusters.find((c) => c.lo < 59_000 && c.hi > 59_300)!;
    expect(support.levels.map((l) => l.name)).toContain("1h, retestzone");
    expect(support.levels.some((l) => l.name.startsWith("AVWAP"))).toBe(true);
    // EMA 200 allein bildet keinen Cluster
    expect(clusters.some((c) => c.levels.every((l) => !l.own))).toBe(false);
  });

  it("22.11. 08:20: Long am Cluster, Belege reichen, halbe Groesse wegen Hintergrund", () => {
    const { ideas } = evaluateSetup(base);
    const long = ideas[0];
    expect(long.side).toBe("long");
    expect(long.atCluster).toBe(true);
    expect(long.evidence.find((e) => e.id === "spot")).toMatchObject({ points: 3, state: "ja" });
    expect(long.evidence.find((e) => e.id === "volume")?.points).toBe(1);
    expect(long.score).toBeGreaterThanOrEqual(7);
    expect(long.verdict.tone).toBe("trade");
    expect(long.halfSize).toContain("Hintergrund gegen dich");
    expect(long.targets[0].price).toBeCloseTo(60978.3);
    // Stop auf 1H-Rauschen x 1,2 geweitet, Hebel passt sich an
    expect(long.stopWidened).toBe(true);
    expect(long.stopPct).toBeCloseTo(0.756, 2);
    expect(long.leverage).toBe(13);
  });

  it("Spot nur in der laufenden Stunde zaehlt nicht (07:20)", () => {
    const { ideas } = evaluateSetup({
      ...base,
      spotBars: [
        { startMs: Date.parse("2026-11-22T06:00:00Z"), netPct: -7.5, complete: true },
        { startMs: Date.parse("2026-11-22T07:00:00Z"), netPct: 8, complete: false },
      ],
    });
    expect(ideas[0].evidence.find((e) => e.id === "spot")).toMatchObject({ points: 0, state: "teil" });
  });

  it("Veto: Termin, Tageslimit, CRV", () => {
    expect(evaluateSetup({ ...base, upcomingRisk: "CPI in 20 Min" }).ideas[0].verdict).toMatchObject({ tone: "stop" });
    expect(evaluateSetup({ ...base, lossesInRow: 2 }).ideas[0].vetos).toContain("2 Verluste in Folge");
    const noTarget = evaluateSetup({ ...base, drawings: drawings.filter((d) => d.autark_id !== 3 && d.autark_id !== 4) });
    expect(noTarget.ideas[0].vetos.some((v) => v.startsWith("Kein Ziel"))).toBe(true);
  });

  it("weit weg vom Cluster: warten mit Abstand", () => {
    const { ideas } = evaluateSetup({ ...base, price: 60_200 });
    expect(ideas.every((i) => i.verdict.tone === "wait")).toBe(true);
  });

  it("Swing-Cluster: Belege auf 4H, Spot 24 h + 7 Tage, ETF statt OI, Ziel ab 3 %", () => {
    // 240 4H-Kerzen: Abwaertsdrift an die 4H-Zone 59'000-59'400, letzte Kerze schliesst darueber.
    const c4 = [];
    for (let i = 0; i < 240; i++) {
      const p = i < 230 ? 66_000 - i * 29 : 59_330 - (i - 230) * 20;
      const last = i === 239;
      c4.push({ openTime: new Date(NOW - (241 - i) * 4 * 3_600_000).toISOString(), open: p + 30, high: p + 250, low: last ? 59_100 : p - 250, close: last ? 59_450 : p, volume: last ? 500 : 1500 });
    }
    const input: SetupInput = {
      ...base,
      price: 59_450,
      candles15m: candles().map((k) => ({ ...k, close: k.close + 300, high: k.high + 300, low: k.low + 300 })),
      drawings: [
        { autark_id: 1, kind: "rechteck", label: "4h zone", points: [{ t: 0, p: 59_000 }, { t: 1, p: 59_400 }] },
        { autark_id: 2, kind: "rechteck", label: "1d widerstand", points: [{ t: 0, p: 64_000 }, { t: 1, p: 64_400 }] },
        { autark_id: 3, kind: "strahlH", label: "4h", points: [{ t: 0, p: 60_200 }] },
      ],
      avwaps: {},
      swing: { candles4h: c4, spot24hPct: 6.1, spot7dPct: 2.4, etfUsdM: 850, etfDays: 5 },
    };
    const long = evaluateSetup(input).ideas.find((i) => i.side === "long")!;
    expect(long.cluster.horizon).toBe("swing");
    expect(long.swingEvidence).toBe(true);
    const by = Object.fromEntries(long.evidence.map((e) => [e.id, e]));
    expect(by.close).toMatchObject({ points: 2 });
    expect(by.close.text).toContain("4H");
    expect(by.spot).toMatchObject({ points: 3, state: "ja" });
    expect(by.etf).toMatchObject({ points: 1 });
    expect(by.oi).toBeUndefined();
    expect(by.volume.points).toBe(1);
    expect(long.evidence.reduce((s, e) => s + e.max, 0)).toBe(10);
    // 60'200 liegt unter 3 % -> erstes Ziel ist der 1D-Widerstand
    expect(long.targets[0].price).toBe(64_000);

    // Nur 24 h kauft, 7 Tage nicht: halb, 0 Punkte. ETF gegen dich: 0.
    const mixed = evaluateSetup({ ...input, swing: { ...input.swing!, spot7dPct: -2.7, etfUsdM: -2500 } }).ideas.find((i) => i.side === "long")!;
    const m = Object.fromEntries(mixed.evidence.map((e) => [e.id, e]));
    expect(m.spot).toMatchObject({ points: 0, state: "teil" });
    expect(m.etf.points).toBe(0);

    // Ohne Swing-Daten: Intraday-Belege wie bisher.
    const plain = evaluateSetup({ ...input, swing: null }).ideas.find((i) => i.side === "long")!;
    expect(plain.swingEvidence).toBe(false);
    expect(plain.evidence.some((e) => e.id === "oi")).toBe(true);
  });

  it("Swing-Eingaben aus der Datenbank: Netto in %, ETF-Summe, laufende 4H-Kerze raus", () => {
    const s = parseSwingInputs(
      {
        candles4h: [
          { open_time: new Date(NOW - 8 * 3_600_000).toISOString(), open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
          { open_time: new Date(NOW - 2 * 3_600_000).toISOString(), open: 1, high: 2, low: 0.5, close: 1.5, volume: null },
        ],
        spot24h: { buy: 9282.6, sell: 8221.7 },
        spot7d: { buy: 0, sell: 0 },
        etf: [{ flow_date: "2026-11-25", usd_m: -453.1 }, { flow_date: "2026-11-24", usd_m: -231.6 }, { flow_date: "2026-11-21", usd_m: null }],
      },
      NOW
    )!;
    expect(s.candles4h).toHaveLength(1);
    expect(s.spot24hPct).toBeCloseTo(6.06, 1);
    expect(s.spot7dPct).toBeNull();
    expect(s.etfUsdM).toBeCloseTo(-684.7);
    expect(s.etfDays).toBe(2);
    expect(parseSwingInputs(null, NOW)).toBeNull();
  });

  it("RSI-Grenzen", () => {
    const up = rsiSeries(Array.from({ length: 30 }, (_, i) => 100 + i));
    expect(up[29]).toBe(100);
  });
});
