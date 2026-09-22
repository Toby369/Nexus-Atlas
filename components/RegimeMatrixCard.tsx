"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  AnchoredSummary,
  MarketState,
  MarketStateMatrix,
  ShortTermRangeCheck,
  TradingViewSignal,
} from "@/lib/types";
import PanelInfo from "@/components/PanelInfo";
import { marketStateMatrixInfo, REGIME_MATRIX_METRIC_INFO } from "@/lib/panelInfo";
import { formatAnchorBadge, formatAnchorRangeBadge } from "@/lib/anchor";
import {
  DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD,
  UNCLEAR_STATE_LABEL,
  engineDivergenceStatusLabel,
} from "@/lib/marketStateSummary";
import {
  regimeLabel,
  regimeDescription,
  regimeColorClass,
  shouldSuppressRegimeDirectionalLabel,
  isTrendingRegime,
  computeEngineDivergence,
  trendVerdict,
  signDirection,
  rsiDirection,
  bbPercentBDirection,
  quadrantDirection,
  SIGNAL_DIRECTION_LABEL,
  SIGNAL_DIRECTION_COLOR,
  type SignalDirection,
} from "@/lib/marketRegime";
import {
  TRADINGVIEW_SIGNAL_FRESHNESS_HOURS,
  formatSignalBadge,
  isSignalFresh,
  TRADINGVIEW_SIGNAL_INFO,
} from "@/lib/tradingViewSignal";
import { RelativeTime } from "@/components/ClientTimestamp";
import { MTF_TIMEFRAMES, buildMtfDots, MTF_DOT_COLOR_CLASSES, type MtfTimeframeDot } from "@/lib/mtfSignal";

// Regime-Daten aendern sich hoechstens stuendlich (1H-Kerzen-Raster, siehe
// compute_market_state_matrix_series) -- kein 30s-Live-Takt noetig wie bei
// Preis/Positioning, aehnliche Ueberlegung wie EtfFlowPanel.tsx.
const REFRESH_INTERVAL_MS = 5 * 60_000;

const QUADRANT_LABELS: Record<string, string> = {
  long_buildup: "Long-Aufbau",
  short_buildup: "Short-Aufbau",
  short_covering: "Short-Covering",
  long_unwind: "Long-Abbau",
  neutral: "neutral",
};

function fmtNum(v: number | null, decimals = 2): string {
  return v !== null ? v.toFixed(decimals) : "—";
}

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

// Richtungs-Badge hinter einer Saeulen-Kennzahl (siehe lib/marketRegime.ts
// fuer die Herleitung pro Kennzahl) -- gleiche farbliche Sprache wie
// factorColor/factorLabel in MarketStateCard.tsx.
function SignalBadge({ direction }: { direction: SignalDirection }) {
  return (
    <span className={`ml-1 ${SIGNAL_DIRECTION_COLOR[direction]}`}>
      ({SIGNAL_DIRECTION_LABEL[direction]})
    </span>
  );
}

async function fetchLatestMatrix(): Promise<{ data: MarketStateMatrix | null; ok: boolean }> {
  const { data, error } = await supabase
    .from("market_state_matrix")
    .select("*")
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Fehler beim Laden der Market State Matrix:", error.message);
    return { data: null, ok: false };
  }
  return { data, ok: true };
}

