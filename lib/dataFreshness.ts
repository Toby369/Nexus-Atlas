// Datenstand je Quelle: Ampel in der Kopfzeile, "Stand vor X Min" im
// Kachelkopf und die Liste im Konto (docs/research/AUTARK-BAUWEISE-FUER-
// NEXUS_2026-10-29.md, Punkt A/B; Vorbild AutarkTrade: "ein leerer Ticker
// darf nie wie ein ruhiger Markt aussehen").
//
// Die Zeitstempel liefert die RPC get_data_freshness() (nur lesen, keine
// neue Tabelle -- DB-Budget 500 MB). Was "normal" ist, steht nur HIER: je
// Quelle das Alter, das im gesunden Betrieb hoechstens vorkommt. Das ist
// bewusst nicht der Cron-Takt, sondern was der Zeitstempel im Normalfall
// zeigt: Kerzen tragen ihre Eroeffnungszeit (eine 1h-Kerze ist beim
// Schreiben schon eine Stunde alt), die Terminbasis die volle Stunde usw.
// Werte am 29.10.2026 an den echten Daten abgelesen und gegen die groesste
// Luecke der Woche davor geprueft (sonst wird die Ampel grundlos gelb).

export type FreshnessStatus = "frisch" | "verspaetet" | "ausgefallen" | "unbekannt";

export interface DataSourceMeta {
  key: string;
  label: string;
  /** Hoechstes Alter im gesunden Betrieb, in Minuten. */
  normalMaxMin: number;
  /**
   * Quelle, die (noch) fehlen darf, ohne Alarm: ohne Zeitstempel "unbekannt"
   * statt "ausgefallen", zaehlt nicht fuer die Ampel. Heute nur der
   * AutarkTrade-Sync, der erst mit dem VPS laeuft.
   */
  optional?: boolean;
}

const MIN = 1;
const STD = 60;

const FUTURES_EXCHANGES = ["binance", "bybit", "okx", "bitget", "bitunix", "pionex"] as const;
const POSITIONING_EXCHANGES = ["binance", "bybit", "okx", "bitget"] as const;
const ORDERBOOK_EXCHANGES = ["binance", "bybit", "okx"] as const;

const EXCHANGE_NAMES: Record<string, string> = {
  binance: "Binance",
  bybit: "Bybit",
  okx: "OKX",
  bitget: "Bitget",
  bitunix: "Bitunix",
  pionex: "Pionex",
};

// 5-Min-Sammler: ein ausgefallener Lauf ist noch "frisch" (groesste Luecke
// der Woche: 10 Min, plus Reserve fuer die Laufzeit des Sammlers).
const FUENF_MIN_SAMMLER = 12 * MIN;

export const DATA_SOURCES: DataSourceMeta[] = [
  ...FUTURES_EXCHANGES.map((ex) => ({
    key: `futures_${ex}`,
    label: `Futures ${EXCHANGE_NAMES[ex]}`,
    normalMaxMin: FUENF_MIN_SAMMLER,
  })),
  ...POSITIONING_EXCHANGES.map((ex) => ({
    key: `positioning_${ex}`,
    label: `Positionierung ${EXCHANGE_NAMES[ex]}`,
    normalMaxMin: FUENF_MIN_SAMMLER,
  })),
  ...ORDERBOOK_EXCHANGES.map((ex) => ({
    key: `orderbook_${ex}`,
    label: `Orderbuch ${EXCHANGE_NAMES[ex]}`,
    normalMaxMin: FUENF_MIN_SAMMLER,
  })),
  // Spot-Kerze traegt ihre Startzeit: bis 10 Min alt, plus ein Lauf Reserve.
  { key: "spot_binance", label: "Spot Binance (Taker-Flow)", normalMaxMin: 15 * MIN },
  { key: "spot_volume", label: "Spot-Volumenprofil", normalMaxMin: FUENF_MIN_SAMMLER },
  // Letzte geschlossene Kerze, Eroeffnungszeit: 15m -> bis ~30 Min alt.
  { key: "candles_15m", label: "Kerzen 15m", normalMaxMin: 35 * MIN },
  { key: "candles_1h", label: "Kerzen 1h", normalMaxMin: 2 * STD + 15 * MIN },
  { key: "candles_1d", label: "Kerzen 1D", normalMaxMin: 49 * STD },
  { key: "market_state", label: "Marktzustand (Engine)", normalMaxMin: 20 * MIN },
  { key: "regime_matrix", label: "Marktphase (Matrix)", normalMaxMin: 2 * STD + 15 * MIN },
  { key: "divergence_radar", label: "Divergenz-Radar", normalMaxMin: 35 * MIN },
  // Zeitstempel = volle Stunde, Lauf um :11.
  { key: "term_basis", label: "CME-Terminbasis", normalMaxMin: 90 * MIN },
  { key: "sentiment", label: "Sentiment (Fear & Greed)", normalMaxMin: 75 * MIN },
  { key: "options", label: "Optionen (Deribit)", normalMaxMin: 40 * MIN },
  { key: "macro", label: "Makro (Indizes, DXY)", normalMaxMin: 40 * MIN },
  // Neue Zeilen nur, wenn es neue Meldungen gibt -- nachts bis fast 9 Std.
  { key: "news", label: "News", normalMaxMin: 9 * STD },
  { key: "onchain", label: "On-Chain", normalMaxMin: 25 * STD },
  // Neue Zeile nur bei neuem Handelstag (T+1): ueber das Wochenende bis 3,5
  // Tage, an langen Wochenenden mehr.
  { key: "etf", label: "ETF-Flows", normalMaxMin: 4 * 24 * STD },
  { key: "calendar", label: "Wirtschaftskalender", normalMaxMin: 25 * STD },
  // Vier Briefings am Tag, groesste Luecke 23:15 -> 06:30.
  { key: "briefing", label: "System-Briefing (KI)", normalMaxMin: 8 * STD },
  { key: "autark_sync", label: "AutarkTrade-Zonen-Sync", normalMaxMin: FUENF_MIN_SAMMLER, optional: true },
];

