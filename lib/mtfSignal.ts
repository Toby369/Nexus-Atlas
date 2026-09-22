import { supabase } from "./supabase";
import type { MarketFeaturesMtfRow } from "./types";

// MTF-Ampel (Multi-Timeframe-Signalzeile), Nutzer-Wunsch 22.09.2026:
// "Nexus zeigt MTF Signale an, 15m/1h/4h/1D/1W, sinnvoll?" -- fasst je
// Zeitrahmen structure_trend (Swing-Struktur, market_features -- dieselbe
// Quelle wie MTF-Alignment in der compute-market-state Edge Function) +
// ADX-Schwelle (dieselbe 25er-Wilder-Schwelle wie TREND_EXPANSION_* vs.
// TREND_FORMING_* in classify_market_regime(), siehe Migration
// close_regime_adx_dead_zone_trend_forming) zu einem 6-stufigen Ampel-
// Status zusammen. Bewusst KEINE neue Berechnung/kein neuer Cron -- reine
// Anzeige bereits vorhandener market_features-Spalten.
//
// 1W ist bewusst immer "no_data": collect-candles sammelt aktuell nur
// 1m/15m/1h/4h/1d (siehe dortiger INTERVALS-Kommentar) -- keine Wochen-
// kerzen vorhanden. Eine erfundene 1W-Aussage waere schlimmer als eine
// ehrliche Luecke (dieselbe Philosophie wie UNRESOLVED_NEUTRAL/
// INSUFFICIENT_DATA an anderer Stelle im Projekt).

export type MtfDotStatus =
  | "bullish_confirmed"
  | "bullish_forming"
  | "bearish_confirmed"
  | "bearish_forming"
  | "neutral"
  | "no_data";

export interface MtfTimeframeDot {
  timeframe: string; // Anzeige-Label, z.B. "15M"
  status: MtfDotStatus;
  detail: string; // Tooltip-Text (native title-Attribut, siehe RegimeMatrixCard)
}

// Zeitrahmen, fuer die market_features tatsaechlich gepflegt wird (collect-
// candles) -- Reihenfolge = Anzeige-Reihenfolge von kurz nach lang.
export const MTF_TIMEFRAMES: { interval: string; label: string }[] = [
  { interval: "15m", label: "15M" },
  { interval: "1h", label: "1H" },
  { interval: "4h", label: "4H" },
  { interval: "1d", label: "1D" },
];

// Dieselbe Wilder-Schwelle wie TREND_EXPANSION_* in classify_market_regime()
// (research-python/src/regime.py::RegimeThresholds.adx_trend_threshold) --
// ADX >= 25 gilt als bestaetigter Trend, darunter (bei sonst uebereinstimmender
// Struktur) als "Trendbildung" statt vollem Trend.
const ADX_TREND_THRESHOLD = 25;

const INTERVAL_MS: Record<string, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

// Wie lange eine Kerze nach ihrem Schluss noch als "aktuell" gilt -- 2x
// Intervalllaenge (Puffer fuer einen verspaeteten Cron-Lauf), mindestens
// 30 Minuten. Gleiches Prinzip wie isFreshCandle() in der compute-market-
// state Edge Function, hier lokal nachgebildet (Frontend hat keinen Zugriff
// auf die Function).
function maxAgeMsFor(interval: string): number {
  const intervalMs = INTERVAL_MS[interval] ?? 60 * 60 * 1000;
  return Math.max(intervalMs * 2, 30 * 60 * 1000);
}

function isFreshCandle(candleOpenTimeIso: string, interval: string): boolean {
  const closeTimeMs = new Date(candleOpenTimeIso).getTime() + (INTERVAL_MS[interval] ?? 0);
  const ageMs = Date.now() - closeTimeMs;
  return ageMs >= 0 && ageMs <= maxAgeMsFor(interval);
}

function fmtAdx(adx: number | null): string {
  return adx !== null ? adx.toFixed(0) : "—";
}

