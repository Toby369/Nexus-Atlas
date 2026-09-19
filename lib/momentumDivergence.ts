import type { MarketState } from "./types";

// Momentum-Divergenz-Warnhinweis (Prototyp, 19.09.2026) -- reine
// Anzeige-Ableitung aus bereits vorhandenen state.factors-Rohwerten, KEINE
// Aenderung an compute-market-state/Score/Threshold/overall_state selbst.
//
// Herleitung: Rueckblick-Auswertung (signal_outcomes/signal_stats_results,
// 24h-Horizont, Stand 19.09.2026) zeigte, dass BULLISH-Aufrufe bei
// etabliertem Trend (ADX>=25) UND bereits negativem MACD-Histogramm
// (Momentum bestaetigt den Trend nicht mehr) bisher 0 von 8 Treffern hatten
// (Ø -2.78% Forward-Return), waehrend BULLISH bei etabliertem Trend MIT
// bestaetigendem Momentum 58.8% Trefferquote hatte (Ø +0.84%) -- spiegel-
// bildlich fuer BEARISH+positives MACD-Histogramm. Ein bekanntes
// technisches Konzept (Momentum-Divergenz vor Trendwenden), hier erstmals
// gegen die live erfassten Nexus-Rueckblick-Daten geprueft.
//
// AUSDRUECKLICH ALS VORLAeUFIG ZU BEHANDELN: Stichprobe klein (8-41 Faelle
// je Gruppe, erst ~3.5 Wochen Historie seit Start der signal_outcomes-
// Erfassung) -- das Muster ist durchgaengig und mechanistisch plausibel,
// aber noch NICHT auf einer Basis, die als endgueltig statistisch belegt
// gilt (siehe PanelInfo-Text in HeroHeader.tsx fuer die volle Einordnung).
// Deshalb bewusst nur als informativer Hinweis, nicht als neue Schwelle in
// compute-market-state oder gar als Handelssignal umgesetzt.

const ESTABLISHED_TREND_ADX = 25;

export interface MomentumDivergenceResult {
  triggered: boolean;
  adx: number | null;
  macdHistogram: number | null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Nur fuer BULLISH/BEARISH ueberhaupt sinnvoll definiert (NEUTRAL/MIXED/
// INSUFFICIENT_DATA haben keine Richtung, der das Momentum widersprechen
// koennte).
export function detectMomentumDivergence(
  state: Pick<MarketState, "overall_state" | "factors">
): MomentumDivergenceResult {
  const adx = numberOrNull(state.factors?.trend_strength?.basis?.adx_14);
  const macdHistogram = numberOrNull(state.factors?.momentum?.basis?.macd_histogram);

  if (
    adx === null ||
    macdHistogram === null ||
    adx < ESTABLISHED_TREND_ADX ||
    (state.overall_state !== "BULLISH" && state.overall_state !== "BEARISH")
  ) {
    return { triggered: false, adx, macdHistogram };
  }

  const contradicts =
    (state.overall_state === "BULLISH" && macdHistogram < 0) ||
    (state.overall_state === "BEARISH" && macdHistogram > 0);

  return { triggered: contradicts, adx, macdHistogram };
}
