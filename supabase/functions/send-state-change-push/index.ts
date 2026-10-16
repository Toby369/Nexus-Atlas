import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// Push-Benachrichtigung bei Zustandswechsel (Nutzer-Wunsch: "ich moechte
// sowas [grosse Bewegungen] davor oder waehrend dessen als Signal
// bekommen", dann explizit "kann nexus auch push Nachricht senden?" ->
// "ja bauen").
//
// Quellcode liegt seit 15.10.2026 im Repo (supabase/functions/
// send-state-change-push/index.ts, Stand Version 16 + Erklaerungen).
//
// Trigger-Logik bewusst simpel gehalten (kein separates "letzter Push"-
// Tracking noetig): vergleicht die JUENGSTEN ZWEI market_states-Zeilen.
// Unterscheiden sich overall_state UND die neuere ist gerichtet (BULLISH/
// BEARISH), wird gepusht. Das ist von selbst idempotent -- sobald sich der
// Zustand nicht mehr aendert, sind die juengsten zwei Zeilen irgendwann
// identisch, kein wiederholter Push fuer denselben Wechsel. Per Cron 3 Min
// nach compute-market-state-every-15-min versetzt, damit die frische Zeile
// sicher schon geschrieben ist.
//
// Umsetzungsplan Phase 2 (05.09.2026): zwei zusaetzliche, unabhaengige
// Crossing-Checks nach demselben Muster -- jeder feuert nur beim
// UEBERSCHREITEN einer Schwelle (Vergleich der juengsten zwei Zeilen), nie
// "solange druber":
//   1) Einstiegsfilter-Uebergang: dieselbe 4h-Struktur-Regel wie lib/
//      entryFilter.ts (hier dupliziert, weil Edge Functions das Next.js-
//      Repo nicht importieren koennen).
//   2) Risiko-Faktoren: jeder Eintrag, der in der neuesten risk_factors-
//      Liste steht, aber NICHT in der vorherigen, loest eine eigene
//      Meldung aus. Warnende Muster werden seit 12.09.2026 separat auf
//      Pattern-NAME-Ebene behandelt.
//
// Body { test: true }: sendet sofort eine feste Test-Nachricht.
//
// Body { custom: { title, body, url?, explanation?, kind? } }: andere
// Scheduler (youtube-monitor-scheduler, System-Briefing ueber lib/push im
// Next.js-Repo) senden ihr eigenes Ereignis direkt. explanation/kind seit
// 15.10.2026 optional; ohne explanation wird eine Standard-Erklaerung je
// Absender gewaehlt (siehe customExplanation).
//
// 12.09.2026: Confidence-Schwelle beim Zustandswechsel (muss mit
// DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD in lib/marketStateSummary.ts
// uebereinstimmen); warnende Muster mit konkretem Namen statt Sammel-Flag.
// 02.10.2026 / 12.10.2026: Regime-Wechsel je Zeitrahmen 1h/4h/1D, Dedupe
// ueber regime_change_pushes_sent.
// 03.10.2026: Wirtschaftsdaten 60 und 15 Min vorher + Ergebnis, Dedupe ueber
// news_warning_pushes_sent (Stufe im mark_id kodiert).
//
// 15.10.2026 (Toby: "wenn ich auf die Nachricht tippe, moechte ich eine
// kurze Erklaerung sehen! bei jeder push Nachricht"): jede Nachricht wird
// mit Erklaerung und Messwerten in push_messages gespeichert. Die Push-URL
// zeigt auf /mitteilung/<id> (Next.js-Seite app/mitteilung/[id]/page.tsx).
// Schlaegt das Speichern fehl, geht die Push trotzdem raus (alte URL).

const VAPID_PUBLIC_KEY =
  "BJWQ6WGvi9OMy_YswlA_Y9c6_SaLl-Werw94zsEZXWyKIy5el8lXl44k0MXmtIAlVx5nxf_bSeLaTOn4Fkkn20A";
const VAPID_SUBJECT = "mailto:nexus-atlas@example.com";

// 16.10.2026 (Toby: Test-Push kam nicht an, obwohl FCM sie angenommen hat):
// web-push schickt sonst mit Urgency "normal" -- Android haelt solche
// Nachrichten im Energiesparmodus (Doze) zurueck, bis das Geraet aufwacht.
// "high" stellt sofort zu. TTL 6 h: aeltere Marktmeldungen sind ohnehin
// ueberholt, statt bis zu 4 Wochen (Standard) nachgeliefert zu werden.
const PUSH_OPTIONS = { urgency: "high" as const, TTL: 6 * 60 * 60 };

// Muss mit DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD in
// lib/marketStateSummary.ts uebereinstimmen.
const CONFIDENCE_THRESHOLD = 35;

const STATE_LABELS_DE: Record<string, string> = {
  BULLISH: "Bullisch",
  BEARISH: "Bärisch",
  NEUTRAL: "Neutral",
  MIXED: "Gemischt",
  INSUFFICIENT_DATA: "Unzureichende Daten",
};

// Faktoren aus compute-market-state, fuer die Erklaerung eines
// Zustandswechsels.
const FACTOR_LABELS_DE: Record<string, string> = {
  structure: "Marktstruktur (1h)",
  momentum: "Momentum (RSI/MACD)",
  cvd: "Orderflow (CVD)",
  oi_price: "Open Interest",
  positioning: "Positionierung",
  orderbook: "Orderbuch",
  options: "Optionen (Put/Call)",
  macro: "Makro",
  funding: "Funding (Gegenindikator)",
  sentiment: "Fear & Greed (Gegenindikator)",
  trend_strength: "Trendstärke (ADX)",
  trend_regime: "Trend (EMA50/EMA200)",
  vwap_position: "Preis vs. VWAP",
  basis: "Basis (Gegenindikator)",
};

