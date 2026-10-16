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
// die 60s-Polls von MarketContextCard, SpotPressurePanel und
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
  | "TREND_FORMING_BULLISH"
  | "TREND_FORMING_BEARISH"
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

// MTF-Ampel (lib/mtfSignal.ts) -- minimaler market_features-Ausschnitt, nur
// die Spalten, die die Ampel braucht.
export interface MarketFeaturesMtfRow {
  interval: string;
  candle_open_time: string;
  structure_trend: "bullish" | "bearish" | "ranging" | null;
  adx_14: number | null;
}

// Kurzfristiger Seitwaerts-Check (RPC get_short_term_range_check()) -- die
// 1h-Regime-Engine kann nach einem abgeschlossenen Trendimpuls mehrere
// Stunden "nachlaufen" (ADX/Regressionssteigung bleiben erhoeht, obwohl der
// Kurs seitwaerts laeuft). Dieser Check liest NUR die letzten `lookback_bars`
// 15m-Kerzen + den aktuellen 15m-ADX, unabhaengig von der 1h-Engine.
export interface ShortTermRangeCheck {
  as_of: string | null;
  interval: string;
  lookback_bars: number;
  adx_14: number | null;
  bb_width: number | null;
  is_ranging: boolean;
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

// System-Briefing: fusioniert Tobys eigenes Regelwerk (knowledge_base) +
// Nexus' berechnete Faktoren (14-Faktoren-Engine, GUSS/VWAP-Vector/CVD,
// Liquidations-Cluster, Marktkontext, ETF-Flows, Positionierung, News,
// Bewegungsvorrat) zu EINER Synthese in klar getrennten Abschnitten (siehe
// lib/systemBriefingContext.ts, lib/ai/promptProfiles.ts "system-briefing").
// Trigger enthaelt explizit ein Kursziel.
export interface SystemBriefingFazit {
  bias: "bullish" | "bearish" | "neutral";
  confidence: number;
  kernaussage: string;
}

// Trigger & Szenario liefert IMMER beide Richtungen -- kursziel MUSS einem
// echten keyLevels-Preis entsprechen oder null sein (siehe promptProfiles.ts
// "system-briefing").
export interface SystemBriefingScenario {
  bedingungen: string[];
  kursziel: number | null;
  // Szenario als 1-2 ganze Saetze im Stil eines Marktberichts ("Ueberwindet
  // BTC ... nachhaltig, rueckt ... in den Fokus."). Fehlt in aelteren
  // Snapshots.
  text?: string;
}

export interface SystemBriefingTrigger {
  bullish: SystemBriefingScenario;
  bearish: SystemBriefingScenario;
  invalidierung: string;
}

export interface SystemBriefingResult {
  fazit: SystemBriefingFazit;
  regelwerkCheck: string;
  // Chart-Formationen/Key Levels/Level-Struktur.
  chartStruktur: string;
  // null, wenn weder Marktkontext/ETF/Positionierung/News NOCH Chart-
  // Struktur dem Regelwerk-Check widersprechen -- bewusst weggelassen statt
  // erzwungen erwaehnt (Hauptursache der frueheren Laenge). Vormals
  // "kontextCheck", umbenannt, da jetzt auch den Chart-Struktur-Abgleich
  // (vormals "confluence" in der Chart-Narrativ-Kachel) mit abdeckt.
  konfluenzCheck: string | null;
  trigger: SystemBriefingTrigger;
  // Vergleich zum vorherigen erfolgreichen Briefing (1-2 Saetze), null beim
  // ersten Lauf. Fehlt in Snapshots von vor der Zusammenlegung mit dem
  // Master-Report.
  aenderungSeitLetztem?: string | null;
  // Marktbericht-Abschnitte (Aufbau angelehnt an einen klassischen
  // BTC-Marktupdate-Newsletter). Jeder Text beginnt mit einem Kernsatz, den
  // die Anzeige fett setzt. Fehlen in Snapshots von vor dem Umbau.
  schlagzeile?: string;
  marktupdate?: string;
  momentum?: string;
  liquidationen?: string;
  etfFlows?: string;
  wirtschaftskalender?: string;
}

// Zeitplan/Benachrichtigungen des System-Briefings (system_briefing_config,
// eine Zeile). schedule_times sind Uhrzeiten in Schweizer Zeit
// (Europe/Zurich, "HH:MM:SS"); der report-scheduler rechnet die
// Sommer-/Winterzeit selbst um.
export interface SystemBriefingConfig {
  id: number;
  schedule_times: string[] | null;
  email_enabled: boolean;
  push_enabled: boolean;
  updated_at: string;
}

export interface SystemBriefingSnapshot {
  id: number;
  generated_at: string;
  provider: string | null;
  model: string | null;
  result: SystemBriefingResult | null;
  status: "ok" | "error";
  error: string | null;
}

// Lernplattform-Kachel (Leitner-Karteikasten), Nutzer-Wunsch "wie im
// Trading Journal" -- siehe lib/leitner.ts fuer die Uebergangsregeln.
export interface QuizCard {
  id: number;
  question: string;
  answer: string;
  explanation: string | null;
  category: string | null;
  active: boolean;
  created_at: string;
  // Optionaler Lookup-Schluessel fuer eine feste, im Code hinterlegte SVG-
  // Illustration (siehe components/CandlestickPatternIllustration.tsx) --
  // kein Bild-Upload/Speicher, nur fuer Kerzenmuster-Karten gesetzt.
  pattern_key: string | null;
}

// Referenz-Wissen fuer die Wissens-Kacheln (Welz/Salomon/Mein System),
// siehe Migration create_knowledge_base_table.
export interface KnowledgeBaseEntry {
  id: number;
  module: "welz" | "salomon" | "mein_system";
  section: string;
  title: string;
  content: string;
  source: string | null;
  sort_order: number;
}

// Snapshot-Protokoll der Wissens-Checklisten, siehe Migration
// create_checklist_runs_table.
export interface ChecklistRun {
  id: number;
  module: "welz" | "salomon" | "mein_system" | "orderflow";
  checked_items: string[];
  checked_count: number;
  total_count: number;
  created_at: string;
}

export interface QuizProgressRow {
  card_id: number;
  box: number;
  due_at: string;
  last_seen_at: string | null;
  correct_streak: number;
  total_correct: number;
  total_hard: number;
  total_wrong: number;
  history: { t: number; grade: string }[];
}

// Neuester Orderbuch-Schnappschuss je Boerse (Tabelle orderbook_snapshots,
// Edge Function collect-orderbook, alle 5 Min) -- *_wall_* ist das groesste
// Einzel-Level innerhalb der erfassten Tiefe, sofern deutlich ueber dem
// Median der erfassten Level, sonst NULL. Siehe OrderbookWallCard.tsx.
export interface OrderbookWallSnapshot {
  exchange: string;
  timestamp_utc: string;
  mid_price: number | null;
  depth_imbalance: number | null;
  bid_wall_price: number | null;
  bid_wall_usd: number | null;
  ask_wall_price: number | null;
  ask_wall_usd: number | null;
  // Kumulierte Bid-/Ask-Tiefe (USD) innerhalb eines ±0.5%-Bandes um den
  // Mid-Preis (siehe collect-orderbook, DEPTH_RANGE_PCT) -- die Summe ALLER
  // Level je Seite, Basis von depth_imbalance.
  bid_depth_usd: number | null;
  ask_depth_usd: number | null;
  status: string;
}

// Periodischer KI-Rueckblick -- liest ausschliesslich fertig berechnete Zahlen
// (signal_stats_results), kein eigener Bias, kein Handelssignal. Siehe
// lib/signalReviewContext.ts + lib/ai/promptProfiles.ts ("signal-review").
export interface SignalReviewResult {
  summary: string;
  robust_findings: string[];
  decaying_or_fragile: string[];
  insufficient_data_note: string;
}

export interface SignalReviewSnapshot {
  id: number;
  generated_at: string;
  provider: string | null;
  model: string | null;
  result: SignalReviewResult | null;
  status: "ok" | "error";
  error: string | null;
}

// Eskalation ("gezielte Eskalation"): eine Zweit-/Drittmeinung nur, wenn
// System-Briefing-Konfluenz-Check, Divergenz-Radar oder Report-Master bereits
// einen Widerspruch melden. Siehe lib/escalationContext.ts (Trigger),
// lib/escalationConsensus.ts (Konsens-Logik), lib/ai/promptProfiles.ts
// ("escalation-analysis").
export interface EscalationTriggerRecord {
  // "report-master" nur noch in aelteren gespeicherten Eskalationen.
  source: "system-briefing" | "divergence-radar" | "report-master";
  label: string;
  detail: string[];
}

export interface EscalationRead {
  provider: string;
  model: string;
  bias: "bullish" | "bearish" | "neutral";
  confidence: number;
  summary: string;
}

export interface EscalationSnapshot {
  id: number;
  generated_at: string;
  trigger_reasons: EscalationTriggerRecord[];
  reads: EscalationRead[];
  failed_providers: string[];
  consensus: "AGREEMENT" | "DIVERGENCE" | "INCONCLUSIVE" | null;
  status: "ok" | "error";
  error: string | null;
}

// Trade-Debate (TradingAgents-Architektur [arXiv:2412.20138]): zwei
// gegensaetzlich geprompte Analysten (Bull/Bear) + ein Referee, Schemata in
// lib/ai/promptProfiles.ts "trade-bull-analyst"/"trade-bear-analyst"/
// "trade-referee".
export interface TradeDebateAnalystResult {
  bias: "long" | "short";
  entry_price: number;
  invalidation_price: number;
  target_price: number;
  risk_reward: number;
  confidence: number;
  reasoning: string;
}

export interface TradeDebateAnalystRead {
  provider: string;
  model: string;
  result: TradeDebateAnalystResult;
}

export interface TradeDebateRefereeResult {
  verdict: "long" | "short" | "wait";
  divergence_detected: boolean;
  synthesis: string;
  invalidation_level: number | null;
}

export interface TradeDebateSnapshot {
  id: number;
  generated_at: string;
  bull_read: TradeDebateAnalystRead | null;
  bear_read: TradeDebateAnalystRead | null;
  referee_provider: string | null;
  referee_model: string | null;
  referee_result: TradeDebateRefereeResult | null;
  verdict: "long" | "short" | "wait" | null;
  status: "ok" | "error";
  error: string | null;
}

// Krypto-YouTube-Monitor -- findet neue BTC/Krypto-relevante YouTube-Videos
// (YouTube Data API v3, kostenloses Tageskontingent) und laesst sie per
// Gemini direkt per Video-URL analysieren (Google-Free-Tier). Siehe
// lib/youtubeMonitorContext.ts (Suche) + lib/ai/youtubeVideoAnalysis.ts.
export interface YoutubeVideoAnalysisResult {
  bias: "bullish" | "bearish" | "neutral";
  confidence: number;
  relevance: "high" | "medium" | "low";
  summary: string;
}

export interface YoutubeVideoAnalysis {
  id: number;
  video_id: string;
  channel_title: string | null;
  title: string;
  published_at: string;
  url: string;
  generated_at: string;
  model: string | null;
  result: YoutubeVideoAnalysisResult | null;
  status: "ok" | "error";
  error: string | null;
}

