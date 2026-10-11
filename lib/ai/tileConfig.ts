import type { TileAIConfig } from "./types";

// Zuordnung Kachel -> AI Provider/Modell/Prompt Profile. Liegt zentral hier,
// NICHT hart im Frontend verdrahtet. Aendert sich die gewuenschte
// Provider-Zuordnung, wird NUR diese Datei angepasst.
//
// "auto" laesst den Router anhand der promptProfile-Kategorie entscheiden
// (siehe router.ts / AUTO_CATEGORY_PROVIDER). Ein expliziter aiProvider
// erzwingt einen bestimmten Anbieter.
//
// Alle Eintraege sind produktiv angebunden (nie genutzte Profile wurden
// entfernt).
//
// Anthropic steht in KEINER Kette: die App soll durchgehend kostenlos
// bleiben (Anthropic hat kein Gratis-Tier). Ein frueherer Fallback landete
// bei einem Google-503 beim bezahlten Anthropic und verursachte Kosten, obwohl
// der Aufruf scheiterte. Faellt die kostenlose Kette einer Kachel komplett
// aus, schlaegt sie deshalb fehl statt bezahlt auszuweichen -- bewusst.
// eines bezahlten Fallbacks -- bewusst in Kauf genommen.

export const tileConfigs: Record<string, TileAIConfig> = {
  // Explizit Google statt "auto" (-> Perplexity, nie konfiguriert):
  // buildNewsAnalysisContext() liefert nur bereits gesammelte Schlagzeilen
  // (keine Live-Web-Suche), Google leistet dieselbe Einordnung. Groq als
  // Fallback, damit ein Google-503 die Kachel nicht lahmlegt.
  news: {
    tileId: "news",
    aiProvider: "google",
    promptProfile: "news-analysis",
    fallbackProviders: ["groq"],
  },
  // System-Briefing (siehe promptProfiles.ts/systemBriefingContext.ts):
  // deckt auch Handelslage und den Konsistenz-Check der frueheren Signal
  // Engine ab. Strukturell vier Teil-Aufrufe (siehe Kopfkommentar in
  // promptProfiles.ts); kostenloser Fallback je Teil, kein bezahlter
  // Provider (siehe Anthropic-Linie oben).
  //
  // Verteilung der Teil-Aufrufe -- Lehren aus Live-Vorfaellen:
  // - Alle vier per "auto" auf Google vervierfachten den Quota-Verbrauch;
  //   die Gratis-Tagesquota EINES Gemini-Modells kann projektweit
  //   ausgeschoepft sein, waehrend andere Gemini-Modelle frei sind. Daher
  //   Modell-Overrides je Teil (aiModel) statt nur GOOGLE_MODEL.
  // - Nur Modelle verwenden, die live funktionierten ("gemini-3.7-flash",
  //   "gemini-3.8-flash"); aeltere 2.5-Modelle liefern HTTP 404 (fuer neue
  //   Nutzer abgeschaltet).
  // - Verschiedene Gemini-Modelle teilen sich trotzdem ein Projekt-Limit
  //   (RPM/Concurrency): drei parallele Google-Aufrufe fuehrten zu 429 und
  //   stummen 20s-Timeouts. Deshalb laufen die DREI PARALLELEN Teil-Aufrufe
  //   auf drei verschiedenen Vendors (Regelwerk=Google, Chart=Groq,
  //   Trigger=Mistral); die Synthese laeuft danach sequenziell auf Google.
  "system-briefing-regelwerk": {
    tileId: "system-briefing-regelwerk",
    aiProvider: "google",
    aiModel: "gemini-3.7-flash",
    promptProfile: "system-briefing-regelwerk",
    fallbackProviders: ["openrouter", "deepseek"],
  },
  "system-briefing-chart": {
    tileId: "system-briefing-chart",
    aiProvider: "groq",
    promptProfile: "system-briefing-chart",
    fallbackProviders: ["google", "openrouter"],
  },
  // Trigger primaer auf Mistral (statt OpenRouter): OpenRouter hing bei
  // dieser Kachel reproduzierbar bis zum 20s-Zeitlimit ohne Antwort --
  // vermutlich ein stiller Moderations-Haenger bei Kursziel-Szenarien
  // (derselbe Inhalt loeste dort schon eine "Unauthorized Advice"-
  // Verweigerung aus, siehe promptProfiles.ts). OpenRouter ist daher GANZ
  // aus dieser Kette entfernt (bei Regelwerk/Chart weiterhin Fallback);
  // Fallback Groq -> Google.
  "system-briefing-trigger": {
    tileId: "system-briefing-trigger",
    aiProvider: "mistral",
    promptProfile: "system-briefing-trigger",
    fallbackProviders: ["groq", "google"],
  },
  "system-briefing-synthese": {
    tileId: "system-briefing-synthese",
    aiProvider: "google",
    aiModel: "gemini-3.7-flash",
    promptProfile: "system-briefing-synthese",
    fallbackProviders: ["openrouter", "deepseek"],
  },
  // Eskalation: aiProvider ist nur ein Platzhalter --
  // app/api/escalation/generate/route.ts ruft runTileAnalysis() mehrfach mit
  // explizitem providerOverride auf (je ein unabhaengiger Provider). Bewusst
  // KEINE fallbackProviders: ein ausgefallener Provider gilt als
  // fehlgeschlagen, sonst waere die "unabhaengige" Meinung heimlich eine
  // zweite Meinung desselben Vendors. Kostenlos gehalten, falls er doch
  // direkt griffe.
  escalation: {
    tileId: "escalation",
    aiProvider: "groq",
    promptProfile: "escalation-analysis",
    fallbackProviders: [],
  },
  // Trade-Debate: app/api/trade-debate/generate/route.ts ruft Bull und Bear
  // mit ABSICHTLICH unterschiedlichem primaeren Vendor auf (kein gemeinsamer
  // Modell-Bias), danach den Referee mit beiden Ergebnissen. Anders als bei
  // "escalation" MIT fallbackProviders -- mit nur 2 Analysten soll ein
  // einzelner Ausfall nicht die ganze Debatte platzen lassen.
  "trade-debate-bull": {
    tileId: "trade-debate-bull",
    aiProvider: "google",
    promptProfile: "trade-bull-analyst",
    fallbackProviders: ["openrouter"],
  },
  "trade-debate-bear": {
    tileId: "trade-debate-bear",
    aiProvider: "openrouter",
    promptProfile: "trade-bear-analyst",
    fallbackProviders: ["google"],
  },
  // Referee: Groq (erwartet GROQ_MODEL="openai/gpt-oss-120b", Free-Tier) --
  // stark bei Reasoning/Mathe und ein von Bull (Google) und Bear (OpenRouter)
  // unabhaengiger dritter Vendor. Fallback-Kette bewusst ohne bezahlte
  // Provider.
  "trade-debate-referee": {
    tileId: "trade-debate-referee",
    aiProvider: "groq",
    promptProfile: "trade-referee",
    fallbackProviders: ["google", "openrouter"],
  },
  // Periodischer KI-Rueckblick: liest ausschliesslich signal_stats_results,
  // kein eigener Bias -- ein "zweites Paar Augen" auf bereits berechnete
  // Zahlen. Woechentlich vom signal-review-scheduler-Cron ausgeloest.
  "signal-review": {
    tileId: "signal-review",
    aiProvider: "auto", // -> google (signal-logic)
    promptProfile: "signal-review",
    fallbackProviders: ["openrouter", "deepseek"],
  },
  // Freie Anfrage: Google primaer, OpenRouter/Groq als Fallback --
  // komplett kostenlose Kette.
  "custom-query": {
    tileId: "custom-query",
    aiProvider: "google",
    promptProfile: "custom-query",
    fallbackProviders: ["openrouter", "groq"],
  },
  // YouTube-Gesamtanalyse: gleiche kostenlose Kette wie custom-query.
  "youtube-overall-analysis": {
    tileId: "youtube-overall-analysis",
    aiProvider: "google",
    promptProfile: "youtube-overall-analysis",
    fallbackProviders: ["openrouter", "groq"],
  },
};

// Provider-Ensemble fuer die Eskalation -- vier unabhaengige, kostenlose
// Vendors, bewusst ohne Perplexity (Web-Suche wuerde externe Informationen
// einbringen statt einer unabhaengigen Lesart DERSELBEN Daten).
// computeEscalationConsensus() und die "min. 2 Reads"-Schwelle sind
// unabhaengig von der Ensemble-Groesse.
export const ESCALATION_PROVIDER_ENSEMBLE = ["groq", "google", "mistral", "openrouter"] as const;

export function getTileConfig(tileId: string): TileAIConfig {
  const config = tileConfigs[tileId];
  if (!config) {
    throw new Error(`Keine AI-Konfiguration fuer Kachel: ${tileId}`);
  }
  return config;
}