// Die vier UEBRIGEN Risiko-Faktoren aus compute-market-state
// ("warning_pattern" wird separat ueber market_states.patterns behandelt).
const RISK_FACTOR_LABELS_DE: Record<string, string> = {
  low_mtf_alignment: "Zeitrahmen uneins -- niedriges MTF-Alignment",
  funding_crowding: "Funding-Extrem -- Crowding-Risiko",
  basis_crowding: "Basis/Perpetual-Praemie extrem -- Crowding-Risiko",
  elevated_volatility: "Erhöhte Volatilität (ATR ueber P90)",
};

const RISK_FACTOR_EXPLANATIONS_DE: Record<string, string> = {
  low_mtf_alignment:
    "Die Marktstruktur im 1h-, 4h- und Tageschart zeigt in verschiedene Richtungen (weniger als 60 % des Gewichts einig). In solchen Phasen drehen Bewegungen oft schnell, Ausbrüche scheitern häufiger. Kein Richtungssignal, sondern ein Hinweis auf erhöhte Umkehr- und Seitwärtsgefahr.",
  funding_crowding:
    "Funding ist die Gebühr, die Long- und Short-Trader bei Perpetual-Futures alle 8 Stunden untereinander zahlen. Ist sie extrem hoch (über 0,05 % je 8 h), sind sehr viele mit Hebel long. Fällt der Kurs, müssen sie verkaufen und beschleunigen den Fall. Extrem negativ heisst dasselbe für Shorts (Squeeze-Gefahr nach oben).",
  basis_crowding:
    "Die Basis ist der Abstand zwischen dem Perpetual-Futures-Preis (Binance) und dem Spot-Preis. Liegt der Futures-Preis mehr als 0,15 % über Spot, zahlen viele Trader einen Aufschlag, um mit Hebel long zu sein (Crowding). Fällt der Kurs, werden diese Longs zwangsweise geschlossen und können den Fall beschleunigen. Unter −0,15 % gilt dasselbe für Shorts. Normal sind bei BTC etwa −0,03 bis −0,06 %.",
  elevated_volatility:
    "Die durchschnittliche Schwankung einer 1h-Kerze (ATR) liegt über 1 % des Preises, also über dem obersten Zehntel der Normalwerte. Bewegungen sind grösser und schneller als üblich, Stopps werden leichter erreicht. Positionsgrösse und Stopp-Abstand anpassen.",
};

// Was die warnenden Muster aus compute-market-state bedeuten.
const PATTERN_EXPLANATIONS_DE: Record<string, string> = {
  "Bullish Confirmation":
    "Drei unabhängige Blickwinkel zeigen gleichzeitig nach oben: Marktstruktur, Orderflow (mehr aggressive Käufe als Verkäufe) und neu aufgebaute Positionen (Open Interest). Das ist eine Bestätigung, kein Einstiegssignal.",
  "Fragile Bullish":
    "Der Chart sieht bullisch aus (höhere Hochs und Tiefs), aber im Orderflow verkaufen die aggressiven Händler mehr, als sie kaufen. Der Anstieg ist dadurch schlecht abgestützt und kann leichter kippen.",
  "Distribution Warning":
    "Der Preis steht nahe am Hoch der letzten 20 Stunden, gleichzeitig fällt der Orderflow. Typisch, wenn grosse Teilnehmer in die Stärke hinein verkaufen. Häufig ein Warnzeichen vor einem Rücksetzer.",
  Capitulation:
    "RSI unter 30, fallender Orderflow und viele Zwangsliquidationen im Verhältnis zum Open Interest. Das ist eine Ausverkaufsphase. Sie kann kurz vor einem Boden stehen, aber auch weiterlaufen. Nicht ins fallende Messer greifen.",
  "Short Squeeze":
    "Kleinanleger sind überwiegend short, grosse Trader long, und das Open Interest steigt. Steigt der Kurs, müssen die Shorts zurückkaufen und können den Anstieg beschleunigen.",
};

// Duplikat von REGIME_LABELS in lib/marketRegime.ts (Next.js-Repo).
const REGIME_LABELS_DE: Record<string, string> = {
  HIGH_VOLA_REVERSION: "Hohe Volatilität / Reversion",
  TREND_EXPANSION_BULLISH: "Trendausweitung (bullisch)",
  TREND_EXPANSION_BEARISH: "Trendausweitung (bärisch)",
  TREND_FORMING_BULLISH: "Trendbildung (bullisch)",
  TREND_FORMING_BEARISH: "Trendbildung (bärisch)",
  VOLA_SQUEEZE_RANGING: "Volatilitäts-Squeeze / Seitwärts",
  UNRESOLVED_NEUTRAL: "Unklar / kein Regime",
};

// Kurzer Text in der Push selbst (nur die "vor einem Ausbruch"-Regimes).
const REGIME_NOTE_DE: Record<string, string> = {
  VOLA_SQUEEZE_RANGING: "Niedriger ADX bei komprimierten Bollinger-Bändern -- typische Coiling-Phase vor einem möglichen Ausbruch.",
  TREND_FORMING_BULLISH: "Richtung zeigt bullisch, ADX aber noch unter der Bestätigungsschwelle (25) -- ein sich formender, noch nicht vollständig bestätigter Trend.",
  TREND_FORMING_BEARISH: "Richtung zeigt bärisch, ADX aber noch unter der Bestätigungsschwelle (25) -- ein sich formender, noch nicht vollständig bestätigter Trend.",
};

