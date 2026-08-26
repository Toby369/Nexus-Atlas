// Regelbasierte Futures-vs-Spot Markteinordnung (kein KI-Aufruf, reine
// Schwellenwert-Logik). Kombiniert drei unabhaengige, bereits an anderer
// Stelle im Dashboard sichtbare Kennzahlen -- niemals eine isolierte
// Einzelkennzahl:
//   1. Futures-Preisrichtung (Bybit-Referenz)
//   2. Futures-Open-Interest-Richtung (aggregiert ueber alle Boersen)
//   3. Spot-Taker-Netto-Flow (Binance Spot, echter Buy/Sell-Split)
//
// Preis+OI ergeben das klassische 4-Quadranten-Schema aus dem Futures-
// Handel (Long-/Short-Aufbau, Short-Covering, Long-Abbau) -- dieselbe Logik
// steckt bereits (informeller, nicht als eigenes Feld) in der
// describeStructure()-Funktion von collect-btc fuer die Markteinschaetzung.
// Der Spot-Flow bestaetigt oder relativiert diesen Quadranten: bewegt sich
// der Spot-Markt in dieselbe Richtung, ist die Bewegung eher real
// nachfragegetrieben; bewegt er sich nicht mit, ist sie eher gehebelt/
// mechanisch (Liquidationen, Covering) und potenziell fragiler.

export type MarketScenario =
  | "long_buildup"
  | "short_buildup"
  | "short_covering"
  | "long_unwind"
  | "neutral";

// Datenqualitaets-Tier fuer das Gesamt-Assessment -- unabhaengig vom
// eigenen (Spot-spezifischen) Tier in lib/spotPressure.ts, aber mit
// denselben drei Stufen, damit spaeter beide Werte konsistent an eine AI-
// Auswertung uebergeben werden koennen (siehe Vorgabe Teil Q/T).
export type MarketDataQuality = "OK" | "PRELIMINARY" | "INSUFFICIENT_DATA";

export interface MarketContextInput {
  priceChangePct: number | null;
  oiChangePct: number | null;
  spotNetFlowPct: number | null;
  // Deckt der OI-Referenzpunkt den gesamten gewaehlten Zeitraum ab (analog
  // zu LivePricePanels hasFullHistory), oder wurde auf den aeltesten
  // verfuegbaren Punkt zurueckgefallen, weil die Historie noch zu jung ist?
  hasFullOiHistory: boolean;
  // Datenqualitaets-Tier der Spot-Seite (aus classifySpotPressure) --
  // fliesst mit ein, weil das Assessment Spot explizit als Bestaetigungs-
  // quelle nutzt und eine duenne Spot-Stichprobe die Aussage schwaecht.
  spotDataQuality: "OK" | "PRELIMINARY" | "INSUFFICIENT";
  // Laenge des gewaehlten Zeitraums in Minuten (TIMEFRAMES[x].minutes aus
  // lib/timeframes.ts) -- bestimmt die Flat-Schwellenwerte fuer Preis/OI
  // (siehe getMarketContextThresholds unten). Ohne diesen Wert wuerde ein
  // fuer 4H kalibrierter Schwellenwert unveraendert auch auf 15M oder 1M
  // angewendet, was genau der Audit-Befund war ("Keine klare Struktur"
  // bei kurzen Zeitraeumen fast immer, weil die durchschnittliche Preis-
  // /OI-Bewegung dort bereits unter dem Schwellenwert selbst liegt).
  timeframeMinutes: number;
}

export interface MarketContextResult {
  scenario: MarketScenario | null; // null = nicht genug Daten
  label: string;
  confirmed: boolean | null; // null = neutral oder Spot-Daten fehlen
  explanation: string;
  // Richtung des Szenarios selbst (long_buildup/short_covering = bullisch,
  // short_buildup/long_unwind = baerisch) -- unabhaengig von "confirmed".
  // "confirmed" sagt nur, ob der Spot-Markt die Futures-Bewegung bestaetigt,
  // nicht ob das Szenario an sich positiv oder negativ ist (ein bestaetigter
  // Short-Aufbau ist trotzdem baerisch, nicht bullisch).
  bias: "bullish" | "bearish" | "neutral";
  // Getrennt vom Szenario-Label: ob die zugrundeliegenden Daten fuer diesen
  // Zeitraum vollstaendig genug sind, um dem Szenario zu vertrauen.
  dataQuality: MarketDataQuality;
}

