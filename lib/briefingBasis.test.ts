import { describe, it, expect } from "vitest";
import { baueBasis } from "./briefingBasis";

// Die "Grundlage" unter dem System-Briefing. Geprueft wird vor allem, was im
// Betrieb still danebengehen wuerde: Einheiten (Prozent bleibt Prozent, ETF in
// Mio.) und dass eine fehlende Quelle nur ihre Zeile kostet.

type Ctx = Parameters<typeof baueBasis>[0];

const voll: Ctx = {
  btc_markt: {
    kurs_usd: 79838.4,
    stand_schweiz: "29.10. 20:00",
    veraenderung_24h_pct: -1.8,
    veraenderung_7d_pct: 2.3,
    hoch_7d_usd: 82100,
    tief_7d_usd: 78900,
  },
  market_state: {
    overall_state: "BEARISH",
    score: -22.4,
    confidence: 61,
    data_coverage_pct: 93,
    risk_level: "MEDIUM",
    risk_factors: null,
    patterns: [],
    mtf_alignment: null,
    factors: null,
  } as unknown as Ctx["market_state"],
  market_context: {
    label: "Short-Aufbau",
    bias: "bearish",
    explanation: "",
    price_change_pct: -0.84,
    oi_change_pct: 1.25,
    spot_verdict_label: "Verkaufsdruck",
  },
  etf_flows: { cumulative_usd_m: -312.5, days: 5, letzter_tag: { datum: "2026-10-28", usd_m: 104.2 } },
  rsi: { "4h": { aktuell: 38.6, vorher: 41 }, "1d": { aktuell: 47.2, vorher: 49 } },
  liquidations: { price_clusters: [], total_notional_usd: 84_000_000, total_oi_usd: null, lookback_hours: 24 },
  keyLevels: [
    { price: 80089, side: "resistance" },
    { price: 79553, side: "support" },
    { price: 81200, side: "resistance" },
  ] as unknown as Ctx["keyLevels"],
  wirtschaftskalender: [{ label: "US-BIP", event_date: "2026-10-30", zeit_schweiz: "13:30" }],
  news: { count: 3, lookback_hours: 24, schlagzeilen: [] },
  divergenzen: ["4H RSI klassisch bärisch"],
};

const zeile = (z: ReturnType<typeof baueBasis>, id: string) => z.find((x) => x.id === id)?.text ?? "";

describe("baueBasis", () => {
  it("Kurs mit Schweizer Tausendern und Veraenderungen in Prozent", () => {
    expect(zeile(baueBasis(voll), "kurs")).toBe("$79’838 · 24h -1.8 % · 7T +2.3 % · 7T-Spanne $78’900–$82’100");
  });

  it("Marktzustand auf Deutsch", () => {
    expect(zeile(baueBasis(voll), "marktzustand")).toBe("bärisch · Score -22 · Konfidenz 61 % · Abdeckung 93 % · Risiko mittel");
  });

  it("Marktkontext: Prozentwerte werden nicht nochmals mal 100 genommen", () => {
    const t = zeile(baueBasis(voll), "marktkontext");
    expect(t).toContain("Preis -0.84 %");
    expect(t).toContain("OI +1.25 %");
  });

  it("ETF-Flows in Mio. USD mit Vorzeichen", () => {
    expect(zeile(baueBasis(voll), "etf")).toBe("5 Tage -313 Mio. USD · 2026-10-28: +104 Mio. USD");
  });

  it("Levels nach Seite getrennt, hoechstes zuerst", () => {
    expect(zeile(baueBasis(voll), "levels")).toBe("Widerstand 81’200, 80’089 · Unterstützung 79’553");
  });

  it("Liquidationen als Stichprobe gekennzeichnet", () => {
    expect(zeile(baueBasis(voll), "liquidationen")).toBe("84 Mio. USD in 24 Std (Stichprobe)");
  });

  it("fehlende Quellen kosten nur ihre Zeile", () => {
    const z = baueBasis({
      ...voll,
      market_state: null,
      market_context: null,
      liquidations: null,
      keyLevels: [],
      wirtschaftskalender: [],
      divergenzen: [],
      etf_flows: { cumulative_usd_m: null, days: 0, letzter_tag: null },
    });
    expect(z.map((x) => x.id)).toEqual(["kurs", "rsi", "news"]);
  });

  it("bleibt klein (Speicher je Briefing)", () => {
    expect(JSON.stringify(baueBasis(voll)).length).toBeLessThan(2000);
  });
});
