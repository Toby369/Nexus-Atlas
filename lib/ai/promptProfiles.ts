import type { PromptProfile } from "./types";

// Prompt Profiles liegen zentral hier statt in einzelnen UI-Komponenten.
// Aendert sich ein Analyse-Prompt, wird NUR diese Datei angepasst – keine
// Dashboard-Kachel muss dafuer angefasst werden.
//
// Aktuell nutzt NOCH KEINE Kachel diese Profiles produktiv (die
// Markteinschaetzungs-Box laeuft weiterhin regelbasiert, siehe
// supabase/functions/collect-btc). Das ist Absicht: das Fundament wird
// vorbereitet, ohne die bestehende, funktionierende Analyse zu ersetzen.

// --- Validierungs-Bausteine ------------------------------------------------
// Jedes Profile beschreibt sein JSON-Schema im systemPrompt (Freitext fuers
// Modell) UND in validate() (maschinelle Pruefung der Antwort). Ein Modell,
// das zwar valides JSON aber die falsche Form liefert (z.B. "bias": "up"
// statt "bullish"), ist fuer die Kachel unbrauchbar -- der Router behandelt
// eine fehlgeschlagene Validierung daher wie einen Provider-Fehler und
// wechselt zum naechsten Fallback.

function field(data: unknown, key: string): unknown {
  return typeof data === "object" && data !== null
    ? (data as Record<string, unknown>)[key]
    : undefined;
}

function isEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isConfidence(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 100;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

const BIAS_3 = ["bullish", "bearish", "neutral"] as const;
const RISK_ON_OFF = ["risk-on", "risk-off", "neutral"] as const;
const RISK_LEVELS = ["low", "medium", "high"] as const;
const IMPACT_LEVELS = ["high", "medium", "low"] as const;

// Deckt das in oi-/funding-/liquidation-/market-structure-/macro-/etf-/
// market-intelligence-Analysis wiederkehrende { bias, confidence, summary,
// [keyFactors], [riskLevel] }-Schema ab, mit austauschbarem Bias-Feldnamen
// und -Wertebereich (z.B. "overallBias" oder risk-on/risk-off).
function validateBiasSummary(
  data: unknown,
  opts: {
    biasField?: string;
    biasValues?: readonly string[];
    requireKeyFactors?: boolean;
    requireRiskLevel?: boolean;
  } = {}
): string[] {
  const errors: string[] = [];
  const biasField = opts.biasField ?? "bias";
  const biasValues = opts.biasValues ?? BIAS_3;

  const bias = field(data, biasField);
  if (!isEnum(bias, biasValues)) {
    errors.push(
      `"${biasField}" muss einer von [${biasValues.join(", ")}] sein, war: ${JSON.stringify(bias)}`
    );
  }

  if (!isConfidence(field(data, "confidence"))) {
    errors.push(`"confidence" muss eine Zahl zwischen 0 und 100 sein.`);
  }

  if (!isNonEmptyString(field(data, "summary"))) {
    errors.push(`"summary" muss ein nicht-leerer String sein.`);
  }

  if (opts.requireKeyFactors && !isStringArray(field(data, "keyFactors"))) {
    errors.push(`"keyFactors" muss ein String-Array sein.`);
  }

  if (opts.requireRiskLevel && !isEnum(field(data, "riskLevel"), RISK_LEVELS)) {
    errors.push(`"riskLevel" muss einer von [${RISK_LEVELS.join(", ")}] sein.`);
  }

  return errors;
}

function validateNewsAnalysis(data: unknown): string[] {
  const errors: string[] = [];
  const items = field(data, "items");

  if (!Array.isArray(items)) {
    errors.push(`"items" muss ein Array sein.`);
  } else {
    items.forEach((item, i) => {
      if (!isNonEmptyString(field(item, "headline"))) {
        errors.push(`items[${i}].headline muss ein nicht-leerer String sein.`);
      }
      if (!isEnum(field(item, "impact"), IMPACT_LEVELS)) {
        errors.push(`items[${i}].impact muss einer von [${IMPACT_LEVELS.join(", ")}] sein.`);
      }
      if (!isNonEmptyString(field(item, "reasoning"))) {
        errors.push(`items[${i}].reasoning muss ein nicht-leerer String sein.`);
      }
    });
  }

  if (!isNonEmptyString(field(data, "summary"))) {
    errors.push(`"summary" muss ein nicht-leerer String sein.`);
  }

  return errors;
}

function validateSignalAnalysis(data: unknown): string[] {
  const errors: string[] = [];

  if (typeof field(data, "isConsistent") !== "boolean") {
    errors.push(`"isConsistent" muss ein boolean sein.`);
  }
  if (!isConfidence(field(data, "confidence"))) {
    errors.push(`"confidence" muss eine Zahl zwischen 0 und 100 sein.`);
  }
  if (!isNonEmptyString(field(data, "summary"))) {
    errors.push(`"summary" muss ein nicht-leerer String sein.`);
  }
  if (!isStringArray(field(data, "concerns"))) {
    errors.push(`"concerns" muss ein String-Array sein.`);
  }

  return errors;
}

export const promptProfiles: Record<string, PromptProfile> = {
  "oi-analysis": {
    id: "oi-analysis",
    category: "market-mechanics",
    description: "Interpretation von Open-Interest-Bewegungen relativ zu Preis und Funding.",
    systemPrompt:
      "Du analysierst Open-Interest-Daten fuer BTC/USDT Perpetual Futures. " +
      "Ordne die OI-Bewegung im Verhaeltnis zu Preis und Funding ein (Positionsaufbau, " +
      "-abbau, Short-Covering, Long-Liquidation). Formuliere Wahrscheinlichkeiten, keine " +
      "Fakten. Antworte als JSON mit den Feldern: bias (bullish|bearish|neutral), " +
      "confidence (0-100), summary (string, deutsch), keyFactors (string[]).",
    validate: (data) => validateBiasSummary(data, { requireKeyFactors: true }),
  },
  "funding-analysis": {
    id: "funding-analysis",
    category: "market-mechanics",
    description: "Einordnung der Funding-Rate-Situation und was sie fuer Positionierung bedeutet.",
    systemPrompt:
      "Du analysierst die Funding Rate von BTC/USDT Perpetual Futures ueber mehrere " +
      "Boersen hinweg. Ordne ein, ob der Markt eher long- oder short-lastig positioniert " +
      "ist und ob Abweichungen zwischen Boersen auffaellig sind. Antworte als JSON mit: " +
      "bias (bullish|bearish|neutral), confidence (0-100), summary (string, deutsch), " +
      "keyFactors (string[]).",
    validate: (data) => validateBiasSummary(data, { requireKeyFactors: true }),
  },
  "liquidation-analysis": {
    id: "liquidation-analysis",
    category: "market-mechanics",
    description: "Einordnung von Liquidationsereignissen (Groesse, Richtung, Haeufung).",
    systemPrompt:
      "Du analysierst BTC-Futures-Liquidationsdaten. Ordne ein, ob es sich um vereinzelte " +
      "Liquidationen oder eine Haeufung (Cascade) handelt und in welche Richtung " +
      "(Long/Short) sie ueberwiegen. Antworte als JSON mit: bias (bullish|bearish|neutral), " +
      "confidence (0-100), summary (string, deutsch), keyFactors (string[]).",
    validate: (data) => validateBiasSummary(data, { requireKeyFactors: true }),
  },
  "market-structure": {
    id: "market-structure",
    category: "market-mechanics",
    description: "Gesamtbild aus Preis, OI, Funding und Liquidationen ueber mehrere Boersen.",
    systemPrompt:
      "Du fasst die aktuelle BTC-Futures-Marktstruktur zusammen (Preis, Open Interest, " +
      "Funding, Liquidationen, Multi-Exchange-Vergleich). Antworte als JSON mit: " +
      "bias (bullish|bearish|neutral), confidence (0-100), summary (string, deutsch), " +
      "keyFactors (string[]), riskLevel (low|medium|high).",
    validate: (data) =>
      validateBiasSummary(data, { requireKeyFactors: true, requireRiskLevel: true }),
  },
  "news-analysis": {
    id: "news-analysis",
    category: "research",
    description: "Filterung und Einordnung marktbewegender News (nicht: kompletter Feed).",
    systemPrompt:
      "Du filterst Nachrichten auf Relevanz fuer BTC/USDT Futures. Nur markbewegende, " +
      "BTC-relevante, Futures-relevante oder makrooekonomisch relevante Ereignisse zaehlen. " +
      "Antworte als JSON mit: items (Array aus { headline, impact: high|medium|low, " +
      "reasoning }), summary (string, deutsch).",
    validate: validateNewsAnalysis,
  },
  "macro-analysis": {
    id: "macro-analysis",
    category: "research",
    description: "Fed, CPI, ETF-Flows und geopolitische Faktoren mit BTC-Relevanz.",
    systemPrompt:
      "Du bewertest makrooekonomische Faktoren (Fed-Politik, CPI, ETF-Flows, Geopolitik) " +
      "auf ihre Relevanz fuer den BTC-Markt. Antworte als JSON mit: bias " +
      "(risk-on|risk-off|neutral), confidence (0-100), summary (string, deutsch), " +
      "keyFactors (string[]).",
    validate: (data) =>
      validateBiasSummary(data, { biasValues: RISK_ON_OFF, requireKeyFactors: true }),
  },
  "etf-analysis": {
    id: "etf-analysis",
    category: "research",
    description: "Einordnung von BTC-ETF-Zu-/Abfluessen.",
    systemPrompt:
      "Du analysierst BTC-ETF-Flow-Daten. Ordne ein, ob Zufluesse oder Abfluesse " +
      "ueberwiegen und was das fuer institutionelle Nachfrage bedeuten koennte. Antworte " +
      "als JSON mit: bias (bullish|bearish|neutral), confidence (0-100), summary (string, " +
      "deutsch).",
    validate: (data) => validateBiasSummary(data),
  },
  "market-intelligence": {
    id: "market-intelligence",
    category: "orchestration",
    description: "Gesamtbewertung, die mehrere Einzelanalysen zusammenfuehrt.",
    systemPrompt:
      "Du fuehrst mehrere Einzelanalysen (Marktstruktur, News, Makro) zu einer " +
      "Gesamtbewertung fuer BTC/USDT Futures zusammen. Antworte als JSON mit: " +
      "overallBias (bullish|bearish|neutral), confidence (0-100), summary (string, " +
      "deutsch), riskLevel (low|medium|high).",
    validate: (data) =>
      validateBiasSummary(data, { biasField: "overallBias", requireRiskLevel: true }),
  },
  "signal-analysis": {
    id: "signal-analysis",
    category: "signal-logic",
    description: "Logik-/Konsistenzpruefung eines abgeleiteten Trading-Signals.",
    systemPrompt:
      "Du prueffst ein abgeleitetes Trading-Signal auf logische Konsistenz mit den " +
      "zugrunde liegenden Daten (Preis, OI, Funding). Antworte als JSON mit: " +
      "isConsistent (boolean), confidence (0-100), summary (string, deutsch), " +
      "concerns (string[]).",
    validate: validateSignalAnalysis,
  },
};

export function getPromptProfile(id: string): PromptProfile {
  const profile = promptProfiles[id];
  if (!profile) {
    throw new Error(`Unbekanntes Prompt Profile: ${id}`);
  }
  return profile;
}
