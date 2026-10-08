import type { TileAIConfig } from "./types";

// Zuordnung Kachel -> AI Provider/Modell/Prompt Profile. Liegt zentral hier,
// NICHT hart im Frontend verdrahtet. Aendert sich die gewuenschte
// Provider-Zuordnung, wird NUR diese Datei angepasst.
//
// "auto" laesst den Router anhand der promptProfile-Kategorie entscheiden
// (siehe router.ts / AUTO_CATEGORY_PROVIDER). Ein expliziter aiProvider
// erzwingt einen bestimmten Anbieter.
//
// 06.10.2026 -- Aufraeumung: 7 nie angebundene Eintraege aus der fruehen
// Projektphase entfernt (open-interest/funding/liquidations/market-structure/
// macro/etf-flows/ai-market-analysis, samt ihrer Prompt-Profile in
// promptProfiles.ts) -- keine Kachel/Route rief sie je auf (OI/Funding/
// Liquidationen/ETF-Flows laufen laengst regelbasiert, Marktstruktur/
// "Market Intelligence" sind durch System-Briefing/Chart-Narrativ/
// Master-Report ueberholt). Alle verbleibenden Eintraege sind produktiv
// angebunden.
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
  // System-Briefing (Umsetzungsplan Phase 4, 18.09.2026; erweitert
  // 22.09.2026 -- deckt seither auch den Umfang des entfernten
  // "market-state-narrative"-Profils mit ab, 30.09.2026 zusaetzlich mit der
  // ehemals eigenstaendigen Handelslage-Kachel zusammengelegt, 02.10.2026
  // zusaetzlich mit der ehemals eigenstaendigen Signal-Engine-Kachel
  // (Konsistenz-Check, siehe promptProfiles.ts), siehe promptProfiles.ts/
  // systemBriefingContext.ts) -- signal-logic-Kategorie, google primaer,
  // seit 25.09.2026 kostenloser Fallback (Live-Vorfall: ein echter
  // Google-503-Ausfall, von Toby per Screenshot gemeldet, liess die Kachel
  // zuvor komplett fehlschlagen). Faellt auch dieser komplett aus, greift
  // weiterhin bewusst die "schlaegt fehl statt bezahltem Fallback"-Linie
  // von Anthropic oben, kein dritter (erst recht kein bezahlter) Provider.
  // System-Briefing (08.10.2026 strukturell in vier Teil-Aufrufe aufgeteilt,
  // siehe lib/ai/promptProfiles.ts Kopfkommentar dort) -- alle vier teilen
  // sich dieselbe Provider-Kette wie vorher der eine grosse Aufruf.
  "system-briefing-regelwerk": {
    tileId: "system-briefing-regelwerk",
    aiProvider: "auto",
    promptProfile: "system-briefing-regelwerk",
    fallbackProviders: ["openrouter", "deepseek"],
  },
  "system-briefing-chart": {
    tileId: "system-briefing-chart",
    aiProvider: "auto",
    promptProfile: "system-briefing-chart",
    fallbackProviders: ["openrouter", "deepseek"],
  },
  "system-briefing-trigger": {
    tileId: "system-briefing-trigger",
    aiProvider: "auto",
    promptProfile: "system-briefing-trigger",
    fallbackProviders: ["openrouter", "deepseek"],
  },
  "system-briefing-synthese": {
    tileId: "system-briefing-synthese",
    aiProvider: "auto",
    promptProfile: "system-briefing-synthese",
    fallbackProviders: ["openrouter", "deepseek"],
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
  // signal_stats_results (Phase 2), kein eigener Bias -- ein "zweites Paar
  // Augen" auf bereits berechnete Zahlen, kein neues Handelssignal (gleiche
  // Rolle wie vormals die am 02.10.2026 entfernte Signal-Engine-Kachel,
  // siehe promptProfiles.ts "system-briefing"). Wird woechentlich vom
  // signal-review-scheduler-Cron ausgeloest, nicht manuell.
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
