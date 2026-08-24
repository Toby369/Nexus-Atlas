import type { PromptProfile } from "./types";

// Prompt Profiles liegen zentral hier statt in einzelnen UI-Komponenten.
// Aendert sich ein Analyse-Prompt, wird NUR diese Datei angepasst – keine
// Dashboard-Kachel muss dafuer angefasst werden.
//
// Aktuell nutzt NOCH KEINE Kachel diese Profiles produktiv (die
// Markteinschaetzungs-Box laeuft weiterhin regelbasiert, siehe
// supabase/functions/collect-btc). Das ist Absicht: das Fundament wird
// vorbereitet, ohne die bestehende, funktionierende Analyse zu ersetzen.

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
  },
};

export function getPromptProfile(id: string): PromptProfile {
  const profile = promptProfiles[id];
  if (!profile) {
    throw new Error(`Unbekanntes Prompt Profile: ${id}`);
  }
  return profile;
}
