import { describe, expect, it } from "vitest";
import { computeLogPriceChannel, type LogChannelInputPoint } from "./logPriceChannel";

function dayIso(offsetDays: number): string {
  return new Date(Date.UTC(2024, 0, 1) + offsetDays * 24 * 60 * 60 * 1000).toISOString();
}

describe("computeLogPriceChannel", () => {
  it("gibt null zurueck bei zu wenigen Punkten", () => {
    const points: LogChannelInputPoint[] = Array.from({ length: 10 }, (_, i) => ({
      t: dayIso(i),
      price: 100,
    }));
    expect(computeLogPriceChannel(points)).toBeNull();
  });

  it("gibt null zurueck, wenn alle Punkte auf denselben Tag fallen (keine Regression moeglich)", () => {
    const points: LogChannelInputPoint[] = Array.from({ length: 100 }, () => ({
      t: dayIso(0),
      price: 100,
    }));
    expect(computeLogPriceChannel(points)).toBeNull();
  });

  it("erkennt eine perfekt log-lineare Reihe als exakt 'Auf Trendkanal'", () => {
    // price = 100 * 10^(0.001*t) -- exakt log-linear, der letzte Punkt liegt
    // damit per Konstruktion GENAU auf der Regressionslinie.
    const points: LogChannelInputPoint[] = Array.from({ length: 200 }, (_, i) => ({
      t: dayIso(i),
      price: 100 * Math.pow(10, 0.001 * i),
    }));
    const result = computeLogPriceChannel(points);
    expect(result).not.toBeNull();
    expect(result!.slope).toBeCloseTo(0.001, 6);
    expect(result!.currentBandLabel).toBe("Auf Trendkanal");
  });

  it("erkennt einen Ausreisser deutlich ueber dem Trendkanal", () => {
    const points: LogChannelInputPoint[] = Array.from({ length: 199 }, (_, i) => ({
      t: dayIso(i),
      price: 100 * Math.pow(10, 0.0005 * i),
    }));
    // Letzter Punkt: 10x ueber dem, was die Regressionslinie an diesem Tag vorhersagt.
    const lastDay = 199;
    const trendPrice = 100 * Math.pow(10, 0.0005 * lastDay);
    points.push({ t: dayIso(lastDay), price: trendPrice * 10 });

    const result = computeLogPriceChannel(points);
    expect(result).not.toBeNull();
    expect(result!.currentBandLabel).toMatch(/über/i);
  });

  it("bei konstantem Preis ist die Steigung ~0 und das Band 'Auf Trendkanal'", () => {
    const points: LogChannelInputPoint[] = Array.from({ length: 100 }, (_, i) => ({
      t: dayIso(i),
      price: 50000,
    }));
    const result = computeLogPriceChannel(points);
    expect(result).not.toBeNull();
    expect(result!.slope).toBeCloseTo(0, 6);
    expect(result!.currentBandLabel).toBe("Auf Trendkanal");
  });
});
