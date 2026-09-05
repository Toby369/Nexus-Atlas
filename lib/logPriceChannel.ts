// Log-Preiskanal (Umsetzungsplan Phase 5, 05.09.2026) -- reduzierte
// Annaeherung an das "Rainbow Chart"-Konzept aus dem Crypto-Trading-
// Journal (dort: "rainbow chart with self-computed regression bands").
//
// WICHTIG, ehrlich benannt: der echte, oeffentlich bekannte Rainbow-Chart
// braucht eine log-Regression ueber den VOLLEN Marktzyklus seit 2013 (mehrere
// vollstaendige Boom-Bust-Zyklen), damit die Regressionslinie einen echten
// langfristigen Fairwert-Trend abbildet. Nexus' eigene candles-Tabelle
// deckt nur ~2 Jahre (seit dem Binance-Backfill) -- eine Regression darueber
// ist kein Ersatz fuer den echten Rainbow-Chart, sondern approximiert
// bestenfalls den AKTUELLEN Trendkanal der letzten ~2 Jahre. Das ist der
// Grund, warum dieses Modul bewusst NICHT "Rainbow Chart" heisst.
//
// Die volle Historie liegt bereit, sobald ein COINGECKO_API_KEY hinterlegt
// ist (siehe supabase/functions/collect-btc-price-history-daily) -- dann
// braucht nur die Datenquelle in lib/logPriceChannelContext.ts umgestellt
// zu werden, dieses Modul selbst aendert sich nicht.
//
// Reine Funktion, keine Netzwerk-/DB-Zugriffe.

export interface LogChannelInputPoint {
  t: string; // ISO-Zeitstempel
  price: number;
}

export interface LogChannelBand {
  label: string;
  offsetLog10: number;
  priceAtNow: number;
}

export interface LogPriceChannelResult {
  slope: number;
  intercept: number;
  daysCovered: number;
  currentPrice: number;
  currentBandLabel: string;
  bands: LogChannelBand[];
}

const BAND_STEPS: { label: string; offset: number }[] = [
  { label: "Deutlich unter Trendkanal", offset: -0.3 },
  { label: "Unter Trendkanal", offset: -0.15 },
  { label: "Auf Trendkanal", offset: 0 },
  { label: "Über Trendkanal", offset: 0.15 },
  { label: "Deutlich über Trendkanal", offset: 0.3 },
];

const MIN_POINTS = 60;

/** @param points Beliebige Reihenfolge, Tages-Schlusskurse. */
export function computeLogPriceChannel(points: LogChannelInputPoint[]): LogPriceChannelResult | null {
  if (points.length < MIN_POINTS) return null;

  const sorted = [...points].sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
  const startMs = new Date(sorted[0].t).getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  const xs = sorted.map((p) => (new Date(p.t).getTime() - startMs) / dayMs);
  const ys = sorted.map((p) => Math.log10(p.price));

  const n = xs.length;
  const sumX = xs.reduce((a, x) => a + x, 0);
  const sumY = ys.reduce((a, y) => a + y, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sumXX = xs.reduce((a, x) => a + x * x, 0);

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null; // alle Punkte am selben Tag -- keine sinnvolle Regression

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  const currentDay = xs[xs.length - 1];
  const currentPrice = sorted[sorted.length - 1].price;
  const regressionLogNow = intercept + slope * currentDay;
  const actualOffset = Math.log10(currentPrice) - regressionLogNow;

  const bands = BAND_STEPS.map((b) => ({
    label: b.label,
    offsetLog10: b.offset,
    priceAtNow: Math.pow(10, regressionLogNow + b.offset),
  }));

  let currentBandLabel = bands[0].label;
  let bestDistance = Infinity;
  for (const b of BAND_STEPS) {
    const distance = Math.abs(actualOffset - b.offset);
    if (distance < bestDistance) {
      bestDistance = distance;
      currentBandLabel = b.label;
    }
  }

  return { slope, intercept, daysCovered: Math.round(currentDay), currentPrice, currentBandLabel, bands };
}