// Ausfuehrliche Erklaerung je Regime fuer die Mitteilungs-Seite.
const REGIME_EXPLANATION_DE: Record<string, string> = {
  HIGH_VOLA_REVERSION:
    "Sehr grosse Schwankungen, der Preis ist weit vom Durchschnitt entfernt. In solchen Phasen laufen Bewegungen oft zurück (Reversion). Ausbrüche sind unzuverlässig, Stopps brauchen mehr Abstand.",
  TREND_EXPANSION_BULLISH:
    "Ein bestätigter Aufwärtstrend (ADX über 25) gewinnt an Stärke. Rücksetzer werden in dieser Phase meist gekauft. Gegen den Trend zu handeln ist riskant.",
  TREND_EXPANSION_BEARISH:
    "Ein bestätigter Abwärtstrend (ADX über 25) gewinnt an Stärke. Erholungen werden in dieser Phase meist verkauft. Gegen den Trend zu handeln ist riskant.",
  TREND_FORMING_BULLISH:
    "Die Richtung zeigt nach oben, die Trendstärke (ADX) liegt aber noch unter 25. Ein Trend bildet sich vielleicht, ist aber noch nicht bestätigt und kann wieder zerfallen.",
  TREND_FORMING_BEARISH:
    "Die Richtung zeigt nach unten, die Trendstärke (ADX) liegt aber noch unter 25. Ein Trend bildet sich vielleicht, ist aber noch nicht bestätigt und kann wieder zerfallen.",
  VOLA_SQUEEZE_RANGING:
    "Wenig Trend und eng zusammengezogene Bollinger-Bänder: Der Markt sammelt Energie. Auf solche Phasen folgt oft ein grösserer Ausbruch, die Richtung ist aber offen. Erst den Ausbruch abwarten.",
  UNRESOLVED_NEUTRAL:
    "Keine der Regeln passt eindeutig: weder klarer Trend noch Squeeze noch extreme Volatilität. Der Markt hat gerade keine klare Phase.",
};

const REGIME_TIMEFRAMES: { interval: string; label: string }[] = [
  { interval: "1h", label: "1h" },
  { interval: "4h", label: "4h" },
  { interval: "1d", label: "1D" },
];

const REGIME_SYMBOL = "BTCUSDT";
const REGIME_EXCHANGE = "binance";
const DISPLAY_ZONE = "Europe/Zurich";

async function fetchLatestRegimeRows(
  supabase: ReturnType<typeof createClient>,
  interval: string
): Promise<MarketStateMatrixRow[] | null> {
  const query = interval === "1h"
    ? supabase
        .from("market_state_matrix")
        .select("regime, timestamp_utc, adx_14")
        .eq("symbol", REGIME_SYMBOL)
        .eq("interval", interval)
    : supabase
        .rpc("compute_market_state_matrix_series", {
          p_symbol: REGIME_SYMBOL,
          p_interval: interval,
          p_exchange: REGIME_EXCHANGE,
        })
        .select("regime, timestamp_utc, adx_14");
  const { data, error } = await query.order("timestamp_utc", { ascending: false }).limit(2);
  if (error) {
    console.error(`Regime-Fetch ${interval} fehlgeschlagen:`, error.message);
    return null;
  }
  return (data ?? []) as unknown as MarketStateMatrixRow[];
}