// MTF-Ampel (22.09.2026, siehe lib/mtfSignal.ts): eine Query je Zeitrahmen,
// analoges Fetch-Muster wie getLatestMtfDots() in app/page.tsx.
async function fetchMtfDots(): Promise<MtfTimeframeDot[]> {
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

// 20.09.2026: kurzfristiger Seitwaerts-Check (siehe lib/types.ts::
// ShortTermRangeCheck) -- eigener RPC-Read, unabhaengig von der 1h-Matrix
// oben, daher eigene Fetch-Funktion statt Wiederverwendung.
async function fetchShortTermRangeCheck(): Promise<ShortTermRangeCheck | null> {
  const { data, error } = await supabase.rpc("get_short_term_range_check");
  if (error) {
    console.error("Fehler beim Laden des kurzfristigen Seitwaerts-Checks:", error.message);
    return null;
  }
  return data?.[0] ?? null;
}

// Phase 2 TradingView-Integration: juengstes Signal der letzten
// TRADINGVIEW_SIGNAL_FRESHNESS_HOURS. Der Frische-Cutoff steckt bereits im
// Query (wie beim initialen Server-Fetch in app/page.tsx) -- kein
// zusaetzlicher isSignalFresh()-Check noetig fuer das, was diese Funktion
// zurueckgibt, isSignalFresh() bleibt aber die geteilte, getestete
// Referenz fuer die Zeitspanne (keine doppelt gepflegte Zahl).
async function fetchLatestTradingViewSignal(): Promise<TradingViewSignal | null> {
  const cutoff = new Date(Date.now() - TRADINGVIEW_SIGNAL_FRESHNESS_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("tradingview_signals")
    .select("*")
    .gte("received_at", cutoff)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Fehler beim Laden des TradingView-Signals:", error.message);
    return null;
  }
  return data;
}

// MTF-Ampel (22.09.2026): kompakte Badge-Zeile neben dem Kachel-Titel --
// Mischung aus zwei mit Toby abgestimmten Mockup-Varianten ("A": Zeitrahmen-
// Labels direkt sichtbar statt nur Hover-Tooltip, "C": kein neuer Kachel-
// Platz, Badge sitzt im bestehenden Header). Jeder Punkt traegt zusaetzlich
// ein natives title-Attribut mit der vollen Begruendung (ADX-Wert etc.),
// gleiches Muster wie der Anker-Badge oben im Header.
function MtfDotsRow({ dots }: { dots: MtfTimeframeDot[] }) {
  return (
    <div className="flex items-center gap-[7px]">
      {dots.map((dot) => (
        <div key={dot.timeframe} className="flex flex-col items-center gap-0.5" title={dot.detail}>
          <span className={`w-2 h-2 rounded-full ${MTF_DOT_COLOR_CLASSES[dot.status]}`} />
          <span className="tabular text-[8px] leading-none text-text-faint">{dot.timeframe}</span>
        </div>
      ))}
    </div>
  );
}

export default function RegimeMatrixCard({
  initialMatrix,
  initialMtfDots,
  initialShortTermRangeCheck,
  marketState,
  initialTradingViewSignal,
  anchorIso,
  anchorEndIso,
  initialAnchoredSummary,
}: {
  initialMatrix: MarketStateMatrix | null;
  // MTF-Ampel (22.09.2026, siehe lib/mtfSignal.ts) -- unabhaengig von
  // initialMatrix (das ist ausschliesslich die 1H-Regime-Engine), deckt
  // 15M/1H/4H/1D ab (1W immer "keine Daten", siehe buildMtfDots()).
  initialMtfDots: MtfTimeframeDot[];
  // Kurzfristiger Seitwaerts-Check (20.09.2026, siehe fetchShortTermRangeCheck
  // oben) -- unabhaengig von initialMatrix, kann null sein (z.B. zu wenig
  // 15m-Historie fuer die letzten 16 Bars).
  initialShortTermRangeCheck: ShortTermRangeCheck | null;
  // Fuer die Confidence-Sperre (siehe unten) -- dieselbe market_states-Zeile,
  // die MarketStateCard bereits erhaelt, kein Zusatz-Query.
  marketState: MarketState | null;
  // Phase 2 TradingView-Integration: rein informatives Kontext-Badge, siehe
  // Render-Block unten. null, wenn kein frisches Signal vorliegt (haeufigster
  // Fall, solange noch kein TradingView-Alert konfiguriert ist).
  initialTradingViewSignal: TradingViewSignal | null;
  // "Seit Anker"-Regime-Vergleich (Phase 1 "Anchored Analytics" auf die
  // Regime Matrix erweitert): dieselbe get_anchored_summary-RPC wie
  // LivePricePanel/LiquidationPanel, hier nur regime_at_anchor/
  // confidence_at_anchor ausgewertet statt Preis/OI.
  anchorIso: string | null;
  // Optionales Ende eines Anker-ZEITRAUMS (06.09.2026, Kerzenchart-Anker) --
  // null beim bisherigen Einzel-Anker-Verhalten ("bis jetzt").
  anchorEndIso: string | null;
  initialAnchoredSummary: AnchoredSummary | null;
}) {
  const [matrix, setMatrix] = useState(initialMatrix);
  const [mtfDots, setMtfDots] = useState(initialMtfDots);
  const [lastSyncOk, setLastSyncOk] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [tradingViewSignal, setTradingViewSignal] = useState(initialTradingViewSignal);
  const [anchoredSummary, setAnchoredSummary] = useState(initialAnchoredSummary);
  const [shortTermRangeCheck, setShortTermRangeCheck] = useState(initialShortTermRangeCheck);

  useEffect(() => {
    const load = async () => {
      const [{ data, ok }, signal, rangeCheck, dots] = await Promise.all([
        fetchLatestMatrix(),
        fetchLatestTradingViewSignal(),
        fetchShortTermRangeCheck(),
        fetchMtfDots(),
      ]);
      setLastSyncOk(ok);
      if (ok && data) setMatrix(data);
      setTradingViewSignal(signal);
      setShortTermRangeCheck(rangeCheck);
      setMtfDots(dots);
    };
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Wie LivePricePanel.tsx: eigener Effekt, nur aktiv wenn ein Anker
  // gesetzt ist. Kein synchrones setState bei fehlendem Anker (react-hooks/
  // set-state-in-effect) -- die JSX-Stelle unten ist selbst an
  // "anchorIso &&" gebunden, ein veralteter State wird also nie gerendert.
  useEffect(() => {
    if (!anchorIso) return;
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase.rpc("get_anchored_summary", {
        p_anchor: anchorIso,
        p_anchor_end: anchorEndIso,
      });
      if (cancelled) return;
      if (error) {
        console.error("Fehler beim Laden der Anchored Summary:", error.message);
        return;
      }
      setAnchoredSummary(data ?? null);
    };
    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [anchorIso, anchorEndIso]);

  if (!matrix) {
    return (
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">
            Marktphase
          </h2>
          <div className="flex items-center gap-2">
            <MtfDotsRow dots={mtfDots} />
            <PanelInfo title="Marktphase" content={marketStateMatrixInfo} />
          </div>
        </div>
        <p className="text-sm text-text-faint mt-3">Noch keine Regime-Daten vorhanden.</p>
      </section>
    );
  }

  // Gleiche Confidence-Sperre wie MarketStateCard (Phase 1, Punkt 3.1 --
  // "Option A, nur Anzeige-Ebene", siehe lib/marketRegime.ts::
  // shouldSuppressRegimeDirectionalLabel).
  const suppressDirectional = shouldSuppressRegimeDirectionalLabel(
    matrix.regime,
    marketState?.confidence ?? null
  );

  const displayLabel = suppressDirectional ? UNCLEAR_STATE_LABEL : regimeLabel(matrix.regime);
  const badgeColor = suppressDirectional ? "text-text-faint" : regimeColorClass(matrix.regime);

  // Engine-Divergenz (siehe lib/marketRegime.ts::computeEngineDivergence):
  // vergleicht die Richtung von Market State (14-Faktoren-Summe) und Regime
  // Matrix (ADX/Steigungs-Klassifikation) direkt anhand ihrer Ground-Truth-
  // Werte. Nur angezeigt, wenn die Confidence-Sperre oben NICHT bereits
  // greift (suppressDirectional) -- sonst wuerde hier eine konkrete
  // Richtung genannt, obwohl die Kachel-Ueberschrift gerade "Unklar / kein
  // Zustand" zeigt, weil dieselbe Confidence zu niedrig fuer eine
  // Richtungsaussage ist. NOT_COMPARABLE wird bewusst nicht angezeigt (der
  // haeufigste Fall -- kein Befund, keine Meldung noetig, gleiche
  // Konvention wie die patterns-Liste in MarketStateCard).
  const engineDivergence = suppressDirectional
    ? "NOT_COMPARABLE"
    : computeEngineDivergence(marketState?.overall_state ?? null, matrix.regime);
  const marketStateDirectionLabel =
    marketState?.overall_state === "BULLISH"
      ? "bullisch"
      : marketState?.overall_state === "BEARISH"
        ? "bärisch"
        : null;

  // Kurzfristiger Seitwaerts-Check (20.09.2026): nur relevant, wenn die 1h-
  // Engine gerade eine gerichtete Trendausweitung zeigt UND diese
  // Richtungsaussage nicht schon durch die Confidence-Sperre unterdrueckt
  // wird (suppressDirectional) -- sonst wuerde hier ein "Trend evtl.
  // nachlaufend"-Hinweis zu einer Richtung erscheinen, die ohnehin schon als
  // "Unklar" angezeigt wird.
  const showStaleTrendHint =
    !suppressDirectional && isTrendingRegime(matrix.regime) && shortTermRangeCheck?.is_ranging === true;

  // "Seit Anker"-Regime-Vergleich: dieselbe Confidence-Sperre wie oben,
  // nur mit der Confidence zum Anker-Zeitpunkt statt der aktuellen --
  // verhindert, dass hier eine Richtungsaussage auftaucht, die zu diesem
  // historischen Zeitpunkt eigentlich als "Unklar / kein Zustand" gegolten
  // haette.
  const anchorRegime = anchoredSummary?.regime_at_anchor ?? null;
  const anchorRegimeLabel = anchorRegime
    ? shouldSuppressRegimeDirectionalLabel(anchorRegime, anchoredSummary?.confidence_at_anchor ?? null)
      ? UNCLEAR_STATE_LABEL
      : regimeLabel(anchorRegime)
    : null;
  const anchorRegimeChanged = anchorRegimeLabel !== null && anchorRegimeLabel !== displayLabel;

  // Richtungs-Badges fuer die Saeulen-Kennzahlen (siehe lib/marketRegime.ts
  // fuer die Herleitung je Kennzahl) -- einmal berechnet statt in der JSX
  // wiederholt.
  const trendDirection = trendVerdict(matrix.adx_14, matrix.plus_di, matrix.minus_di, matrix.linreg_slope);
  const bbPercentBDir = bbPercentBDirection(matrix.bb_percent_b);
  const rsiDir = rsiDirection(matrix.rsi_14);
  const distZ20Dir = signDirection(matrix.dist_zscore_sma20, 0.25);
  const distZ50Dir = signDirection(matrix.dist_zscore_sma50, 0.25);
  const distZ200Dir = signDirection(matrix.dist_zscore_sma200, 0.25);
  const fundingZDir = signDirection(matrix.funding_zscore, 0.25);
  const cvdZDir = signDirection(matrix.cvd_zscore, 0.25);
  const priceChangeDir = signDirection(matrix.price_change_pct);
  const quadrantDir = quadrantDirection(matrix.oi_price_quadrant);
  const netTakerFlowDir = signDirection(matrix.net_taker_flow_ratio, 0.05);

  return (
    <section className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">
            Marktphase
          </h2>
          {anchorIso && (
            <span
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-accent/30 text-accent"
              title="Zeigt weiter unten zusätzlich das Regime seit dem gesetzten Event-Anker."
            >
              ⚓ Anker
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <MtfDotsRow dots={mtfDots} />
          <PanelInfo title="Marktphase" content={marketStateMatrixInfo} />
        </div>
      </div>

      {!lastSyncOk && (
        <p className="text-xs text-down">
          Sync-Problem — zuletzt bekanntes Regime wird angezeigt.
        </p>
      )}

      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <p className={`text-xl sm:text-2xl font-semibold ${badgeColor}`}>{displayLabel}</p>
        <RelativeTime iso={matrix.timestamp_utc} className="text-xs text-text-faint" />
      </div>

      {suppressDirectional ? (
        <p className="text-xs text-text-faint">
          Berechnetes Regime war {regimeLabel(matrix.regime)}, aber die Verlässlichkeit der
          Gesamteinschätzung liegt unter {DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD}/100 — für eine
          Richtungsaussage zu unsicher, daher hier als &bdquo;{UNCLEAR_STATE_LABEL}&ldquo;
          angezeigt. Säulen-Detail unten unverändert einsehbar.
        </p>
      ) : (
        <p className="text-xs text-text-muted leading-relaxed">
          {regimeDescription(matrix.regime)}
        </p>
      )}

      {anchorIso && (
        <div className="space-y-0.5">
          <p className="text-xs text-text-faint">
            {anchoredSummary?.anchor_end_timestamp_utc
              ? formatAnchorRangeBadge(new Date(anchorIso), new Date(anchoredSummary.anchor_end_timestamp_utc))
              : `Seit Anker (${formatAnchorBadge(new Date(anchorIso))}):`}
          </p>
          {anchorRegimeLabel ? (
            <p className="text-xs text-text-muted">
              Regime beim Anker: {anchorRegimeLabel} → jetzt: {displayLabel}
              {anchorRegimeChanged && (
                <span className="ml-1.5 text-[11px] uppercase tracking-wide text-accent">
                  geändert
                </span>
              )}
            </p>
          ) : (
            <p className="text-xs text-text-faint">
              Keine Regime-Daten für diesen Zeitpunkt verfügbar (Anker liegt vor Beginn der
              Marktphasen-Historie).
            </p>
          )}
        </div>
      )}

      {/* 13.09.2026 -- DIVERGENCE faerbt bewusst accent (gold) statt down/rot:
          die beiden Engines widersprechen sich, das sagt nichts ueber
          bullisch/baerisch aus, nur "geringere Aussagekraft". AGREEMENT hat
          dagegen eine echte, bekannte Richtung (marketStateDirectionLabel) --
          faerbt deshalb tatsaechlich nach up/down statt pauschal gruen. */}
      {engineDivergence === "DIVERGENCE" && marketStateDirectionLabel && (
        <div className="space-y-1">
          <span className="inline-block text-[11px] px-2 py-0.5 rounded-full border border-accent/40 text-accent font-semibold uppercase tracking-wide">
            {engineDivergenceStatusLabel(engineDivergence)}
          </span>
          <p className="text-xs text-accent">
            Gesamteinschätzung ist {marketStateDirectionLabel}, Marktphase zeigt{" "}
            {regimeLabel(matrix.regime)} — zwei unabhängige Engines widersprechen sich aktuell in der
            Richtung, geringere Aussagekraft der Gesamteinschätzung.
          </p>
        </div>
      )}
      {engineDivergence === "AGREEMENT" && marketStateDirectionLabel && (
        <p className={`text-xs ${marketState?.overall_state === "BULLISH" ? "text-up" : "text-down"}`}>
          Gesamteinschätzung und Marktphase stimmen richtungsmäßig überein (beide{" "}
          {marketStateDirectionLabel}).
        </p>
      )}

      {/* 20.09.2026 -- Nutzer-Beobachtung: die 1h-Engine kann nach einem
          abgeschlossenen Trendimpuls mehrere Stunden "nachlaufen" (ADX/
          Regressionssteigung bleiben erhoeht, obwohl der Kurs bereits
          seitwaerts laeuft) -- siehe get_short_term_range_check() RPC.
          Bewusst nur als Hinweis, nicht als eigenes Regime/eigene Kachel:
          reine Zusatzinformation zur bestehenden 1h-Aussage oben. */}
      {showStaleTrendHint && shortTermRangeCheck && (
        <p className="text-xs text-accent">
          Kurzfristig (15m, letzte {shortTermRangeCheck.lookback_bars / 4}h) bereits seitwärts (ADX{" "}
          {fmtNum(shortTermRangeCheck.adx_14, 0)}, enge Bollinger-Bandbreite) — 1h-Trend-Signal evtl.
          nachlaufend.
        </p>
      )}

      {tradingViewSignal && isSignalFresh(tradingViewSignal.received_at) && (
        <div className="flex items-center gap-1.5">
          <span
            title={`Externes Signal, empfangen ${tradingViewSignal.received_at} — rein informativ, fließt nicht in Score/Verlässlichkeit/Regime ein.`}
            className="inline-block text-[11px] px-2 py-0.5 rounded-full border border-accent/30 text-text-muted"
          >
            {formatSignalBadge(tradingViewSignal)}
          </span>
          <PanelInfo title="TradingView-Signale" content={TRADINGVIEW_SIGNAL_INFO} />
        </div>
      )}

      <p className="text-xs text-text-faint">
        Datenabdeckung:{" "}
        {matrix.data_coverage_pct !== null ? Math.round(matrix.data_coverage_pct) : "—"}% · 1H-Kerzen
        (Binance)
      </p>

      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="text-xs text-text-faint hover:text-text-muted underline decoration-dotted"
      >
        {expanded ? "Säulen ausblenden" : "Säulen anzeigen"}
      </button>

      {expanded && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-2 border-t border-border/60 text-xs">
          <div className="col-span-2 text-text-faint uppercase tracking-[0.1em] text-[10px] mt-1">
            Trend
          </div>
          <div>
            <span className="text-text-muted">ADX (14): </span>
            <span className="text-text">{fmtNum(matrix.adx_14, 1)}</span>
            <SignalBadge direction={trendDirection} />
            <PanelInfo title="ADX (14)" content={REGIME_MATRIX_METRIC_INFO.adx} className="ml-1" />
          </div>
          <div>
            <span className="text-text-muted">+DI / −DI: </span>
            <span className="text-text">
              {fmtNum(matrix.plus_di, 1)} / {fmtNum(matrix.minus_di, 1)}
            </span>
            <SignalBadge direction={trendDirection} />
            <PanelInfo title="+DI / −DI" content={REGIME_MATRIX_METRIC_INFO.di} className="ml-1" />
          </div>
          <div>
            <span className="text-text-muted">Regressionssteigung: </span>
            <span className="text-text">{fmtNum(matrix.linreg_slope, 2)}</span>
            <SignalBadge direction={trendDirection} />
            <PanelInfo title="Regressionssteigung" content={REGIME_MATRIX_METRIC_INFO.slope} className="ml-1" />
          </div>
          <div>
            <span className="text-text-muted">R²: </span>
            <span className="text-text">{fmtNum(matrix.linreg_r2, 2)}</span>
            <PanelInfo title="R²" content={REGIME_MATRIX_METRIC_INFO.r2} className="ml-1" />
          </div>

          <div className="col-span-2 text-text-faint uppercase tracking-[0.1em] text-[10px] mt-1">
            Volatilität
          </div>
          <div>
            <span className="text-text-muted">Garman-Klass Vol: </span>
            <span className="text-text">{fmtNum(matrix.garman_klass_vol, 4)}</span>
            <PanelInfo title="Garman-Klass Vol" content={REGIME_MATRIX_METRIC_INFO.garmanKlassVol} className="ml-1" />
          </div>
          <div>
            <span className="text-text-muted">Bollinger-Breite: </span>
            <span className="text-text">{fmtNum(matrix.bb_width, 3)}</span>
            <PanelInfo title="Bollinger-Breite" content={REGIME_MATRIX_METRIC_INFO.bbWidth} className="ml-1" />
          </div>
          <div>
            <span className="text-text-muted">Bollinger %b: </span>
            <span className="text-text">{fmtNum(matrix.bb_percent_b, 2)}</span>
            <SignalBadge direction={bbPercentBDir} />
            <PanelInfo title="Bollinger %b" content={REGIME_MATRIX_METRIC_INFO.bbPercentB} className="ml-1" />
          </div>
          <div>
            <span className="text-text-muted">ATR-Ratio: </span>
            <span className="text-text">{fmtNum(matrix.atr_ratio, 2)}</span>
            <PanelInfo title="ATR-Ratio" content={REGIME_MATRIX_METRIC_INFO.atrRatio} className="ml-1" />
          </div>

          <div className="col-span-2 text-text-faint uppercase tracking-[0.1em] text-[10px] mt-1">
            Momentum/Mean-Reversion
          </div>
          <div>
            <span className="text-text-muted">RSI (14): </span>
            <span className="text-text">{fmtNum(matrix.rsi_14, 1)}</span>
            <SignalBadge direction={rsiDir} />
            <PanelInfo title="RSI (14)" content={REGIME_MATRIX_METRIC_INFO.rsi} className="ml-1" />
          </div>
          <div>
            <span className="text-text-muted">Dist.-Z SMA20: </span>
            <span className="text-text">{fmtNum(matrix.dist_zscore_sma20, 2)}</span>
            <SignalBadge direction={distZ20Dir} />
            <PanelInfo title="Dist.-Z SMA20" content={REGIME_MATRIX_METRIC_INFO.distZ20} className="ml-1" />
          </div>
          <div>
            <span className="text-text-muted">Dist.-Z SMA50: </span>
            <span className="text-text">{fmtNum(matrix.dist_zscore_sma50, 2)}</span>
            <SignalBadge direction={distZ50Dir} />
            <PanelInfo title="Dist.-Z SMA50" content={REGIME_MATRIX_METRIC_INFO.distZ50} className="ml-1" />
          </div>
          <div>
            <span className="text-text-muted">Dist.-Z SMA200: </span>
            <span className="text-text">{fmtNum(matrix.dist_zscore_sma200, 2)}</span>
            <SignalBadge direction={distZ200Dir} />
            <PanelInfo title="Dist.-Z SMA200" content={REGIME_MATRIX_METRIC_INFO.distZ200} className="ml-1" />
          </div>

          <div className="col-span-2 text-text-faint uppercase tracking-[0.1em] text-[10px] mt-1">
            Mikrostruktur &amp; Derivate
          </div>
          <div>
            <span className="text-text-muted">Funding-Z-Score: </span>
            <span className="text-text">{fmtNum(matrix.funding_zscore, 2)}</span>
            <SignalBadge direction={fundingZDir} />
            <PanelInfo title="Funding-Z-Score" content={REGIME_MATRIX_METRIC_INFO.fundingZ} className="ml-1" />
          </div>
          <div>
            <span className="text-text-muted">CVD-Z-Score: </span>
            <span className="text-text">{fmtNum(matrix.cvd_zscore, 2)}</span>
            <SignalBadge direction={cvdZDir} />
            <PanelInfo title="CVD-Z-Score" content={REGIME_MATRIX_METRIC_INFO.cvdZ} className="ml-1" />
          </div>
          <div>
            <span className="text-text-muted">Preis-Δ (6h): </span>
            <span className="text-text">{fmtPct(matrix.price_change_pct)}</span>
            <SignalBadge direction={priceChangeDir} />
            <PanelInfo title="Preis-Δ (6h)" content={REGIME_MATRIX_METRIC_INFO.priceChange} className="ml-1" />
          </div>
          <div>
            <span className="text-text-muted">OI-Δ (6h): </span>
            <span className="text-text">{fmtPct(matrix.oi_change_pct)}</span>
            <PanelInfo title="OI-Δ (6h)" content={REGIME_MATRIX_METRIC_INFO.oiChange} className="ml-1" />
          </div>
          <div className="col-span-2">
            <span className="text-text-muted">OI/Preis-Quadrant: </span>
            <span className="text-text">
              {matrix.oi_price_quadrant
                ? QUADRANT_LABELS[matrix.oi_price_quadrant] ?? matrix.oi_price_quadrant
                : "—"}
            </span>
            <SignalBadge direction={quadrantDir} />
            <PanelInfo title="OI/Preis-Quadrant" content={REGIME_MATRIX_METRIC_INFO.oiPriceQuadrant} className="ml-1" />
          </div>

          <div className="col-span-2 text-text-faint uppercase tracking-[0.1em] text-[10px] mt-1">
            Makro/Sentiment
          </div>
          <div>
            <span className="text-text-muted">Liq.-Cluster-Density: </span>
            <span className="text-text">{fmtNum(matrix.liq_cluster_density, 2)}</span>
            <PanelInfo title="Liq.-Cluster-Density" content={REGIME_MATRIX_METRIC_INFO.liqClusterDensity} className="ml-1" />
          </div>
          <div>
            <span className="text-text-muted">Net-Taker-Flow: </span>
            <span className="text-text">{fmtNum(matrix.net_taker_flow_ratio, 3)}</span>
            <SignalBadge direction={netTakerFlowDir} />
            <PanelInfo title="Net-Taker-Flow" content={REGIME_MATRIX_METRIC_INFO.netTakerFlow} className="ml-1" />
          </div>
        </div>
      )}

      <p className="text-xs text-text-faint pt-1">
        5-Säulen-Regime-Engine (research-python/src/regime.py-Gegenstück) — regelbasiert, kein
        Handelssignal.
      </p>
    </section>
  );
}
