import type { TileAIConfig } from "./types";

// Zuordnung Kachel -> AI Provider/Modell/Prompt Profile. Liegt zentral hier,
// NICHT hart im Frontend verdrahtet. Aendert sich die gewuenschte
// Provider-Zuordnung, wird NUR diese Datei angepasst.
//
// "auto" laesst den Router anhand der promptProfile-Kategorie entscheiden
// (siehe router.ts / AUTO_CATEGORY_PROVIDER). Ein expliziter aiProvider
// erzwingt einen bestimmten Anbieter.
//
// Die meisten Eintraege hier sind weiterhin vorbereitete Konfiguration ohne
// UI-Anbindung (die jeweilige Kachel bleibt regelbasiert). "handelslage" ist
// seit Umsetzungsplan Phase 3 (05.09.2026) die erste tatsaechlich produktiv
// aufgerufene -- siehe app/api/handelslage/generate/route.ts.
//
// Anthropic wurde am 15.09.2026 aus JEDER Kette hier entfernt (Nutzer-
// Bedingung: die App soll durchgehend kostenlos bleiben -- Anthropic ist
// kostenpflichtig, kein Gratis-Tier). Live-Vorfall, der das aufgedeckt hat:
// bei der Gesamteinschaetzung-Zusammenfassung fiel Google aus (503), OpenAI
// war nicht konfiguriert, wodurch der Fallback beim bezahlten Anthropic
// landete -- und sogar noch Kosten verursachte, obwohl der Call am Ende
// scheiterte. Konsequenz dieser Entscheidung: faellt die kostenlose
// Provider-Kette einer Kachel komplett aus, schlaegt sie jetzt fehl statt
// eines bezahlten Fallbacks -- bewusst in Kauf genommen.