// Kerzen-Eroeffnungszeit in Schweizer Ortszeit, je Zeitrahmen so knapp wie
// moeglich (1h: nur Uhrzeit, 4h: Datum + Uhrzeit, 1D: nur Datum).
function candleLabel(interval: string, timestampUtc: string): string {
  const d = new Date(timestampUtc);
  const date = new Intl.DateTimeFormat("de-CH", { timeZone: DISPLAY_ZONE, day: "2-digit", month: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("de-CH", { timeZone: DISPLAY_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  if (interval === "1d") return `Tageskerze ${date}`;
  if (interval === "4h") return `Kerze ${date} ${time}`;
  return `Kerze ${time}`;
}

// Abschnitt 4 -- Wirtschaftsdaten-Vorwarnung + Ergebnis.
const ZONE_US = "America/New_York";
const MINUTE_MS = 60 * 1000;

interface NewsMarkDef {
  markId: string;
  warningId: string;
  eventKeys: string[];
  zeit: string; // 'HH:mm' Wanduhrzeit in ZONE_US
}

const NEWS_MARKS: NewsMarkDef[] = [
  { markId: "macro830", warningId: "macro", eventKeys: ["cpi", "pce", "nfp"], zeit: "08:30" },
  { markId: "fomc1400", warningId: "fomc", eventKeys: ["fomc"], zeit: "14:00" },
];

// Vorwarn-Stufen vor dem Termin -- windowMin > 15 (Cron-Intervall), damit
// jede Stufe garantiert von einem Lauf erfasst wird.
const PRE_EVENT_STAGES: { stage: string; offsetMin: number; windowMin: number }[] = [
  { stage: "t60", offsetMin: 60, windowMin: 20 },
  { stage: "t15", offsetMin: 15, windowMin: 20 },
];

// Ergebnis seit 14.10.2026 aus den News statt FRED: die Next.js-Route
// /api/economic-result/generate fasst die ersten Schlagzeilen per KI
// zusammen und speichert sie in economic_event_results. Nach 6h ohne
// Schlagzeilen wird aufgegeben.
const RESULT_MAX_WAIT_MS = 6 * 60 * MINUTE_MS;
const APP_URL = Deno.env.get("NEXUS_APP_URL") ?? "https://nexus-atlas-zeta.vercel.app";
const BIAS_DE: Record<string, string> = { bullish: "🟢 bullisch", bearish: "🔴 bärisch", neutral: "⚪ neutral" };

// Duplikat von EVENT_HIGHER_MEANS_BEARISH in lib/economicCalendar.ts.
const EVENT_HIGHER_MEANS_BEARISH: Record<string, boolean> = {
  cpi: true,
  pce: true,
  nfp: true,
  fomc: true, // Zinserhöhung = bärisch, Zinssenkung = bullisch
};

function legendeText(eventKey: string): string {
  const bearishIfUp = EVENT_HIGHER_MEANS_BEARISH[eventKey] ?? true;
  return bearishIfUp
    ? "↑ höher als erwartet → 🔴 bärisch für BTC · ↓ tiefer → 🟢 bullisch für BTC"
    : "↑ höher als erwartet → 🟢 bullisch für BTC · ↓ tiefer → 🔴 bärisch für BTC";
}

// Kurzfassung von lib/economicCalendar.ts::ECONOMIC_EVENT_INTERPRETATION.
const NEWS_INTERPRETATION_DE: Record<string, string> = {
  cpi: "Höher als erwartet oft belastend für Risikoassets wie BTC, niedriger oft umgekehrt.",
  pce: "Fed-bevorzugtes Inflationsmaß — Reaktion meist ähnlich wie CPI.",
  nfp: "Starke Beschäftigungsdaten oft belastend (straffere Fed erwartet), schwache oft umgekehrt.",
  fomc: "Zinsentscheid + Ausblick bewegen Risikoassets oft stärker als andere Termine.",
};

// Was der Termin ist (fuer die Mitteilungs-Seite).
const NEWS_WHAT_DE: Record<string, string> = {
  cpi: "Der US-Verbraucherpreisindex (CPI) misst die Inflation. Er entscheidet mit, ob die US-Notenbank die Zinsen senkt oder hoch hält.",
  pce: "Der PCE-Preisindex ist das Inflationsmass, auf das die US-Notenbank (Fed) am meisten schaut.",
  nfp: "Der US-Arbeitsmarktbericht (Non-Farm Payrolls) zeigt, wie viele Stellen geschaffen wurden. Ein starker Arbeitsmarkt spricht eher gegen Zinssenkungen.",
  fomc: "Die US-Notenbank (Fed) gibt ihren Zinsentscheid bekannt, danach folgt die Pressekonferenz.",
};

interface EconomicEventRow {
  event_key: string;
  label: string;
  event_date: string; // 'YYYY-MM-DD'
  typical_time_et: string | null;
}

interface NewsPushSentRow {
  warning_id: string;
  mark_id: string;
  event_date: string;
}

interface EconomicResultRow {
  bias: string;
  summary: string;
}

/** Wanduhrzeit `HH:mm` an `dateStr` (`YYYY-MM-DD`) in `zone` -> UTC-Millisekunden. */
function zonedWallTimeToUtc(dateStr: string, hhmm: string, zone: string): number {
  const naiveUtc = Date.parse(`${dateStr}T${hhmm}:00Z`);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(naiveUtc).map((p) => [p.type, p.value]));
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const offsetMs = asIfUtc - naiveUtc;
  return naiveUtc - offsetMs;
}

interface PushSubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface WarningPattern {
  name: string;
  note: string;
}

interface FactorEntry {
  value: -1 | 0 | 1 | null;
  basis: Record<string, unknown>;
}

interface MarketStateRow {
  overall_state: string;
  confidence: number;
  score: number;
  timestamp_utc: string;
  mtf_alignment: { timeframes?: Record<string, -1 | 0 | 1>; alignment_pct?: number } | null;
  risk_factors: string[] | null;
  patterns: WarningPattern[] | null;
  factors: Record<string, FactorEntry> | null;
}

interface MarketStateMatrixRow {
  regime: string | null;
  timestamp_utc: string;
  adx_14: number | string | null;
}

// Eine Push-Nachricht samt Erklaerung fuer die Mitteilungs-Seite.
interface PushEvent {
  kind: string;
  title: string;
  body: string;
  explanation: string;
  details?: string[];
  // Weiterfuehrender Link auf der Mitteilungs-Seite (z.B. Report).
  link?: string | null;
}

// Exakt dieselbe Ableitung wie lib/entryFilter.ts::deriveEntryFilter.
function entryDirection(row: MarketStateRow | null): "long" | "short" | null {
  const d = row?.mtf_alignment?.timeframes?.["4h"];
  if (d === 1) return "long";
  if (d === -1) return "short";
  return null;
}

function fmtNum(value: unknown, digits: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "–";
  return n.toLocaleString("de-CH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function directionWord(v: -1 | 0 | 1 | null): string {
  return v === 1 ? "bullisch" : v === -1 ? "bärisch" : v === 0 ? "neutral" : "keine Daten";
}

// Standard-Erklaerung fuer custom-Pushes ohne eigene explanation.
function customExplanation(title: string): { kind: string; explanation: string } {
  if (title.includes("YouTube")) {
    return {
      kind: "youtube",
      explanation:
        "Der YouTube-Monitor schaut jeden Morgen, welche neuen Videos die beobachteten Krypto-Kanäle veröffentlicht haben, und fasst ihre Einschätzung zusammen (bullisch, bärisch, neutral). Die Nachricht zeigt, ob sich die Kanäle einig sind. Das ist ein Stimmungsbild aus Meinungen, keine Marktmessung, und eignet sich eher als Gegencheck.",
    };
  }
  if (title.startsWith("BTC ·") || title.includes("Briefing")) {
    return {
      kind: "briefing",
      explanation:
        "Das System-Briefing ist die automatische Lageeinschätzung zu den eingestellten Zeiten. Es fasst Marktlage, Struktur, Orderflow, Termine und Risiken zusammen. Die Nachricht zeigt nur die Kernaussage, das ganze Briefing steht im Dashboard.",
    };
  }
  return {
    kind: "custom",
    explanation: "Automatische Meldung aus Nexus Atlas. Die Einzelheiten stehen im Dashboard.",
  };
}

async function sendToAll(
  supabase: ReturnType<typeof createClient>,
  subs: PushSubRow[],
  payload: Record<string, unknown>
): Promise<{ sent: number; removed: number; failed: number }> {
  let sent = 0;
  let removed = 0;
  let failed = 0;
  const body = JSON.stringify(payload);

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        PUSH_OPTIONS
      );
      sent++;
    } catch (err) {
      // 404/410 = Browser hat die Subscription selbst beendet -- Zeile
      // aufraeumen. Alle anderen Fehler werden nur gezaehlt.
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        removed++;
      } else {
        failed++;
      }
    }
  }

  return { sent, removed, failed };
}