export const DATA_SOURCE_KEYS = DATA_SOURCES.map((s) => s.key);

const SOURCE_BY_KEY = new Map(DATA_SOURCES.map((s) => [s.key, s]));

export function dataSource(key: string): DataSourceMeta {
  const meta = SOURCE_BY_KEY.get(key);
  if (!meta) throw new Error(`Unbekannte Datenquelle "${key}" (lib/dataFreshness.ts)`);
  return meta;
}

// Gruppen fuer das Kachel-Register (lib/dashboardTiles.ts).
export const FUTURES_KEYS = FUTURES_EXCHANGES.map((ex) => `futures_${ex}`);
export const POSITIONING_KEYS = POSITIONING_EXCHANGES.map((ex) => `positioning_${ex}`);
export const ORDERBOOK_KEYS = ORDERBOOK_EXCHANGES.map((ex) => `orderbook_${ex}`);

/** Ab diesem Vielfachen des Normalalters gilt eine Quelle als ausgefallen. */
export const AUSGEFALLEN_FAKTOR = 3;

export interface SourceFreshness {
  meta: DataSourceMeta;
  status: FreshnessStatus;
  /** null, wenn die RPC keinen Zeitstempel geliefert hat. */
  ageMs: number | null;
}

/** Antwort von get_data_freshness(): Quelle -> ISO-Zeitstempel. */
export type FreshnessData = Record<string, string | null>;

export function evaluateSource(meta: DataSourceMeta, iso: string | null | undefined, nowMs: number): SourceFreshness {
  const ts = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(ts)) {
    return { meta, status: meta.optional ? "unbekannt" : "ausgefallen", ageMs: null };
  }
  // Uhren von Server und Browser laufen nie ganz gleich -- ein Zeitstempel
  // knapp in der "Zukunft" ist frisch, nicht negativ alt.
  const ageMs = Math.max(0, nowMs - ts);
  const normalMs = meta.normalMaxMin * 60_000;
  const status: FreshnessStatus =
    ageMs <= normalMs ? "frisch" : ageMs <= normalMs * AUSGEFALLEN_FAKTOR ? "verspaetet" : "ausgefallen";
  return { meta, status, ageMs };
}

export function evaluateSources(keys: readonly string[], data: FreshnessData, nowMs: number): SourceFreshness[] {
  return keys.map((key) => evaluateSource(dataSource(key), data[key], nowMs));
}

const RANG: Record<FreshnessStatus, number> = { frisch: 0, unbekannt: 0, verspaetet: 1, ausgefallen: 2 };

/** Schlechtester Zustand; "unbekannt" (optionale Quelle) zieht nie nach unten. */
export function worstStatus(items: readonly SourceFreshness[]): FreshnessStatus {
  let worst: FreshnessStatus = "frisch";
  for (const item of items) {
    if (RANG[item.status] > RANG[worst]) worst = item.status;
  }
  return worst;
}

/** Die Quellen, die gerade nicht frisch sind (fuer Ampel-Text und Tooltip). */
export function problems(items: readonly SourceFreshness[]): SourceFreshness[] {
  return items.filter((i) => i.status === "verspaetet" || i.status === "ausgefallen");
}

export function formatAge(ageMs: number | null): string {
  if (ageMs == null) return "keine Daten";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `vor ${hours} Std`;
  return `vor ${Math.floor(hours / 24)} Tg`;
}

export const STATUS_LABEL: Record<FreshnessStatus, string> = {
  frisch: "aktuell",
  verspaetet: "verspätet",
  ausgefallen: "ausgefallen",
  unbekannt: "noch nie gelaufen",
};

/** Ein Satz fuer Tooltip/Liste, z.B. "Futures Pionex: ausgefallen (vor 2 Std)". */
export function describe(item: SourceFreshness): string {
  return `${item.meta.label}: ${STATUS_LABEL[item.status]} (${formatAge(item.ageMs)})`;
}

/**
 * Kurztext fuer den Kachelkopf. Alles frisch: Alter der aeltesten Quelle
 * ("vor 4 Min" -- die Kachel ist nur so aktuell wie ihr langsamster Teil).
 * Sonst die betroffene Quelle beim Namen, bei mehreren nur die Anzahl.
 */
export function summarizeTile(items: readonly SourceFreshness[]): { status: FreshnessStatus; text: string } {
  const status = worstStatus(items);
  const offen = problems(items);
  if (offen.length === 0) {
    const ages = items.map((i) => i.ageMs).filter((a): a is number => a != null);
    return { status, text: ages.length ? formatAge(Math.max(...ages)) : "" };
  }
  if (offen.length === 1) {
    const [p] = offen;
    return { status, text: `${p.meta.label} ${p.ageMs == null ? "fehlt" : formatAge(p.ageMs)}` };
  }
  return { status, text: `${offen.length} Quellen ${STATUS_LABEL[status]}` };
}
