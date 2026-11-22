import { describe, expect, it } from "vitest";
import { buildClusters, buildLevels, evaluateSetup, rsiSeries, type SetupInput } from "./setupEngine";

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

  it("RSI-Grenzen", () => {
    const up = rsiSeries(Array.from({ length: 30 }, (_, i) => 100 + i));
    expect(up[29]).toBe(100);
  });
});