// Timeframe-skalierte Flat-Schwellenwerte fuer Preis/OI (ersetzt die vorher
// fest codierten 0.3%/1.0%, die unabhaengig vom gewaehlten Zeitraum galten
// -- siehe Audit: bei 15M lag die durchschnittliche Preisbewegung ueber
// 8 Tage Realdaten bereits UNTER dem alten Schwellenwert selbst, wodurch
// "Keine klare Struktur" bei kurzen Zeitraeumen praktisch der Normalfall
// war (99.1% der 15M-Faelle), statt die Ausnahme zu sein.
//
// Kalibrierung: Median der tatsaechlichen |Preis-/OI-Aenderung| ueber 8
// Tage Realdaten bei 1H (sauberstes, vollstaendig abgedecktes Fenster) als
// Basiswert, mal Faktor 1.5 (Schwellenwert = "spuerbar ueber dem
// typischen Rauschen dieses Fensters", nicht "jede minimale Bewegung").
// Skalierung auf andere Zeitraeume ueber Wurzel-Zeit (sqrt(Minuten/60)) --
// das ist keine willkuerliche Wahl, sondern die empirisch beobachtete
// Skalierung in denselben Realdaten (Exponent ≈0.5 zwischen 15M/1H/4H,
// deckungsgleich mit dem in der Finanzmarkt-Literatur ueblichen
// "Volatilitaet skaliert mit Wurzel(Zeit)"-Zusammenhang).
//
// Bewusst als Formel statt als Tabelle mit 6 Einzelwerten gehalten (Vorgabe
// Teil 33: Schwellenwerte muessen konfigurierbar und spaeter ueber
// historische Daten optimierbar sein) -- BASE_* und SCALING_EXPONENT sind
// die einzigen Stellen, die eine spaetere Kalibrierung/ein Backtest
// anpassen muesste.
const BASE_TIMEFRAME_MINUTES = 60; // 1H als Referenzpunkt der Kalibrierung
const BASE_PRICE_FLAT_THRESHOLD_PCT = 0.4;
const BASE_OI_FLAT_THRESHOLD_PCT = 0.4;
const THRESHOLD_SCALING_EXPONENT = 0.5;

export interface MarketContextThresholds {
  priceFlatThresholdPct: number;
  oiFlatThresholdPct: number;
}

export function getMarketContextThresholds(
  timeframeMinutes: number
): MarketContextThresholds {
  const scale = Math.pow(
    timeframeMinutes / BASE_TIMEFRAME_MINUTES,
    THRESHOLD_SCALING_EXPONENT
  );
  return {
    priceFlatThresholdPct: BASE_PRICE_FLAT_THRESHOLD_PCT * scale,
    oiFlatThresholdPct: BASE_OI_FLAT_THRESHOLD_PCT * scale,
  };
}

const SPOT_FLAT_THRESHOLD = 5;

const LABELS: Record<Exclude<MarketScenario, "neutral">, string> = {
  long_buildup: "Long-Aufbau",
  short_buildup: "Short-Aufbau",
  short_covering: "Short-Covering",
  long_unwind: "Long-Abbau",
};

const BIAS: Record<MarketScenario, "bullish" | "bearish" | "neutral"> = {
  long_buildup: "bullish",
  short_covering: "bullish",
  short_buildup: "bearish",
  long_unwind: "bearish",
  neutral: "neutral",
};

const EXPLANATIONS: Record<
  Exclude<MarketScenario, "neutral">,
  { confirmed: string; unconfirmed: string; unknown: string }