export const tileConfigs: Record<string, TileAIConfig> = {
  "open-interest": {
    tileId: "open-interest",
    aiProvider: "auto", // -> xai (market-mechanics), siehe Rollen-Doku
    promptProfile: "oi-analysis",
    fallbackProviders: ["google"],
  },
  funding: {
    tileId: "funding",
    aiProvider: "auto",
    promptProfile: "funding-analysis",
    fallbackProviders: ["google"],
  },
  liquidations: {
    tileId: "liquidations",
    aiProvider: "auto",
    promptProfile: "liquidation-analysis",
    fallbackProviders: ["google"],
  },
  "market-structure": {
    tileId: "market-structure",
    aiProvider: "auto",
    promptProfile: "market-structure",
    fallbackProviders: ["google"],
  },
  // Primaerprovider 22.09.2026 von "auto" (-> perplexity, "research"-
  // Kategorie) auf explizit Google umgestellt: Perplexity ist nie
  // konfiguriert -- kein PERPLEXITY_API_KEY gesetzt, faellt also als
  // Primaerprovider immer sofort durch (kein Netzwerk-Call, keine Kosten,
  // aber irrefuehrende Konfiguration -- sah kostenpflichtig aus, obwohl nie
  // aufgerufen). buildNewsAnalysisContext() liefert ausschliesslich bereits
  // von Nexus gesammelte Schlagzeilen aus news_events (keine Live-Web-
  // Suche), Google leistet dieselbe Einordnungsaufgabe direkt, keine echte
  // Faehigkeit geht verloren. Fallback-Kette 16.09.2026 um Groq ergaenzt
  // (Live-Vorfall: Google fiel zusaetzlich mit HTTP 503 aus, die Kachel
  // hatte dadurch de facto GAR KEINEN funktionierenden Fallback).
  news: {
    tileId: "news",
    aiProvider: "google",
    promptProfile: "news-analysis",
    fallbackProviders: ["groq"],
  },
  macro: {
    tileId: "macro",
    aiProvider: "auto",
    promptProfile: "macro-analysis",
    fallbackProviders: ["google"],
  },
  "etf-flows": {
    tileId: "etf-flows",
    aiProvider: "auto",
    promptProfile: "etf-analysis",
    fallbackProviders: ["google"],
  },
  "ai-market-analysis": {
    tileId: "ai-market-analysis",
    aiProvider: "auto", // -> openai (orchestration)
    promptProfile: "market-intelligence",
    fallbackProviders: ["google"],
  },
  "signal-engine": {
    tileId: "signal-engine",
    aiProvider: "auto", // -> google (signal-logic)
    promptProfile: "signal-analysis",
    fallbackProviders: ["openrouter", "deepseek"],
  },
  // Umsetzungsplan Phase 3 (05.09.2026): erste tatsaechlich aus der UI
  // aufgerufene Kachel dieser Konfiguration (siehe app/api/handelslage/
  // generate/route.ts) -- Provider-Aufloesung/Fallback-Kette waren zuvor
  // nur ueber runReportAnalysis() (report_configs-Slots) im produktiven
  // Einsatz, hier zum ersten Mal ueber runTileAnalysis()/"auto".
  // OpenAI-Fallback am 16.09.2026 entfernt (Nutzer-Bedingung "kostenlos" --
  // OpenAI ist ebenfalls kostenpflichtig, kein Gratis-Tier, und war zudem
  // ohnehin nie konfiguriert/kein OPENAI_API_KEY gesetzt, also bisher nur
  // ein toter Fallback ohne echte Wirkung). Kein Ersatzprovider ergaenzt --
  // Google primaer deckt signal-logic bereits ab, und bei einem Totalausfall
  // beider Kacheln greift bewusst die "schlaegt fehl statt bezahltem
  // Fallback"-Linie von Anthropic oben.
  handelslage: {
    tileId: "handelslage",
    aiProvider: "auto", // -> google (signal-logic)
    promptProfile: "handelslage",
    fallbackProviders: [],
  },
  // System-Briefing (Umsetzungsplan Phase 4, 18.09.2026; erweitert
  // 22.09.2026 -- deckt seither auch den Umfang des entfernten
  // "market-state-narrative"-Profils mit ab, siehe promptProfiles.ts) --
  // gleiche Provider-Kette wie handelslage (signal-logic-Kategorie, google
  // primaer, kein bezahlter Fallback).
  "system-briefing": {
    tileId: "system-briefing",
    aiProvider: "auto",
    promptProfile: "system-briefing",
    fallbackProviders: [],
  },
  // Eskalations-Kachel ("gezielte Eskalation", 05.09.2026): aiProvider hier
  // ist nur ein Platzhalter -- app/api/escalation/generate/route.ts ruft
  // runTileAnalysis() mehrfach mit explizitem providerOverride auf (je ein
  // konfigurierter, unabhaengiger Provider). Bewusst KEINE fallbackProviders:
  // faellt einer der drei Provider aus, soll er als fehlgeschlagen gelten
  // statt durch einen anderen Vendor ersetzt zu werden -- sonst waere die
  // "unabhaengige dritte Meinung" heimlich eine zweite Meinung desselben
  // Vendors wie ein anderer Ensemble-Slot. aiProvider hier selbst spielt
  // keine Rolle (wird von den providerOverride-Aufrufen ueberschrieben),
  // aber kostenlos gehalten fuer den Fall, dass er doch mal direkt griffe.
  escalation: {
    tileId: "escalation",
    aiProvider: "groq",
    promptProfile: "escalation-analysis",
    fallbackProviders: [],
  },
  // Trade-Debate-Kachel (Nutzer-Idee 07.09.2026): app/api/trade-debate/
  // generate/route.ts ruft Bull und Bear mit je eigenem, ABSICHTLICH
  // unterschiedlichem primaeren Vendor auf (kein gemeinsamer Modell-Bias
  // in beiden "Seiten" der Debatte), danach den Referee mit beiden
  // Ergebnissen im Kontext. Anders als bei "escalation" MIT
  // fallbackProviders -- hier soll ein einzelner Provider-Ausfall nicht
  // gleich die ganze Debatte platzen lassen (es gibt nur 2 Analysten, kein
  // Ensemble mit Redundanz).
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
  // Referee-Provider (Nutzer-Entscheidung 08.09.2026, "ich moechte
  // kostenlos"): Anthropic (kostenpflichtig, kein Gratis-Tier) durch Groq
  // ersetzt -- erwartetes Modell GROQ_MODEL="openai/gpt-oss-120b" (Groq
  // Free-Tier, kein Kreditkarten-Zwang). Laut Recherche (Artificial-
  // Analysis-Intelligence-Index, 08.09.2026) klar staerker bei Reasoning/
  // Mathe als Mistral Small (Index 24 vs. 15-20) und ein von Bull (Google)
  // und Bear (OpenRouter) unabhaengiger dritter Vendor -- kein Modell-Bias
  // mit einer der beiden Debatten-Seiten. Fallback-Kette bewusst OHNE
  // Anthropic: die ganze Trade-Debate-Kachel soll durchgehend kostenlos
  // bleiben, auch im Fallback-Fall.
  "trade-debate-referee": {
    tileId: "trade-debate-referee",
    aiProvider: "groq",
    promptProfile: "trade-referee",
    fallbackProviders: ["google", "openrouter"],
  },
  // Periodischer KI-Rueckblick, Phase 3 (10.09.2026): liest ausschliesslich
  // signal_stats_results (Phase 2), kein eigener Bias -- gleiche
  // Provider-/Fallback-Logik wie "signal-engine" (ebenfalls ein "zweites
  // Paar Augen" auf bereits berechnete Zahlen, kein neues Handelssignal).
  // Wird woechentlich vom signal-review-scheduler-Cron ausgeloest, nicht
  // manuell.
  "signal-review": {
    tileId: "signal-review",
    aiProvider: "auto", // -> google (signal-logic)
    promptProfile: "signal-review",
    fallbackProviders: ["openrouter", "deepseek"],
  },
  // Freie-Anfrage-Kachel (Nutzer-Wunsch 08.09.2026): wie angekuendigt
  // Google primaer, OpenRouter/Groq als Fallback -- komplett kostenlose
  // Kette, gleiche Haltung wie Trade-Debate-Referee.
  "custom-query": {
    tileId: "custom-query",
    aiProvider: "google",
    promptProfile: "custom-query",
    fallbackProviders: ["openrouter", "groq"],
  },
  // YouTube-Gesamtanalyse (Nutzer-Wunsch 14.09.2026): gleiche komplett
  // kostenlose Kette wie custom-query/trade-debate-referee.
  "youtube-overall-analysis": {
    tileId: "youtube-overall-analysis",
    aiProvider: "google",
    promptProfile: "youtube-overall-analysis",
    fallbackProviders: ["openrouter", "groq"],
  },
};

// Provider-Ensemble fuer die Eskalations-Kachel -- unabhaengige Vendors,
// bewusst ohne Perplexity (Web-Suche wuerde hier externe, nicht im Kontext
// enthaltene Informationen einbringen statt einer unabhaengigen Lesart
// DERSELBEN Daten). OpenRouter als viertes Mitglied ergaenzt (Nutzer-Wunsch
// 07.09.2026) -- computeEscalationConsensus()/die "min. 2 Reads"-Schwelle in
// der Route sind unabhaengig von der Ensemble-Groesse, keine Anpassung dort
// noetig. Anthropic am 15.09.2026 durch Groq ersetzt (Nutzer-Bedingung
// "kostenlos") -- gleicher Tausch wie bei trade-debate-referee, weiterhin
// ein von Google/Mistral/OpenRouter unabhaengiger vierter Vendor.
export const ESCALATION_PROVIDER_ENSEMBLE = ["groq", "google", "mistral", "openrouter"] as const;

export function getTileConfig(tileId: string): TileAIConfig {
  const config = tileConfigs[tileId];
  if (!config) {
    throw new Error(`Keine AI-Konfiguration fuer Kachel: ${tileId}`);
  }
  return config;
}
