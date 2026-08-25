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

export interface MarketContextInput {
  priceChangePct: number | null;
  oiChangePct: number | null;
  spotNetFlowPct: number | null;
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
}

const PRICE_FLAT_THRESHOLD = 0.3;
const OI_FLAT_THRESHOLD = 1.0;
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
}: MarketContextInput): MarketContextResult {
  if (priceChangePct === null || oiChangePct === null) {
    return {
      scenario: null,
      label: "Keine Daten",
      confirmed: null,
      explanation:
        "Noch nicht genug Daten für eine Futures-vs-Spot-Einordnung in diesem Zeitraum.",
      bias: "neutral",
    };
  }

  const priceUp = priceChangePct > PRICE_FLAT_THRESHOLD;
  const priceDown = priceChangePct < -PRICE_FLAT_THRESHOLD;
  const oiUp = oiChangePct > OI_FLAT_THRESHOLD;
  const oiDown = oiChangePct < -OI_FLAT_THRESHOLD;

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

  return { scenario, label, confirmed, explanation, bias: BIAS[scenario] };
}