> = {
  long_buildup: {
    confirmed:
      "Preis und Open Interest steigen gemeinsam, und am Spot-Markt wird per Saldo aktiv gekauft. Das spricht für echten Positionsaufbau mit realer Nachfrage, nicht nur für gehebelte Wetten.",
    unconfirmed:
      "Preis und Open Interest steigen gemeinsam, aber am Spot-Markt fehlt aktuell die Kaufbestätigung. Der Anstieg könnte primär gehebelt getrieben sein — potenziell anfälliger für eine Korrektur.",
    unknown:
      "Preis und Open Interest steigen gemeinsam. Eine Spot-Bestätigung ist aktuell nicht verfügbar.",
  },
  short_buildup: {
    confirmed:
      "Preis fällt bei steigendem Open Interest, und am Spot-Markt wird per Saldo aktiv verkauft. Das spricht für echten Verteilungsdruck, nicht nur für neue Short-Wetten.",
    unconfirmed:
      "Preis fällt bei steigendem Open Interest, aber am Spot-Markt fehlt aktuell die Verkaufsbestätigung. Der Rückgang könnte primär durch neue Short-Positionen getrieben sein, nicht durch reale Verkäufe.",
    unknown:
      "Preis fällt bei steigendem Open Interest. Eine Spot-Bestätigung ist aktuell nicht verfügbar.",
  },
  short_covering: {
    confirmed:
      "Preis steigt bei fallendem Open Interest (Shorts werden eingedeckt), und am Spot-Markt wird zusätzlich aktiv gekauft. Das spricht für einen echten Short Squeeze mit realer Nachfrage.",
    unconfirmed:
      "Preis steigt bei fallendem Open Interest — vermutlich Short-Eindeckung. Am Spot-Markt fehlt eine klare Kaufbestätigung, der Anstieg könnte rein mechanisch sein und nach Ende des Covering abflachen.",
    unknown:
      "Preis steigt bei fallendem Open Interest, vermutlich Short-Eindeckung. Eine Spot-Bestätigung ist aktuell nicht verfügbar.",
  },
  long_unwind: {
    confirmed:
      "Preis fällt bei fallendem Open Interest, und am Spot-Markt wird zusätzlich aktiv verkauft. Das spricht für echte Kapitulation, nicht nur für erzwungene Glattstellungen.",
    unconfirmed:
      "Preis fällt bei fallendem Open Interest — vermutlich Long-Abbau/Liquidationen. Am Spot-Markt fehlt eine klare Verkaufsbestätigung, der Rückgang könnte primär durch erzwungene Positionsschliessungen getrieben sein.",
    unknown:
      "Preis fällt bei fallendem Open Interest, vermutlich Long-Abbau. Eine Spot-Bestätigung ist aktuell nicht verfügbar.",
  },
};

export function classifyMarketContext({
  priceChangePct,
  oiChangePct,
  spotNetFlowPct,
  hasFullOiHistory,
  spotDataQuality,
  timeframeMinutes,
}: MarketContextInput): MarketContextResult {
  if (priceChangePct === null || oiChangePct === null) {
    return {
      scenario: null,
      label: "INSUFFICIENT DATA",
      confirmed: null,
      explanation:
        "Noch nicht genug Daten für eine Futures-vs-Spot-Einordnung in diesem Zeitraum.",
      bias: "neutral",
      dataQuality: "INSUFFICIENT_DATA",
    };
  }

  // OI/Preis vorhanden, aber entweder deckt die Historie den Zeitraum noch
  // nicht voll ab, oder die Spot-Bestaetigung steht auf duenner Basis --
  // das Szenario wird trotzdem berechnet (echte Daten, keine Erfindung),
  // aber als PRELIMINARY gekennzeichnet statt stillschweigend wie ein
  // voll abgesichertes Ergebnis behandelt zu werden.
  const dataQuality: MarketDataQuality =
    !hasFullOiHistory || spotDataQuality !== "OK" ? "PRELIMINARY" : "OK";

  const { priceFlatThresholdPct, oiFlatThresholdPct } =
    getMarketContextThresholds(timeframeMinutes);

  const priceUp = priceChangePct > priceFlatThresholdPct;
  const priceDown = priceChangePct < -priceFlatThresholdPct;
  const oiUp = oiChangePct > oiFlatThresholdPct;
  const oiDown = oiChangePct < -oiFlatThresholdPct;

  let scenario: MarketScenario = "neutral";
  if (priceUp && oiUp) scenario = "long_buildup";
  else if (priceDown && oiUp) scenario = "short_buildup";
  else if (priceUp && oiDown) scenario = "short_covering";
  else if (priceDown && oiDown) scenario = "long_unwind";

  if (scenario === "neutral") {
    return {
      scenario: "neutral",
      label: "Keine klare Struktur",
      confirmed: null,
      explanation:
        "Preis und/oder Open Interest bewegen sich aktuell zu wenig für eine belastbare Struktur-Einordnung.",
      bias: "neutral",
      dataQuality,
    };
  }

  const spotUnknown = spotNetFlowPct === null;
  const spotBuying = spotNetFlowPct !== null && spotNetFlowPct > SPOT_FLAT_THRESHOLD;
  const spotSelling = spotNetFlowPct !== null && spotNetFlowPct < -SPOT_FLAT_THRESHOLD;
  const wantsBuyConfirmation = scenario === "long_buildup" || scenario === "short_covering";
  const confirmed = spotUnknown ? null : wantsBuyConfirmation ? spotBuying : spotSelling;

  const explanationSet = EXPLANATIONS[scenario];
  const explanation = spotUnknown
    ? explanationSet.unknown
    : confirmed
    ? explanationSet.confirmed
    : explanationSet.unconfirmed;

  const label =
    LABELS[scenario] +
    (spotUnknown ? "" : confirmed ? " (spotbestätigt)" : " (ohne Spot-Bestätigung)");

  return { scenario, label, confirmed, explanation, bias: BIAS[scenario], dataQuality };
}
