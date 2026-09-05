import type { ExchangeFirstSeen } from "@/lib/exchangeConsistency";

export interface MarketSnapshot {
  id: number;
  timestamp_utc: string;
  symbol: string;
  exchange: string;
  last_price: number | null;
  mark_price: number | null;
  index_price: number | null;
  open_interest: number | null;
  open_interest_usd: number | null;
  funding_rate: number | null;
  next_funding_time_utc: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

// Rueckgabezeile der get_market_series-RPC (serverseitig heruntergesamplete
// Preis-/OI-Zeitreihe je Boerse, siehe lib/timeframes.ts).
export interface MarketSeriesPoint {
  timestamp_utc: string;
  last_price: number | null;
  open_interest: number | null;
}

export interface PositioningSnapshot {
  id: number;
  timestamp_utc: string;
  exchange: string;
  symbol: string;
  global_long_account_ratio: number | null;
  global_short_account_ratio: number | null;
  global_account_long_short_ratio: number | null;
  top_trader_long_account_ratio: number | null;
  top_trader_short_account_ratio: number | null;
  top_trader_account_long_short_ratio: number | null;
  top_trader_long_position_ratio: number | null;
  top_trader_short_position_ratio: number | null;
  top_trader_position_long_short_ratio: number | null;
  taker_buy_vol: number | null;
  taker_sell_vol: number | null;
  taker_buy_sell_ratio: number | null;
  status: string;
  error: string | null;
  created_at: string;
}

export interface PositioningSignal {
  id: number;
  timestamp_utc: string;
  signal_type: string;
  symbol: string;
  score: number | null;
  confidence: number | null;
  timeframe: string | null;
  explanation: string;
  supporting_metrics: Record<string, unknown> | null;
  created_at: string;
}

// Ein Faktor der Market-State-Engine (compute-market-state): -1/0/+1 =
// baerisch/neutral/bullisch, null = keine (frischen) Daten verfuegbar.
export interface MarketStateFactor {
  value: -1 | 0 | 1 | null;
  basis: Record<string, unknown>;
}

export interface MarketStatePattern {
  name: string;
  note: string;
}

export interface MarketStateMtfAlignment {
  alignment_pct: number;
  dominant_direction: "bullish" | "bearish" | "ranging";
  timeframes: Record<string, -1 | 0 | 1>;
  timeframe_count: number;
}

export interface MarketState {
  id: number;
  timestamp_utc: string;
  overall_state: "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "INSUFFICIENT_DATA";
  score: number | null;
  confidence: number;
  data_coverage_pct: number;
  factors: Record<string, MarketStateFactor>;
  patterns: MarketStatePattern[];
  mtf_alignment: MarketStateMtfAlignment | null;
  risk_level: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN" | null;
  risk_factors: string[] | null;
  created_at: string;
}

export interface LiquidationEvent {
  id: number;
  event_time_utc: string;
  exchange: string;
  symbol: string;
  side: "long" | "short" | "unknown";
  price: number | null;
  quantity: number | null;
  notional_usd: number | null;
  order_type: string | null;
  source_event_id: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

// Rueckgabeform der get_liquidation_intelligence-RPC (Phase 2: Velocity,
// Preis-Cluster, Vergleich vs. aggregiertem Open Interest).
export interface LiquidationIntelligence {
  velocity: {
    bucket_start: string;
    event_count: number;
    notional_usd: number;
    long_notional: number | null;
    short_notional: number | null;
  }[];
  price_clusters: {
    price_bucket: number;
    notional_usd: number;
    event_count: number;
  }[];
  total_notional_usd: number;
  total_oi_usd: number | null;
}

// Rueckgabeform der get_anchored_summary-RPC (Phase 1 "Anchored
// Analytics" -- Event-Driven-Kontext ab einem frei waehlbaren Ankerpunkt,
// siehe lib/anchor.ts). granularity_used dokumentiert, welche Zeitreihen-
// Aufloesung fuer `series` gewaehlt wurde (abhaengig vom Anker-Alter).
export interface AnchoredSummaryPoint {
  timestamp_utc: string;
  last_price: number | null;
  open_interest: number | null;
}

export interface AnchoredSummary {
  anchor_timestamp_utc: string;
  granularity_used: "5m" | "1h" | "4h" | "1d";
  price_at_anchor: number | null;
  price_current: number | null;
  price_change_pct: number | null;
  oi_at_anchor: number | null;
  oi_current: number | null;
  oi_change_pct: number | null;
  long_liquidation_usd: number;
  short_liquidation_usd: number;
  liquidation_event_count: number;
  // Naechstgelegene market_state_matrix-Zeile vor/bei anchor_timestamp_utc
  // (siehe RegimeMatrixCard.tsx "Seit Anker") -- null, wenn der Anker vor
  // dem Beginn der Regime-Matrix-Historie liegt (kein erfundener Wert).
  // confidence_at_anchor ist die market_states.confidence desselben
  // Zeitpunkts, noetig fuer dieselbe Confidence-Sperre wie beim aktuellen
  // Regime (shouldSuppressRegimeDirectionalLabel).
  regime_at_anchor: MarketRegime | null;
  regime_at_anchor_timestamp_utc: string | null;
  confidence_at_anchor: number | null;
  series: AnchoredSummaryPoint[];
}

// Rueckgabezeile aus tradingview_signals (Phase 2 TradingView-Integration,
// Migration add_tradingview_signals_table). Rein informatives Kontext-
// Badge im Dashboard (siehe RegimeMatrixCard.tsx) -- fliesst NICHT in
// compute-market-state oder die Regime Matrix ein (siehe die
// webhook-tradingview Edge Function).
export interface TradingViewSignal {
  id: string;
  received_at: string;
  ticker: string;
  signal_type: string;
  timeframe: string | null;
  payload: Record<string, unknown>;
}

// Rueckgabezeile der get_spot_pressure_series-RPC (Binance-Spot-BTC-Kerzen,
// 5-Min-Takt, siehe SpotPressurePanel.tsx).
export interface SpotPressurePoint {
  timestamp_utc: string;
  last_price: number | null;
  taker_buy_vol: number | null;
  taker_sell_vol: number | null;
}

// Rueckgabezeile der get_spot_pressure_summary-RPC: exakte Summe ueber ein
// Zeitfenster (nicht heruntergesamplet, im Gegensatz zu SpotPressurePoint).
export interface SpotPressureSummary {
  candle_count: number;
  sum_taker_buy_vol: number | null;
  sum_taker_sell_vol: number | null;
  sum_taker_buy_quote_vol: number | null;
  sum_taker_sell_quote_vol: number | null;
  first_price: number | null;
  last_price: number | null;
  latest_timestamp_utc: string;
}

// Rueckgabezeile der get_oi_change_by_exchange-RPC: OI-Change% je Boerse
// fuer denselben Zeitraum wie die uebrige Seite -- Basis fuer Exchange-
// Divergence (welche Boerse treibt eine Bewegung) und die "UNAVAILABLE"-
// Kennzeichnung bei Boersen ohne oeffentliche OI-Route.
export interface OiChangeByExchange {
  exchange: string;
  oi_change_pct: number | null;
  current_oi: number | null;
  reference_oi: number | null;
  reference_timestamp_utc: string | null;
  current_timestamp_utc: string | null;
  has_full_history: boolean;
}

// Rueckgabe der get_dashboard_poll_bundle-RPC (Phase 2, Punkt 3): buendelt
// die 30s-Polls von MarketContextCard, SpotPressurePanel und
// PositioningPanel (vorher 10 unabhaengige Einzel-Requests) zu einem
// einzigen jsonb-Objekt -- siehe components/DashboardPollProvider.tsx.
export interface DashboardPollBundle {
  oi_series: MarketSeriesPoint[];
  oi_reference: {
    timestamp_utc: string;
    last_price: number | null;
    open_interest: number | null;
  } | null;
  spot_summary: SpotPressureSummary | null;
  spot_series: SpotPressurePoint[];
  exchange_first_seen: ExchangeFirstSeen[];
  positioning_binance: PositioningSnapshot | null;
  positioning_bybit: PositioningSnapshot | null;
  positioning_okx: PositioningSnapshot | null;
  positioning_bitget: PositioningSnapshot | null;
  positioning_signal: PositioningSignal | null;
}

// NEXUS AI Report Engine (Vorgabe Teil M-P). report_configs = bis zu 4
// vom Nutzer konfigurierte Report-Slots, report_runs = jede tatsaechliche
// Ausfuehrung samt der Datenbasis, die der KI vorlag (data_snapshot).
export type ReportType = "market_structure" | "positioning" | "news_macro" | "master";

export interface ReportConfig {
  id: number;
  slot: number;
  report_type: ReportType;
  provider: string;
  model: string | null;
  timeframe: string;
  schedule_time: string | null;
  active: boolean;
  email_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReportRun {
  id: number;
  report_config_id: number | null;
  report_type: ReportType;
  provider: string;
  model: string | null;
  timeframe: string;
  generated_at: string;
  status: "ok" | "error";
  result: Record<string, unknown> | null;
  data_snapshot: Record<string, unknown> | null;
  error: string | null;
  email_sent: boolean;
  // Regelbasierte Post-Validation (Phase 2, Punkt 1) -- getrennt von
  // "status": status sagt "hat der API-Call funktioniert", validation_status
  // sagt "stimmt der Text mit den mitgegebenen Rohdaten überein". null =
  // nicht validiert (z.B. status='error'-Läufe, oder Altdaten vor Phase 2).
  validation_status: "ok" | "flagged_contradiction" | null;
  validation_notes: string[] | null;
  created_at: string;
}

export interface EtfFlowDay {
  id: number;
  flow_date: string;
  total_flow_usd_m: number | null;
  source: string;
  created_at: string;
}

// Rueckgabeform der get_etf_flow_intelligence-RPC: Momentum (juengere vs.
// aeltere Haelfte des Fensters) sowie Preis-/OI-Veraenderung ueber denselben
// Zeitraum. Einzelne Felder sind null statt eines erfundenen Werts, wenn
// nicht genug Historie/Daten vorhanden ist (z. B. OI vor Beginn der
// Aggregations-Historie).
export interface EtfFlowIntelligence {
  window_days_used: number;
  recent_sum_usd_m: number | null;
  recent_days: number;
  prior_sum_usd_m: number | null;
  prior_days: number;
  momentum_usd_m: number | null;
  momentum_pct: number | null;
  earliest_date: string | null;
  latest_date: string | null;
  price_start: number | null;
  price_end: number | null;
  price_change_pct: number | null;
  oi_start: number | null;
  oi_end: number | null;
  oi_change_pct: number | null;
}

export interface NewsEvent {
  id: number;
  source_id: number | null;
  external_id: string | null;
  published_at: string;
  title: string;
  title_de: string | null;
  summary: string | null;
  url: string | null;
  category: string;
  market_direction: string;
  impact_score: number;
  confidence_score: number;
  relevance_score: number;
  btc_impact_score: number;
  horizon: string;
  is_market_moving: boolean;
  is_verified: boolean;
  raw_hash: string | null;
  created_at: string;
}

// Phase 3: Market State Matrix Engine. Fuehrt die 5 Feature-Engine-Saeulen
// (Trend/Volatilitaet/Momentum-Mean-Reversion/Mikrostruktur-Derivate/Makro-
// Sentiment) zu einem Regime-Label zusammen -- SQL-Gegenstueck (siehe
// Migration add_market_state_matrix_engine) zu
// research-python/src/regime.py. Eine Zeile pro (timestamp_utc, symbol,
// interval); regime ist eine der MarketRegime-Werte, nie NULL (ein
// unvollstaendiger Datensatz klassifiziert als UNRESOLVED_NEUTRAL statt
// NULL zu liefern).
export type MarketRegime =
  | "HIGH_VOLA_REVERSION"
  | "TREND_EXPANSION_BULLISH"
  | "TREND_EXPANSION_BEARISH"
  | "VOLA_SQUEEZE_RANGING"
  | "UNRESOLVED_NEUTRAL";

export type OiPriceQuadrant =
  | "long_buildup"
  | "short_buildup"
  | "short_covering"
  | "long_unwind"
  | "neutral";

export interface MarketStateMatrix {
  id: number;
  timestamp_utc: string;
  symbol: string;
  interval: string;
  // Säule 1: Trend
  adx_14: number | null;
  plus_di: number | null;
  minus_di: number | null;
  linreg_slope: number | null;
  linreg_r2: number | null;
  // Säule 2: Volatilität
  garman_klass_vol: number | null;
  bb_width: number | null;
  bb_percent_b: number | null;
  atr_ratio: number | null;
  // Säule 3: Momentum/Mean-Reversion
  rsi_14: number | null;
  dist_zscore_sma20: number | null;
  dist_zscore_sma50: number | null;
  dist_zscore_sma200: number | null;
  // Säule 4: Mikrostruktur & Derivate
  funding_zscore: number | null;
  price_change_pct: number | null;
  oi_change_pct: number | null;
  oi_price_quadrant: OiPriceQuadrant | null;
  cvd_zscore: number | null;
  // Säule 5: Makro/Sentiment
  liq_cluster_density: number | null;
  net_taker_flow_ratio: number | null;
  // Regime Matrix Engine Output
  regime: MarketRegime;
  data_coverage_pct: number | null;
  created_at: string;
}

// Naechster bekannter Termin je verfolgtem Wirtschaftsereignis (siehe
// Edge Function collect-economic-calendar + lib/economicCalendar.ts fuer
// die BTC-Einordnung je event_key). event_date ist ein reines Datum
// (YYYY-MM-DD), keine Uhrzeit -- FRED liefert selbst keine Uhrzeit.
export interface EconomicCalendarEvent {
  event_key: string;
  label: string;
  event_date: string;
  typical_time_et: string | null;
  source: string;
  updated_at: string;
}

// Ergebnis der Handelslage-KI-Kachel (Umsetzungsplan Phase 3, 05.09.2026,
// siehe lib/handelslageContext.ts + app/api/handelslage/generate/route.ts).
// "result" ist die vom Modell gelieferte, gegen das handelslage-Prompt-
// Profile validierte JSON-Antwort (einschaetzung/bedingungen/ungueltigWenn).
export interface HandelslageResult {
  einschaetzung: string;
  bedingungen: string[];
  ungueltigWenn: string;
}

export interface HandelslageSnapshot {
  id: number;
  generated_at: string;
  provider: string | null;
  model: string | null;
  bewegungsvorrat_pct: number | null;
  result: HandelslageResult | null;
  status: "ok" | "error";
  error: string | null;
}