// Speichert die Nachricht mit Erklaerung und schickt sie mit einem Link auf
// /mitteilung/<id>. Ohne gespeicherte Zeile geht sie mit dem alten Link raus.
async function sendEvent(
  supabase: ReturnType<typeof createClient>,
  subs: PushSubRow[],
  ev: PushEvent
): Promise<{ sent: number; removed: number; failed: number }> {
  const link = ev.link && ev.link !== "/" ? ev.link : null;
  const { data, error } = await supabase
    .from("push_messages")
    .insert({
      kind: ev.kind,
      title: ev.title,
      body: ev.body,
      explanation: ev.explanation,
      details: ev.details ?? [],
      link_url: link,
    })
    .select("id")
    .single();
  if (error) console.error("push_messages insert:", error.message);
  const url = data?.id ? `/mitteilung/${data.id}` : link ?? "/";
  return await sendToAll(supabase, subs, { title: ev.title, body: ev.body, url });
}

function stateChangeDetails(latest: MarketStateRow): string[] {
  const details: string[] = [];
  const factors = latest.factors ?? {};
  for (const [name, f] of Object.entries(factors)) {
    if (f?.value === 1 || f?.value === -1) {
      details.push(`${FACTOR_LABELS_DE[name] ?? name}: ${directionWord(f.value)}`);
    }
  }
  details.push(`Summe ${latest.score > 0 ? "+" : ""}${latest.score}, Verlässlichkeit ${Math.round(latest.confidence)}/100`);
  return details;
}