export function classifyMtfDot(timeframeLabel: string, row: MarketFeaturesMtfRow | null): MtfTimeframeDot {
  if (!row || !isFreshCandle(row.candle_open_time, row.interval)) {
    return { timeframe: timeframeLabel, status: "no_data", detail: `${timeframeLabel}: keine aktuellen Daten` };
  }

  const { structure_trend, adx_14 } = row;
  if (structure_trend === "bullish") {
    return adx_14 !== null && adx_14 >= ADX_TREND_THRESHOLD
      ? { timeframe: timeframeLabel, status: "bullish_confirmed", detail: `${timeframeLabel}: bullisch (ADX ${fmtAdx(adx_14)})` }
      : {
          timeframe: timeframeLabel,
          status: "bullish_forming",
          detail: `${timeframeLabel}: Trendbildung bullisch (ADX ${fmtAdx(adx_14)} < 25)`,
        };
  }
  if (structure_trend === "bearish") {
    return adx_14 !== null && adx_14 >= ADX_TREND_THRESHOLD
      ? { timeframe: timeframeLabel, status: "bearish_confirmed", detail: `${timeframeLabel}: bärisch (ADX ${fmtAdx(adx_14)})` }
      : {
          timeframe: timeframeLabel,
          status: "bearish_forming",
          detail: `${timeframeLabel}: Trendbildung bärisch (ADX ${fmtAdx(adx_14)} < 25)`,
        };
  }
  return { timeframe: timeframeLabel, status: "neutral", detail: `${timeframeLabel}: neutral/seitwärts` };
}

// Reine Zusammenfuehrung (keine I/O) -- rowsByInterval kommt aus einem
// server- oder client-seitigen Supabase-Read, siehe getLatestMtfDots()
// (app/page.tsx) bzw. fetchMtfDots() (components/RegimeMatrixCard.tsx).
export function buildMtfDots(rowsByInterval: Record<string, MarketFeaturesMtfRow | null>): MtfTimeframeDot[] {
  const dots = MTF_TIMEFRAMES.map((tf) => classifyMtfDot(tf.label, rowsByInterval[tf.interval] ?? null));
  dots.push({
    timeframe: "1W",
    status: "no_data",
    detail: "1W: Wochenkerzen werden aktuell nicht erfasst",
  });
  return dots;
}

export const MTF_DOT_COLOR_CLASSES: Record<MtfDotStatus, string> = {
  bullish_confirmed: "bg-up",
  bullish_forming: "bg-accent",
  bearish_confirmed: "bg-down",
  bearish_forming: "bg-accent",
  neutral: "bg-text-faint",
  no_data: "bg-surface-raised border border-border",
};

// Client-seitiger Fetch, gemeinsam genutzt von jeder Kachel mit eigenem
// Live-Poll (RegimeMatrixCard, HeroHeader, TradeDebateCard, Nutzer-Wunsch
// 22.09.2026: "auf alle Kacheln anwenden") -- eine Query je Zeitrahmen,
// analoges Muster wie mtf_alignment in der compute-market-state Edge
// Function. An EINER Stelle statt pro Kachel dupliziert, weil ab drei
// Konsumenten derselben Query die Kopie mehr Pflegeaufwand als Nutzen
// gebracht haette (anders als sonst im Projekt ueblich, wo jede Kachel
// ihren eigenen kleinen Fetch haelt).
export async function fetchMtfDots(): Promise<MtfTimeframeDot[]> {
  const rows = await Promise.all(
    MTF_TIMEFRAMES.map(async ({ interval }) => {
      const { data, error } = await supabase
        .from("market_features")
        .select("interval, candle_open_time, structure_trend, adx_14")
        .eq("symbol", "BTCUSDT")
        .eq("interval", interval)
        .order("candle_open_time", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error(`Fehler beim Laden der MTF-Ampel (${interval}):`, error.message);
        return [interval, null] as const;
      }
      return [interval, data] as const;
    })
  );
  return buildMtfDots(Object.fromEntries(rows));
}