async function riskFactorDetails(
  supabase: ReturnType<typeof createClient>,
  factor: string,
  latest: MarketStateRow
): Promise<string[]> {
  const f = latest.factors ?? {};
  if (factor === "basis_crowding") {
    const b = f.basis?.basis ?? {};
    return [
      `Basis: ${fmtNum(b.basis_pct, 3)} % (Schwelle ±0,15 %)`,
      `Futures (Binance-Perpetual, 1h-Schluss): ${fmtNum(b.close_price, 0)} $`,
      `Spot: ${fmtNum(b.spot_price, 0)} $`,
    ];
  }
  if (factor === "funding_crowding") {
    const rate = Number(f.funding?.basis?.avg_current_rate);
    return [
      `Funding (Mittel über die Börsen): ${Number.isFinite(rate) ? fmtNum(rate * 100, 4) : "–"} % je 8 h (Schwelle ±0,05 %)`,
    ];
  }
  if (factor === "low_mtf_alignment") {
    const mtf = latest.mtf_alignment ?? {};
    const tfs = Object.entries(mtf.timeframes ?? {})
      .map(([tf, v]) => `${tf.toUpperCase()} ${directionWord(v)}`)
      .join(", ");
    return [`Einigkeit: ${fmtNum(mtf.alignment_pct, 0)} % (Schwelle 60 %)`, tfs ? `Struktur: ${tfs}` : ""].filter(Boolean);
  }
  if (factor === "elevated_volatility") {
    const { data } = await supabase
      .from("market_features")
      .select("atr_14, close_price")
      .eq("symbol", "BTCUSDT")
      .eq("interval", "1h")
      .order("candle_open_time", { ascending: false })
      .limit(1)
      .maybeSingle();
    const atr = Number(data?.atr_14);
    const close = Number(data?.close_price);
    return Number.isFinite(atr) && Number.isFinite(close) && close > 0
      ? [`ATR (1h): ${fmtNum(atr, 0)} $ = ${fmtNum((atr / close) * 100, 2)} % des Preises (Schwelle 1 %)`]
      : [];
  }
  return [];
}

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: vapidPrivateKey, error: keyError } = await supabase.rpc("get_secret", {
    secret_name: "VAPID_PRIVATE_KEY",
  });

  if (keyError || !vapidPrivateKey) {
    return new Response(
      JSON.stringify({ success: false, error: keyError ? keyError.message : "VAPID_PRIVATE_KEY nicht in Vault hinterlegt" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, vapidPrivateKey);

  let isTest = false;
  let customPayload: { title?: string; body?: string; url?: string; explanation?: string; kind?: string } | null = null;
  try {
    const body = await req.json();
    isTest = body?.test === true;
    if (body?.custom && typeof body.custom === "object") {
      customPayload = body.custom;
    }
  } catch {
    // Kein/leerer Body -- normaler Cron-Aufruf, kein Fehler.
  }

  const { data: subs, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth");

  if (subsError) {
    return new Response(JSON.stringify({ success: false, error: subsError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!subs || subs.length === 0) {
    return new Response(JSON.stringify({ success: true, skipped: "no_subscriptions" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (isTest) {
    const result = await sendEvent(supabase, subs as PushSubRow[], {
      kind: "test",
      title: "Nexus Atlas",
      body: "Test-Benachrichtigung — Push funktioniert.",
      explanation:
        "Diese Nachricht wurde über „Test-Benachrichtigung senden“ im Konto-Bereich ausgelöst. Sie bestätigt nur, dass Push-Nachrichten auf diesem Gerät ankommen und das Antippen hierher führt.",
    });
    return new Response(JSON.stringify({ success: true, test: true, ...result }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (customPayload) {
    const title = typeof customPayload.title === "string" && customPayload.title.length > 0
      ? customPayload.title
      : "Nexus Atlas";
    const bodyText = typeof customPayload.body === "string" && customPayload.body.length > 0
      ? customPayload.body
      : "Neue Meldung.";
    const url = typeof customPayload.url === "string" && customPayload.url.length > 0
      ? customPayload.url
      : "/";
    const fallback = customExplanation(title);
    const result = await sendEvent(supabase, subs as PushSubRow[], {
      kind: typeof customPayload.kind === "string" && customPayload.kind.length > 0 ? customPayload.kind : fallback.kind,
      title,
      body: bodyText,
      explanation:
        typeof customPayload.explanation === "string" && customPayload.explanation.length > 0
          ? customPayload.explanation
          : fallback.explanation,
      link: url,
    });
    return new Response(JSON.stringify({ success: true, custom: true, ...result }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const events: PushEvent[] = [];
  const nowMs = Date.now();

  async function alreadySent(warningId: string, markId: string, eventDate: string): Promise<boolean> {
    const { data } = await supabase
      .from("news_warning_pushes_sent")
      .select("warning_id")
      .eq("warning_id", warningId)
      .eq("mark_id", markId)
      .eq("event_date", eventDate)
      .maybeSingle<NewsPushSentRow>();
    return !!data;
  }

  async function markSent(warningId: string, markId: string, eventDate: string): Promise<void> {
    await supabase.from("news_warning_pushes_sent").insert({ warning_id: warningId, mark_id: markId, event_date: eventDate });
  }

  let resultRouteCalled = false;
  async function readEconomicResult(eventKey: string, eventDate: string): Promise<EconomicResultRow | null> {
    const { data } = await supabase
      .from("economic_event_results")
      .select("bias, summary")
      .eq("event_key", eventKey)
      .eq("event_date", eventDate)
      .maybeSingle<EconomicResultRow>();
    return data ?? null;
  }

  // Liest die gespeicherte Einordnung; fehlt sie, einmal pro Lauf die
  // Next.js-Route anstossen (CRON_SECRET aus dem Vault, wie die Scheduler).
  async function fetchEconomicResult(eventKey: string, eventDate: string): Promise<EconomicResultRow | null> {
    const existing = await readEconomicResult(eventKey, eventDate);
    if (existing || resultRouteCalled) return existing;
    resultRouteCalled = true;
    const { data: cronSecret } = await supabase.rpc("get_secret", { secret_name: "CRON_SECRET" });
    if (!cronSecret) return null;
    try {
      await fetch(`${APP_URL}/api/economic-result/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cronSecret}` },
      });
    } catch (err) {
      console.error("economic-result/generate nicht erreichbar:", err instanceof Error ? err.message : String(err));
    }
    return await readEconomicResult(eventKey, eventDate);
  }

  // 4) Wirtschaftsdaten-Vorwarnung + Ergebnis -- laeuft UNABHAENGIG von
  // market_states, damit ein leerer market_states-Verlauf sie nicht blockiert.
  const allEventKeys = NEWS_MARKS.flatMap((m) => m.eventKeys);
  const { data: newsEvents } = await supabase
    .from("economic_calendar_events")
    .select("event_key, label, event_date, typical_time_et")
    .in("event_key", allEventKeys);

  for (const mark of NEWS_MARKS) {
    const matchingEvents = ((newsEvents ?? []) as EconomicEventRow[]).filter((e) =>
      mark.eventKeys.includes(e.event_key)
    );
    for (const ev of matchingEvents) {
      const markMs = zonedWallTimeToUtc(ev.event_date, mark.zeit, ZONE_US);
      // 14.10.2026 (Toby): Zeiten immer in Schweizer Zeit statt US-Ostkueste.
      const zeitLabel = `${new Intl.DateTimeFormat("de-CH", { timeZone: DISPLAY_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(markMs)} Uhr`;
      const what = NEWS_WHAT_DE[ev.event_key] ?? "";

      // Stufen 1+2: Vorwarnung mit allgemeiner Pfeil/Farb-Legende.
      for (const { stage, offsetMin, windowMin } of PRE_EVENT_STAGES) {
        const stageMarkId = `${mark.markId}_${stage}`;
        const targetMs = markMs - offsetMin * MINUTE_MS;
        if (nowMs < targetMs || nowMs >= targetMs + windowMin * MINUTE_MS) continue;
        if (await alreadySent(mark.warningId, stageMarkId, ev.event_date)) continue;

        const interpretation = NEWS_INTERPRETATION_DE[ev.event_key] ?? "";
        events.push({
          kind: "economic_pre",
          title: `Nexus Atlas — ${ev.label} in ${offsetMin} Min`,
          body: `${zeitLabel}. ${interpretation} ${legendeText(ev.event_key)}`.trim(),
          explanation:
            `${what} Veröffentlichung um ${zeitLabel} (Schweizer Zeit). Rund um solche Termine springt BTC oft in wenigen Minuten stark, ` +
            "Spreads werden breiter und Stopps werden häufiger ausgelöst, auch in beide Richtungen nacheinander. " +
            "Die Pfeile zeigen die übliche Lesart, nicht die sichere Reaktion. Die Nachricht ist eine Erinnerung, keine Prognose.",
          details: [`Termin: ${ev.label}, ${zeitLabel}`, interpretation, legendeText(ev.event_key)].filter(Boolean),
        });
        await markSent(mark.warningId, stageMarkId, ev.event_date);
      }

      // Stufe 3: Ergebnis aus economic_event_results.
      const resultMarkId = `${mark.markId}_result`;
      if (nowMs >= markMs && nowMs < markMs + RESULT_MAX_WAIT_MS) {
        if (!(await alreadySent(mark.warningId, resultMarkId, ev.event_date))) {
          const result = await fetchEconomicResult(ev.event_key, ev.event_date);
          if (result) {
            events.push({
              kind: "economic_result",
              title: `Nexus Atlas — ${ev.label}: ${BIAS_DE[result.bias] ?? result.bias} für BTC`,
              body: result.summary,
              explanation:
                `${what} Die Einordnung stammt aus den ersten Schlagzeilen nach der Veröffentlichung, von einer KI zusammengefasst. ` +
                "„Bullisch“ oder „bärisch“ beschreibt die übliche Lesart für BTC, nicht die tatsächliche Kursreaktion. " +
                "Die ersten Minuten danach sind oft unruhig, die eigentliche Richtung zeigt sich häufig erst später.",
              details: [`Einordnung: ${BIAS_DE[result.bias] ?? result.bias}`],
            });
            await markSent(mark.warningId, resultMarkId, ev.event_date);
          }
        }
      }
    }
  }

  const { data: states, error: statesError } = await supabase
    .from("market_states")
    .select("overall_state, confidence, score, timestamp_utc, mtf_alignment, risk_factors, patterns, factors")
    .order("timestamp_utc", { ascending: false })
    .limit(2);

  if (!statesError && states && states.length >= 2) {
    const [latest, previous] = states as unknown as MarketStateRow[];

    // 1) Zustandswechsel -- nur, wenn die neue Richtung auch auf der
    // Kachel als solche sichtbar waere (Confidence >= CONFIDENCE_THRESHOLD).
    const isDirectional =
      (latest.overall_state === "BULLISH" || latest.overall_state === "BEARISH") &&
      latest.confidence >= CONFIDENCE_THRESHOLD;
    if (latest.overall_state !== previous.overall_state && isDirectional) {
      const fromLabel = STATE_LABELS_DE[previous.overall_state] ?? previous.overall_state;
      const toLabel = STATE_LABELS_DE[latest.overall_state] ?? latest.overall_state;
      events.push({
        kind: "state_change",
        title: `Nexus Atlas — ${toLabel}`,
        body: `Zustandswechsel: ${fromLabel} → ${toLabel} (Confidence ${Math.round(latest.confidence)}/100)`,
        explanation:
          "Die Marktlage fasst 14 Faktoren zusammen (Struktur, Momentum, Orderflow, Open Interest, Positionierung, Orderbuch, Optionen, Makro, Funding, Fear & Greed, Trendstärke, Trend, VWAP, Basis). " +
          "Jeder Faktor zählt +1 (bullisch), 0 oder −1 (bärisch). Ab einer Summe von +3 gilt die Lage als bullisch, ab −3 als bärisch. " +
          "Gemeldet wird nur, wenn die Verlässlichkeit mindestens 35/100 beträgt. Unten stehen die Faktoren, die gerade eine Richtung zeigen. Beschreibung der aktuellen Lage, kein Handelssignal.",
        details: stateChangeDetails(latest),
      });
    }

    // 2) Einstiegsfilter-Uebergang
    const prevDir = entryDirection(previous);
    const currDir = entryDirection(latest);
    if (currDir !== null && currDir !== prevDir) {
      const dirLabelDe = currDir === "long" ? "Long" : "Short";
      events.push({
        kind: "entry_filter",
        title: `Nexus Atlas — Einstiegsfilter ${dirLabelDe}`,
        body: `4h-Struktur zeigt jetzt ${currDir === "long" ? "long" : "short"} -- Einstiegsfilter bestätigt.`,
        explanation:
          "Der Einstiegsfilter schaut auf die Marktstruktur im 4-Stunden-Chart: Höhere Hochs und höhere Tiefs heissen long, tiefere Hochs und tiefere Tiefs short. " +
          "Er sagt, in welche Richtung Trades eher mit dem übergeordneten Trend laufen. Er ist kein Einstiegssignal an sich: Den Einstieg liefert das eigene Setup.",
        details: [
          `4h-Struktur vorher: ${prevDir === "long" ? "long" : prevDir === "short" ? "short" : "neutral/keine Daten"}`,
          `4h-Struktur jetzt: ${dirLabelDe.toLowerCase()}`,
        ],
      });
    }

    // 3a) Warnende Muster -- Crossing auf Pattern-NAME-Ebene.
    const prevPatternNames = new Set((previous.patterns ?? []).map((p) => p.name));
    const newPatterns = (latest.patterns ?? []).filter((p) => !prevPatternNames.has(p.name));
    for (const pattern of newPatterns) {
      events.push({
        kind: "pattern",
        title: `Nexus Atlas — Warnendes Muster: ${pattern.name}`,
        body: pattern.note,
        explanation:
          PATTERN_EXPLANATIONS_DE[pattern.name] ??
          "Ein Muster aus mehreren Faktoren der Marktlage, das auf eine mögliche Wende oder Schwäche hinweist. Interpretationshilfe, kein Handelssignal.",
        details: [pattern.note],
      });
    }

    // 3b) Uebrige Risiko-Faktoren -- nur was NEU dazu kam.
    const prevRiskSet = new Set(previous.risk_factors ?? []);
    const newRiskFactors = (latest.risk_factors ?? []).filter(
      (f) => f !== "warning_pattern" && !prevRiskSet.has(f)
    );
    for (const factor of newRiskFactors) {
      events.push({
        kind: `risk_${factor}`,
        title: "Nexus Atlas — Risiko-Warnung",
        body: RISK_FACTOR_LABELS_DE[factor] ?? factor,
        explanation:
          RISK_FACTOR_EXPLANATIONS_DE[factor] ??
          "Ein Risiko-Faktor der Marktlage ist neu aufgetreten. Er beschreibt, wie fragil die Lage ist, nicht in welche Richtung es geht.",
        details: await riskFactorDetails(supabase, factor, latest),
      });
    }
  }

  // 5) Regime-Wechsel je Zeitrahmen, Dedupe ueber regime_change_pushes_sent.
  for (const tf of REGIME_TIMEFRAMES) {
    const regimeRows = await fetchLatestRegimeRows(supabase, tf.interval);
    if (!regimeRows || regimeRows.length < 2) continue;
    const [latestRegime, previousRegime] = regimeRows;
    if (!latestRegime.regime || latestRegime.regime === previousRegime.regime) continue;

    const { data: sentRow } = await supabase
      .from("regime_change_pushes_sent")
      .select("interval")
      .eq("interval", tf.interval)
      .eq("candle_time", latestRegime.timestamp_utc)
      .maybeSingle();
    if (sentRow) continue;

    const fromLabel = REGIME_LABELS_DE[previousRegime.regime ?? ""] ?? previousRegime.regime;
    const toLabel = REGIME_LABELS_DE[latestRegime.regime] ?? latestRegime.regime;
    const note = REGIME_NOTE_DE[latestRegime.regime];
    const details = [`${fromLabel} → ${toLabel}`];
    if (latestRegime.adx_14 !== null && latestRegime.adx_14 !== undefined) {
      details.push(`ADX ${Number(latestRegime.adx_14).toFixed(1)}`);
    }
    details.push(candleLabel(tf.interval, latestRegime.timestamp_utc));
    const bodyText = details.join(" · ");
    events.push({
      kind: "regime",
      title: `Nexus Atlas — Regime (BTC · ${tf.label}): ${toLabel}`,
      body: note ? `${bodyText}. ${note}` : bodyText,
      explanation:
        `Die Marktphase (Regime) im ${tf.label}-Chart hat gewechselt. ${REGIME_EXPLANATION_DE[latestRegime.regime] ?? ""} ` +
        "Grundlage sind Trendstärke (ADX über 25 = bestätigter Trend), Richtung, Bollinger-Bänder und Volatilität. " +
        "Höhere Zeitrahmen (4h, 1D) sind träger, aber aussagekräftiger als 1h.",
      details: [
        `Zeitrahmen: ${tf.label}`,
        `Vorher: ${fromLabel}`,
        `Jetzt: ${toLabel}`,
        ...(latestRegime.adx_14 !== null && latestRegime.adx_14 !== undefined
          ? [`ADX: ${Number(latestRegime.adx_14).toFixed(1)}`]
          : []),
        candleLabel(tf.interval, latestRegime.timestamp_utc),
      ],
    });
    await supabase.from("regime_change_pushes_sent").upsert(
      { interval: tf.interval, candle_time: latestRegime.timestamp_utc, regime: latestRegime.regime },
      { onConflict: "interval,candle_time", ignoreDuplicates: true }
    );
  }

  if (events.length === 0) {
    return new Response(
      JSON.stringify({ success: true, skipped: "no_trigger" }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  let sent = 0;
  let removed = 0;
  let failed = 0;
  for (const ev of events) {
    const r = await sendEvent(supabase, subs as PushSubRow[], ev);
    sent += r.sent;
    removed += r.removed;
    failed += r.failed;
  }

  return new Response(
    JSON.stringify({ success: true, events: events.map((e) => e.title), sent, removed, failed }),
    { headers: { "Content-Type": "application/json" } }
  );
});
