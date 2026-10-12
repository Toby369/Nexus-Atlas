import type { PromptProfile } from "./types";

// Prompt Profiles liegen zentral hier statt in einzelnen UI-Komponenten.
// Aendert sich ein Analyse-Prompt, wird NUR diese Datei angepasst – keine
// Dashboard-Kachel muss dafür angefasst werden.
//
// Die regelbasierte Gesamteinschaetzung laeuft unabhaengig davon in
// supabase/functions/compute-market-state. Kachel-Profile laufen ueber
// runTileAnalysis().

// --- Validierungs-Bausteine ------------------------------------------------
// Jedes Profile beschreibt sein JSON-Schema im systemPrompt (Freitext fürs
// Modell) UND in validate() (maschinelle Prüfung der Antwort). Ein Modell,
// das zwar valides JSON aber die falsche Form liefert (z.B. "bias": "up"
// statt "bullish"), ist für die Kachel unbrauchbar -- der Router behandelt
// eine fehlgeschlagene Validierung daher wie einen Provider-Fehler und
// wechselt zum nächsten Fallback.

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
const RISK_LEVELS = ["low", "medium", "high"] as const;
const IMPACT_LEVELS = ["high", "medium", "low"] as const;
// Gesamtanalysen ueber mehrere Quellen duerfen zusaetzlich "conflicting"
// melden, statt Widersprueche zu einem falschen "bullish" zu mitteln.
const OVERALL_BIAS = ["bullish", "bearish", "neutral", "conflicting"] as const;

// Einheitliche Zahlen-/Formatierungsregeln für die "summary"/Freitext-Felder
// -- an die Profile angehängt, deren Text direkt im Dashboard angezeigt
// wird, damit AI-Text und die regelbasierten UI-Werte
// (siehe z.B. LivePricePanel.tsx/MarketContextCard.tsx, durchgehend
// toLocaleString("de-CH") bzw. .toFixed()) nicht auseinanderlaufen -- vorher
// gab es dafür keine Vorgabe, wodurch je nach Provider/Modell uneinheitlich
// formatiert wurde (mal Komma, mal Punkt, mal ohne Vorzeichen).
const NUMBER_FORMAT_INSTRUCTION =
  "Formatiere Zahlen in der summary wie im Dashboard: Prozentwerte mit Vorzeichen und einer " +
  "Nachkommastelle (z.B. +1.5%, -0.3%), Punkt als Dezimaltrennzeichen (nie Komma), große " +
  "USD-Beträge gerundet mit Einheit (z.B. $12.3M, $450K) statt ausgeschriebener Nullen.";

// --- System-Briefing: Stil und Klartext-Pruefung --------------------------
// Das Briefing liest sich wie ein BTC-Marktbericht (Vorbild: ein klassischer
// Trading-Newsletter -- Kernsatz zuerst, konkrete Zonen, ganze Saetze). Ein
// Lauf hatte vorher interne Datenfeldnamen ("mein_system_checklist.ema13")
// und englische Statuswerte ("Phase: respecting") woertlich ausgegeben.
const BRIEFING_STYLE_INSTRUCTION =
  "Du schreibst Teile eines taeglichen Bitcoin-Marktberichts fuer einen erfahrenen " +
  "Trader, ausschliesslich zu BTC (keine anderen Coins). Stil: Deutsch mit echten " +
  "Umlauten (ä, ö, ü -- nie 'ae', 'oe', 'ue' als Ersatz), ganze Saetze, " +
  "sachlich und konkret wie ein guter Trading-Newsletter; jeder Text beginnt mit einem " +
  "Kernsatz, der die Aussage allein traegt (die Anzeige setzt ihn fett -- deshalb KEIN " +
  "Markdown, keine Sternchen, keine Aufzaehlungszeichen im Text). Uebliche " +
  "Trader-Begriffe sind erlaubt (VWAP, EMA 200, RSI, Support, Widerstand, Funding, " +
  "Open Interest, Liquidationen, Reclaim). VERBOTEN: interne Datenfeldnamen, " +
  "Variablen oder JSON-Pfade aus dem Kontext (nie 'mein_system_checklist.ema13', " +
  "'dayVwap', 'regimeAllowsGuss', 'TREND_FORMING_BULLISH', 'phase: respecting') -- " +
  "uebersetze sie in Klartext ('EMA 13 auf Tagesbasis', 'Tages-VWAP', 'GUSS sieht " +
  "einen beginnenden Aufwaertstrend', 'die Zone haelt'); keine Vergleichsoperatoren " +
  "wie '>' oder '='. Kurse als ganze USD mit Apostroph als Tausendertrenner (84'300 " +
  "USD), Zonen als Spanne (84'300-84'500 USD), Prozentwerte mit Vorzeichen und einer " +
  "Nachkommastelle mit Punkt (+1.2 %), Volumen gerundet (286 Mio. USD). " +
  "Nutze ausschliesslich die gelieferten Daten, erfinde keine Zahlen. ";

// Freitext-Abschnitte der Synthese, gemeinsam fuer Prompt-Validierung und
// Anzeige (components/SystemBriefingDetails.tsx, lib/systemBriefingNotify.ts).
export const BRIEFING_REPORT_SECTIONS = [
  "schlagzeile",
  "marktupdate",
  "momentum",
  "liquidationen",
  "etfFlows",
  "wirtschaftskalender",
] as const;

const TECHNICAL_IDENTIFIER_PATTERNS: RegExp[] = [
  /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/, // snake_case (mein_system_checklist)
  /\b[A-Z]{2,}_[A-Z0-9_]{2,}\b/, // UPPER_SNAKE (TREND_FORMING_BULLISH)
  /\b[a-z]+[A-Z][a-zA-Z0-9]*\b/, // camelCase (dayVwap, closePrice)
  /\b[A-Za-z_]{3,}\.[A-Za-z_]{3,}\b/, // Pfad (vwapVector.dayVwap)
];

/** Findet interne Feldnamen/Variablen in einem KI-Text (leeres Array = Klartext). */
export function findTechnicalIdentifiers(text: string): string[] {
  const hits = new Set<string>();
  for (const pattern of TECHNICAL_IDENTIFIER_PATTERNS) {
    const global = new RegExp(pattern.source, "g");
    for (const match of text.matchAll(global)) hits.add(match[0]);
  }
  return [...hits];
}

// Validierungsfehler fuer alle Textfelder (String oder String-Array), die
// interne Bezeichner enthalten -- der Router wechselt dann zum naechsten
// Provider, statt den Text so anzuzeigen und zu verschicken.
function technicalIdentifierErrors(data: unknown, keys: readonly string[], prefix = ""): string[] {
  const errors: string[] = [];
  for (const key of keys) {
    const value = field(data, key);
    const texts = typeof value === "string" ? [value] : isStringArray(value) ? value : [];
    const hits = texts.flatMap(findTechnicalIdentifiers);
    if (hits.length > 0) {
      errors.push(`"${prefix}${key}" enthaelt interne Feldnamen statt Klartext: ${hits.slice(0, 3).join(", ")}`);
    }
  }
  return errors;
}

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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

const TRADE_DEBATE_VERDICTS = ["long", "short", "wait"] as const;

// Bull-/Bear-Analyst teilen sich dasselbe Schema, nur der erwartete
// bias-Wert unterscheidet sich (fix "long" bzw. fix "short" -- kein
// Enum, jedes Profile hat nur EINEN gueltigen Wert).
function validateTradeDebateAnalyst(data: unknown, expectedBias: "long" | "short"): string[] {
  const errors: string[] = [];
  if (field(data, "bias") !== expectedBias) {
    errors.push(`"bias" muss "${expectedBias}" sein, war: ${JSON.stringify(field(data, "bias"))}`);
  }
  if (!isFiniteNumber(field(data, "entry_price"))) {
    errors.push(`"entry_price" muss eine Zahl sein.`);
  }
  if (!isFiniteNumber(field(data, "invalidation_price"))) {
    errors.push(`"invalidation_price" muss eine Zahl sein.`);
  }
  if (!isFiniteNumber(field(data, "target_price"))) {
    errors.push(`"target_price" muss eine Zahl sein.`);
  }
  if (!isFiniteNumber(field(data, "risk_reward"))) {
    errors.push(`"risk_reward" muss eine Zahl sein.`);
  }
  if (!isConfidence(field(data, "confidence"))) {
    errors.push(`"confidence" muss eine Zahl zwischen 0 und 100 sein.`);
  }
  if (!isNonEmptyString(field(data, "reasoning"))) {
    errors.push(`"reasoning" muss ein nicht-leerer String sein.`);
  }
  return errors;
}

function validateTradeReferee(data: unknown): string[] {
  const errors: string[] = [];
  if (!isEnum(field(data, "verdict"), TRADE_DEBATE_VERDICTS)) {
    errors.push(`"verdict" muss einer von [${TRADE_DEBATE_VERDICTS.join(", ")}] sein.`);
  }
  if (typeof field(data, "divergence_detected") !== "boolean") {
    errors.push(`"divergence_detected" muss ein Boolean sein.`);
  }
  if (!isNonEmptyString(field(data, "synthesis"))) {
    errors.push(`"synthesis" muss ein nicht-leerer String sein.`);
  }
  if (!isNullableFiniteNumber(field(data, "invalidation_level"))) {
    errors.push(`"invalidation_level" muss eine Zahl oder null sein.`);
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

// YouTube-Gesamtanalyse -- gleiche Philosophie wie frueher der Master-Report: NICHT
// die Einzelvideos zu einem Bias mitteln, sondern Widersprueche zwischen
// Kanaelen/Videos explizit benennen. Die Anzahl der Quellen ist variabel,
// daher kein componentBiases-Objekt, sondern "conflicts" als Freitext-Liste
// mit konkreten Kanalnamen.
function validateYoutubeOverallAnalysis(data: unknown): string[] {
  const errors: string[] = [];

  const overallBias = field(data, "overallBias");
  if (!isEnum(overallBias, OVERALL_BIAS)) {
    errors.push(
      `"overallBias" muss einer von [${OVERALL_BIAS.join(", ")}] sein, war: ${JSON.stringify(overallBias)}`
    );
  }
  if (!isConfidence(field(data, "confidence"))) {
    errors.push(`"confidence" muss eine Zahl zwischen 0 und 100 sein.`);
  }
  if (!isNonEmptyString(field(data, "summary"))) {
    errors.push(`"summary" muss ein nicht-leerer String sein.`);
  }
  if (!isStringArray(field(data, "conflicts"))) {
    errors.push(`"conflicts" muss ein String-Array sein (leeres Array, wenn keine Widersprüche).`);
  }

  return errors;
}

export const promptProfiles: Record<string, PromptProfile> = {
  "news-analysis": {
    id: "news-analysis",
    category: "research",
    description:
      "Einordnung/Kontext zu bereits regelbasiert gefilterten markbewegenden News (nicht: kompletter Feed, nicht: Neu-Filterung).",
    systemPrompt:
      "Du bekommst eine Liste von Nachrichten, die Nexus bereits regelbasiert (Kategorie/" +
      "Keyword-Score) als markbewegend fuer BTC/USDT Futures eingestuft hat. Deine Aufgabe " +
      "ist NICHT, erneut zu filtern, sondern jede Meldung inhaltlich einzuordnen: was ist " +
      "die wahrscheinliche Wirkung auf den BTC-Markt und warum -- nutze dabei dein Wissen " +
      "bzw. deine Recherchefaehigkeit, um Kontext zu ergaenzen, den die reine Schlagzeile " +
      "nicht zeigt. Erfinde KEINE zusaetzlichen Nachrichten ausserhalb der gegebenen Liste " +
      "-- ein Modell ohne Live-Zugriff auf aktuelle Ereignisse darf hier nichts aus "+
      "eigenem, moeglicherweise veraltetem Wissen dazuerfinden. " +
      NUMBER_FORMAT_INSTRUCTION +
      " Antworte als JSON mit: items (Array aus { headline, impact: high|medium|low, " +
      "reasoning }), summary (string, deutsch, 2-3 Saetze Gesamtbild).",
    validate: validateNewsAnalysis,
  },
  // --- Periodischer KI-Rueckblick ------------------------------------------
  // Liest AUSSCHLIESSLICH bereits berechnete Zahlen (compute_signal_stats(),
  // signal_stats_results; Kontext aus lib/signalReviewContext.ts) -- kein
  // eigener Bias, kein Handelssignal, keine eigene Statistik. Aufgabe: eine
  // verstaendliche deutsche Einordnung, welche Signale genug Stichprobe
  // haben, die BH-FDR-Korrektur ueberstehen, verfallen (decay_flag) oder
  // "zu wenig Daten" bleiben. Woechentlich vom signal-review-scheduler-Cron.
  "signal-review": {
    id: "signal-review",
    category: "signal-logic",
    description:
      "Verstaendliche Einordnung des periodischen KI-Rueckblicks (signal_stats_results) -- welche Signale robust/fragil/verfallend/zu duenn belegt sind. Kein eigener Bias, kein Handelssignal.",
    systemPrompt:
      "Du bekommst eine Liste von Zellen aus dem periodischen KI-Rueckblick von Nexus Atlas: " +
      "je Zelle ein bereits gefeuertes Signal aus einer der erfassten Signal-Gruppen " +
      "(z.B. TradingView-Alert, Warn-Muster, Risk-Faktor oder Kern-Engine-Zustand -- die " +
      "genaue Liste der Gruppen kann sich erweitern, category/signal_type im Kontext nennen " +
      "die jeweils aktuelle) " +
      "x Horizont, ausgewertet in zwei Fenstern (window_90d = rollierende letzte 90 Tage, " +
      "window_all = gesamte Historie). Jede Zelle enthaelt bereits fertig berechnete Zahlen: " +
      "n (Stichprobengroesse), bei gerichteten Signalen hit_rate_pct vs. baseline_hit_rate_pct " +
      "(unbedingte Basiswahrscheinlichkeit), bei richtungslosen Risk-Faktoren " +
      "avg_abs_return_pct vs. baseline_avg_abs_return_pct, sowie raw_p_value und " +
      "significant_after_bh (true nur wenn die Zelle die Benjamini-Hochberg-Mehrfachvergleichs-" +
      "Korrektur UEBERSTEHT). decay_flag (true/false/null) vergleicht denselben Edge zwischen " +
      "90d- und Gesamtfenster -- null heisst, kein belastbarer Vergleich moeglich (zu wenig " +
      "Stichprobe in einem der Fenster). Ausserdem: total_cells, cells_with_min_sample, " +
      "significant_cells, insufficient_data_cells, decaying_cells als Gesamtuebersicht. " +
      "DEINE AUFGABE ist ausschliesslich, diese bereits berechneten Zahlen verstaendlich " +
      "einzuordnen -- NICHT selbst eine neue Statistik zu berechnen, NICHT selbst zu " +
      "entscheiden, ob ein p-Wert 'eigentlich' signifikant ist (significant_after_bh ist die " +
      "einzige gueltige Signifikanz-Aussage), und NICHT eine Markt-/Handelsrichtung abzuleiten " +
      "(das ist keine Trading-Kachel). Bewerte dabei die Regel-Treue der Statistik selbst (Welz-" +
      "Prinzip 'Prozess statt Ergebnis'), nicht einzelne auffaellige Zahlen isoliert -- eine " +
      "hohe Trefferquote bei winzigem n ist kein robuster Fund, nur weil sie beeindruckend " +
      "aussieht. Nenne robuste Funde (significant_after_bh=true in " +
      "mind. einem Fenster) explizit mit Zahlen (z.B. 'LIQUIDITY_SWEEP_HIGH/24h: 90,9% " +
      "Trefferquote vs. 48,1% Basis, n=11'). Nenne fragile/verfallende Signale (decay_flag=true, " +
      "oder nur in einem der beiden Fenster signifikant) mit kurzer Begruendung. Nenne Signal-" +
      "Typen mit strukturell zu kleiner Stichprobe (insufficient_data_cells) als Sammelgruppe, " +
      "nicht jeden einzeln aufzaehlen wenn es viele sind. Ist significant_cells=0, sag das " +
      "explizit ('kein einziger Fund uebersteht aktuell die Mehrfachvergleichs-Korrektur') " +
      "statt ein schwaches Ergebnis staerker klingen zu lassen als es ist -- Sprachregelung: " +
      "'SUPPORTED', nie 'PROVEN' oder 'bewiesen'. Ist total_cells klein oder die Historie kurz, " +
      "benenne das als Grund fuer vorsichtige Interpretation. Erfinde niemals Zahlen ausserhalb " +
      "des Kontexts. " +
      NUMBER_FORMAT_INSTRUCTION +
      " Antworte als JSON mit: summary (string, deutsch, 3-5 Saetze Gesamtbild), " +
      "robust_findings (string[], je Eintrag ein signifikanter Fund mit Zahlen, leeres Array " +
      "wenn keiner), decaying_or_fragile (string[], je Eintrag ein verfallendes/fragiles " +
      "Signal mit kurzer Begruendung, leeres Array wenn keins), insufficient_data_note " +
      "(string, deutsch, 1-2 Saetze zur Sammelgruppe der noch zu duenn belegten Signale).",
    validate: (data) => {
      const errors: string[] = [];
      if (!isNonEmptyString(field(data, "summary"))) {
        errors.push(`"summary" muss ein nicht-leerer String sein.`);
      }
      if (!isStringArray(field(data, "robust_findings"))) {
        errors.push(`"robust_findings" muss ein String-Array sein.`);
      }
      if (!isStringArray(field(data, "decaying_or_fragile"))) {
        errors.push(`"decaying_or_fragile" muss ein String-Array sein.`);
      }
      if (!isNonEmptyString(field(data, "insufficient_data_note"))) {
        errors.push(`"insufficient_data_note" muss ein nicht-leerer String sein.`);
      }
      return errors;
    },
  },

  // YouTube-Gesamtanalyse -- laeuft ueber runTileAnalysis() (tileConfig.ts),
  // Kontext aus den gespeicherten Einzelanalysen
  // (app/api/youtube-monitor/overall-analysis/route.ts).
  "youtube-overall-analysis": {
    id: "youtube-overall-analysis",
    category: "orchestration",
    description:
      "Synthetisiert mehrere bereits analysierte YouTube-Videos zu einer Gesamteinschaetzung, Widersprueche explizit benannt statt gemittelt.",
    systemPrompt:
      "Du bekommst eine Liste bereits einzeln analysierter YouTube-Videos (Kanal, Titel, " +
      "bias, confidence, relevance, summary, Veroeffentlichungsdatum). Deine Aufgabe ist " +
      "NICHT, die Einzelmeinungen zu einem Durchschnitt zu verwischen, sondern zu pruefen, " +
      "ob sich die Kanaele/Videos WIDERSPRECHEN. Gewichte Videos mit relevance='low' kaum " +
      "bis gar nicht (sie sind oft off-topic) -- sag explizit, wenn die meisten Videos " +
      "wenig markt-relevant waren, statt trotzdem eine forcierte Gesamtrichtung zu " +
      "konstruieren. Stimmen die relevanten Kanaele in dieselbe Richtung ueberein, ist " +
      "overallBias diese Richtung und conflicts ein leeres Array. Weichen sie ab, nenne " +
      "JEDEN konkreten Widerspruch einzeln in 'conflicts' mit Kanalnamen (z.B. \"Coin " +
      "Bureau bullish wegen ETF-Zuflüssen, waehrend Benjamin Cowen bearish wegen " +
      "Makro-Risiko argumentiert\") und setze overallBias auf 'conflicting'. Erfinde keine " +
      "Aussagen, die nicht in den gelieferten Zusammenfassungen stehen. " +
      NUMBER_FORMAT_INSTRUCTION +
      " Antworte als JSON mit: overallBias (bullish|bearish|neutral|conflicting), " +
      "confidence (0-100), summary (string, deutsch, 3-5 Saetze), conflicts (string[], " +
      "leer wenn keine).",
    validate: validateYoutubeOverallAnalysis,
  },

  // --- System-Briefing ------------------------------------------------------
  // Fuenf Abschnitte: Fazit, Regelwerk-Check, Chart-Struktur (Formationen/
  // Key Levels/Level-Struktur), Konfluenz-Check (widerspricht etwas dem
  // bisherigen Bild? -- uebernimmt auch den Konsistenz-Check "passt
  // overall_state/score/risk_level zu den Faktoren?", market_state enthaelt
  // dafuer factors) und Trigger & Szenario IMMER in beiden Richtungen.
  // Kursziele sind erlaubt, aber zwingend an ein echtes keyLevels-Level
  // gebunden (keyLevels fasst Pivot-, Liquidations- und EMA/VWAP-Konfluenz
  // zusammen). Salomon-Phase/Regime Matrix sind keine eigenen Quellen (stehen
  // in der Marktphase-Kachel); der Bewegungsvorrat stammt aus
  // lib/systemBriefingContext.ts. Die Eskalation liest ihren Trigger aus
  // diesem Snapshot (lib/escalationContext.ts).
  //
  // Aufbau: drei kleine, unabhaengige Teil-Aufrufe
  // parallel (Regelwerk-Check, Chart-Struktur, Trigger & Szenario), danach
  // EIN kleiner Synthese-Call, der nur die drei Ergebnisse verdichtet --
  // ein einzelner grosser Aufruf scheiterte am 60s-Limit pro
  // Funktionsaufruf (Vercel Hobby). app/api/system-briefing/generate/route.ts
  // setzt die Antworten zum unveraenderten SystemBriefingResult zusammen.
  "system-briefing-regelwerk": {
    id: "system-briefing-regelwerk",
    category: "signal-logic",
    description: "Teil-Aufruf 1/4 des System-Briefings: prueft Tobys Regelwerk gegen die Live-Daten (Gates/Orderflow/Bewegungsvorrat/Liquidation).",
    systemPrompt:
      BRIEFING_STYLE_INSTRUCTION +
      "Daten: regelwerk (Tobys Welz-/Salomon-/'Mein Trading System'-Regelwerk); " +
      "bewegungsvorrat.ratio_pct (heutige Tagesspanne in % des Medians der letzten 10 " +
      "Tage, deutlich ueber 100 = Tagespensum ausgeschoepft); mein_system_checklist " +
      "(Funding, OI-Veraenderung, EMA 13/50/200 auf Tagesbasis, Tagesschluss); " +
      "trading_indicators (GUSS-Regime, VWAP-Vector mit Tages-/Wochen-/Monats-VWAP, CVD -- " +
      "einzige Orderflow-Quelle); liquidations (Preis-Cluster nahe Kurs). " +
      "Pruefe NUR Tobys Regelwerk gegen diese Live-Daten, die Chart-Struktur siehst du " +
      "hier nicht. regelwerkCheck: 2-4 Zeilen 'Label: Befund in einem ganzen Satz', " +
      "getrennt durch \\n, nur befuellte Zeilen. 'Gates: ...' (Funding, OI und " +
      "EMA-Reihenfolge erfuellt? immer, z.B. 'Kurs ueber EMA 13 und EMA 50, aber noch " +
      "unter EMA 200 -- das Long-Gate ist nur teilweise erfuellt.'). 'Orderflow: ...' " +
      "(VWAP und CVD in dieselbe Richtung? immer; GUSS nur erwaehnen, wenn das GUSS-" +
      "Regime einen Trend erkennt, sonst weglassen). 'Bewegungsvorrat: ...' nur wenn " +
      "die Tagesspanne deutlich ueber dem Ueblichen liegt. 'Liquidation: ...' nur bei " +
      "einem relevanten Cluster nahe Kurs. Dazu leanBias (bullish/bearish/neutral): " +
      "deine Tendenz AUSSCHLIESSLICH aus diesem Regelwerk-Befund. " +
      " JSON (flach): regelwerkCheck (string), leanBias (bullish/bearish/neutral).",
    validate: (data) => {
      const errors: string[] = [];
      if (!isNonEmptyString(field(data, "regelwerkCheck"))) {
        errors.push(`"regelwerkCheck" muss ein nicht-leerer String sein.`);
      }
      if (!isEnum(field(data, "leanBias"), BIAS_3)) {
        errors.push(`"leanBias" muss einer von ${BIAS_3.join(", ")} sein.`);
      }
      errors.push(...technicalIdentifierErrors(data, ["regelwerkCheck"]));
      return errors;
    },
  },

  "system-briefing-chart": {
    id: "system-briefing-chart",
    category: "signal-logic",
    description: "Teil-Aufruf 2/4 des System-Briefings: Abschnitt 'Bitcoin Chart' (Struktur, Zonen, VWAPs).",
    systemPrompt:
      BRIEFING_STYLE_INSTRUCTION +
      "Du schreibst den Abschnitt 'Bitcoin Chart'. Daten: btc_markt (aktueller Kurs, " +
      "7-Tage-Hoch/-Tief), vwap (Tages-, Wochen-, Monats-VWAP), triangle/" +
      "continuationFormation/swingFormations (algorithmisch erkannte Formationen, null = " +
      "keine), recentCandlestickPatterns, keyLevels (Preis, Seite Widerstand/" +
      "Unterstuetzung, Zeitrahmen, Bestaetigungen -- mehr Bestaetigungen = staerkere " +
      "Zone), levelStruktur (je Zone: haelt oder gebrochen). Das Regelwerk siehst du " +
      "hier nicht. chartStruktur: 3-5 Saetze wie ein Chartanalyst. Erster Satz = " +
      "Kernaussage zur Lage (z.B. 'BTC konsolidiert seit gestern direkt unter dem " +
      "Monats-VWAP.'). Danach: wo liegt die entscheidende Widerstands- und die naechste " +
      "Unterstuetzungszone (als Spanne, wenn zwei Levels nah beieinander liegen), warum " +
      "sind sie relevant (z.B. mehrfach bestaetigt, letztes Tief vor dem Einbruch, VWAP), " +
      "und was waere ein starkes Zeichen. Formation nur nennen, wenn eine erkannt wurde; " +
      "keine erkannt? Nicht erwaehnen statt 'keine Formation' zu schreiben. Kerzenmuster " +
      "nur nennen, wenn sie zur Aussage beitragen, dann auf Deutsch (z.B. 'bullische " +
      "Umkehrkerze'). Dazu leanBias (bullish/bearish/neutral): deine Tendenz " +
      "AUSSCHLIESSLICH aus dieser Chart-Struktur. " +
      " JSON (flach): chartStruktur (string), leanBias (bullish/bearish/neutral).",
    validate: (data) => {
      const errors: string[] = [];
      if (!isNonEmptyString(field(data, "chartStruktur"))) {
        errors.push(`"chartStruktur" muss ein nicht-leerer String sein.`);
      }
      if (!isEnum(field(data, "leanBias"), BIAS_3)) {
        errors.push(`"leanBias" muss einer von ${BIAS_3.join(", ")} sein.`);
      }
      errors.push(...technicalIdentifierErrors(data, ["chartStruktur"]));
      return errors;
    },
  },

  "system-briefing-trigger": {
    id: "system-briefing-trigger",
    category: "signal-logic",
    description: "Teil-Aufruf 3/4 des System-Briefings: beide Szenarien (Ausbruch/Scheitern) mit Kursziel und Invalidierung.",
    systemPrompt:
      // Framing-Satz: ein Gratis-Modell hinter OpenRouter verweigerte dieses
      // isolierte Teil-Prompt wiederholt mit "Unauthorized Advice" statt JSON
      // zu liefern -- isoliert liest sich "bullish/bearish + Kursziel" fuer
      // einen Sicherheitsfilter wie eine direkte Kaufempfehlung. Reine
      // Klarstellung, keine inhaltliche Aenderung.
      "Du erstellst eine rein strukturelle, hypothetische Wenn-Dann-Analyse fuer Tobys " +
      "eigenes Trading-Regelwerk -- ausschliesslich private Eigennutzung durch Toby " +
      "selbst, keine Finanzberatung, keine Kaufempfehlung und keine Handlungsaufforderung " +
      "an irgendwen. " +
      BRIEFING_STYLE_INSTRUCTION +
      "Daten: btc_markt (aktueller Kurs), keyLevels (Preis, Seite, Bestaetigungen), " +
      "mein_system_checklist (Funding, OI, EMA 13/50/200, Tagesschluss), " +
      "trading_indicators (GUSS-Regime, VWAP, CVD). Fuer bullish und bearish je: " +
      "text = 1-2 ganze Saetze wie in einem Marktbericht, erster Satz als Kernaussage, " +
      "z.B. bullish 'Ueberwindet BTC die Zone 84'300-84'500 USD nachhaltig, koennte der " +
      "Abverkauf schnell aufgeholt werden. Dann rueckt die Zone um 85'000 USD in den " +
      "Fokus.' bzw. bearish 'Scheitert BTC an dieser Zone, werden die Unterstuetzungen " +
      "bei 83'200 und 82'300 USD wichtig. Solange sie halten, bleibt die Erholung " +
      "intakt.'; bedingungen = 1-3 kurze Bedingungen in Klartext (z.B. 'Tagesschluss " +
      "ueber dem EMA 200', 'Funding bleibt unter 0.05 %', 'CVD steigt weiter'), jede an " +
      "einen echten Wert aus den Daten gebunden; kursziel = Zahl oder null -- MUSS null " +
      "sein oder EXAKT einem keyLevels-Preis entsprechen, nie frei berechnet, und ist das " +
      "naechste sinnvolle Level HINTER dem Ausloeser -- nie derselbe Preis wie der " +
      "Ausloeser im text (Ausloeser 84'300 USD -> Kursziel z.B. 85'000 USD). Schreibe " +
      "IMMER beide Richtungen, auch wenn eine unwahrscheinlicher ist (dann im text so " +
      "einordnen); kein Level hinter dem Ausloeser vorhanden? Dann kursziel null. " +
      "invalidierung: ein ganzer Satz, ab wann das Bild kippt. " +
      " JSON (flach, KEIN 'trigger'-Wrapper): bullish ({ text: string, bedingungen: " +
      "string[], kursziel: Zahl oder null }), bearish (gleich), invalidierung (string).",
    validate: (data) => {
      const errors: string[] = [];
      for (const key of ["bullish", "bearish"] as const) {
        const scenario = field(data, key);
        if (!isNonEmptyString(field(scenario, "text"))) {
          errors.push(`"${key}.text" muss ein nicht-leerer String sein (immer beide Szenarien).`);
        }
        if (!isStringArray(field(scenario, "bedingungen"))) {
          errors.push(`"${key}.bedingungen" muss ein String-Array sein.`);
        }
        if (!isNullableFiniteNumber(field(scenario, "kursziel"))) {
          errors.push(`"${key}.kursziel" muss eine Zahl oder null sein.`);
        }
        errors.push(...technicalIdentifierErrors(scenario, ["text", "bedingungen"], `${key}.`));
      }
      if (!isNonEmptyString(field(data, "invalidierung"))) {
        errors.push(`"invalidierung" muss ein nicht-leerer String sein.`);
      }
      errors.push(...technicalIdentifierErrors(data, ["invalidierung"]));
      return errors;
    },
  },

  "system-briefing-synthese": {
    id: "system-briefing-synthese",
    category: "signal-logic",
    description: "Teil-Aufruf 4/4 des System-Briefings: Schlagzeile, Marktupdate, Momentum, Liquidationen, ETF-Flows, Kalender, Fazit, Konfluenz-Check und Vergleich mit dem vorherigen Lauf.",
    systemPrompt:
      BRIEFING_STYLE_INSTRUCTION +
      "Du schreibst die Rahmen-Abschnitte des BTC-Marktberichts. Bereits fertig (NICHT " +
      "neu bewerten, nur einordnen): regelwerkCheck und chartStruktur mit je eigener " +
      "Tendenz (regelwerkLeanBias/chartLeanBias) sowie das trigger-Szenario. Daten: " +
      "btc_markt (Kurs, Veraenderung 24h/7 Tage, 7-Tage-Hoch/-Tief), rsi (RSI 14 auf 4H " +
      "und 1D, aktuell und vorherige Kerze), liquidations (Preis-Cluster mit Volumen, " +
      "Seite long/short), etf_flows (letzter Handelstag und Summe der letzten Tage, Mio. " +
      "USD), wirtschaftskalender (Termine heute/morgen, Uhrzeit US-Ostkueste), news " +
      "(marktbewegende Schlagzeilen), market_state und market_context (nur zum Abgleich), " +
      "bewegungsvorrat_ratio_pct, previousBriefing. Abschnitte, jeder mit Kernsatz " +
      "zuerst: " +
      "schlagzeile: EINE Zeile ohne Punkt am Ende, wie ein Newsletter-Betreff (z.B. 'BTC " +
      "erholt sich und steht vor moeglichem Ausbruch'). " +
      "marktupdate: 2-4 Saetze -- Kurs, Veraenderung 24h und 7 Tage, Einordnung " +
      "(z.B. 'Nach dem Boden um 82'000 USD hat sich BTC kraftvoll zurueck zu 84'000 USD " +
      "gearbeitet (+1.2 % in 24 Stunden).'); relevante Schlagzeilen hoechstens in einem " +
      "Halbsatz. " +
      "momentum: 2-3 Saetze zum RSI auf 4H und 1D (Richtung seit der vorherigen Kerze, " +
      "ueberkauft ueber 70, ueberverkauft unter 30, neutral um 50). " +
      "liquidationen: 2-3 Saetze -- welche Cluster liegen ueber dem Kurs (Hürde), welche " +
      "darunter (Fundament), mit Preis und Volumen; keine Daten? Das in einem Satz sagen. " +
      "etfFlows: 1-3 Saetze -- Netto-Fluss des letzten Handelstags und die Tendenz der " +
      "letzten Tage. " +
      "wirtschaftskalender: 1-2 Saetze -- welche US-Termine heute/morgen anstehen und " +
      "wann (Uhrzeit in Schweizer Zeit umrechnen: US-Ostkueste + 6 Stunden); keine? " +
      "'Heute und morgen stehen keine relevanten US-Wirtschaftsdaten an.' " +
      "fazit: bias (bullish/bearish/neutral -- verdichte regelwerkLeanBias und " +
      "chartLeanBias zu einem Urteil, nur bei echter Richtung, sonst neutral), " +
      "confidence (0-100), kernaussage (1-2 Saetze, verdichtet Regelwerk und Chart; der " +
      "erste Satz darf bias nicht widersprechen). " +
      "konfluenzCheck: NUR bei echtem inhaltlichem Widerspruch (Marktdaten vs. Regelwerk/" +
      "Chart, Aggregat vs. Faktoren, Chart vs. Regelwerk), 1-2 Saetze, sonst null. " +
      "aenderungSeitLetztem: previousBriefing vorhanden? 1-2 Saetze, was sich bei " +
      "Richtung, Ueberzeugungsgrad oder Kernaussage geaendert hat; keine relevante " +
      "Aenderung? 'Kaum Veraenderung seit dem letzten Lauf.' previousBriefing null? Dann " +
      "null -- nie erfinden, was vorher war. " +
      " JSON (flach): schlagzeile, marktupdate, momentum, liquidationen, etfFlows, " +
      "wirtschaftskalender (alle string), fazit ({ bias, confidence, kernaussage }), " +
      "konfluenzCheck (string oder null), aenderungSeitLetztem (string oder null).",
    validate: (data) => {
      const errors: string[] = [];
      const fazit = field(data, "fazit");
      if (!isEnum(field(fazit, "bias"), BIAS_3)) {
        errors.push(`"fazit.bias" muss einer von ${BIAS_3.join(", ")} sein.`);
      }
      if (!isConfidence(field(fazit, "confidence"))) {
        errors.push(`"fazit.confidence" muss eine Zahl zwischen 0 und 100 sein.`);
      }
      if (!isNonEmptyString(field(fazit, "kernaussage"))) {
        errors.push(`"fazit.kernaussage" muss ein nicht-leerer String sein.`);
      }
      for (const key of BRIEFING_REPORT_SECTIONS) {
        if (!isNonEmptyString(field(data, key))) {
          errors.push(`"${key}" muss ein nicht-leerer String sein.`);
        }
      }
      const konfluenzCheck = field(data, "konfluenzCheck");
      if (konfluenzCheck !== null && !isNonEmptyString(konfluenzCheck)) {
        errors.push(`"konfluenzCheck" muss ein nicht-leerer String oder null sein.`);
      }
      // Fehlend wird toleriert (wie null), damit ein Modell, das das Feld
      // auslaesst, nicht den ganzen Lauf scheitern laesst.
      const aenderung = field(data, "aenderungSeitLetztem");
      if (aenderung !== undefined && aenderung !== null && !isNonEmptyString(aenderung)) {
        errors.push(`"aenderungSeitLetztem" muss ein nicht-leerer String oder null sein.`);
      }
      errors.push(
        ...technicalIdentifierErrors(data, [...BRIEFING_REPORT_SECTIONS, "konfluenzCheck", "aenderungSeitLetztem"]),
        ...technicalIdentifierErrors(fazit, ["kernaussage"], "fazit.")
      );
      return errors;
    },
  },

  // --- Eskalation ("gezielte Eskalation") ----------------------------------
  // Wird NICHT ueber "auto" geroutet, sondern von app/api/escalation/
  // generate/route.ts mit mehreren providerOverride-Werten parallel
  // aufgerufen -- nur wenn System-Briefing/Divergenz-Radar
  // bereits einen Widerspruch melden (lib/escalationContext.ts). Jeder
  // Provider bekommt DIESELBE rohe Gesamteinschaetzung; Konsens/Divergenz
  // wertet danach lib/escalationConsensus.ts regelbasiert aus.
  "escalation-analysis": {
    id: "escalation-analysis",
    category: "signal-logic",
    description:
      "Unabhaengige Zweitmeinung zur Gesamteinschaetzung, ausgeloest nur wenn Nexus intern bereits eine Divergenz/einen Widerspruch erkannt hat.",
    systemPrompt:
      "Nexus hat bei einem oder mehreren internen Pruefmechanismen bereits eine Divergenz oder " +
      "einen Widerspruch festgestellt (trigger_reasons im Kontext, je mit einer konkreten " +
      "Begruendung). Du bekommst zusaetzlich die aktuelle rohe Ausgabe der regelbasierten " +
      "14-Faktoren-Marktzustands-Engine (market_state: factors, overall_state, score, " +
      "confidence, confidence_breakdown, risk_level, patterns). Bilde DEINE EIGENE, " +
      "unabhaengige Einschaetzung anhand der Faktoren -- kopiere nicht einfach overall_state. " +
      "Ordne in der summary explizit ein, ob der gemeldete Widerspruch aus deiner Sicht " +
      "nachvollziehbar ist (z.B. weil die Faktoren tatsaechlich gemischt sind) oder ob eine " +
      "Seite davon eher ein Ausreisser ist. Erfinde keine zusaetzlichen Daten ausserhalb des " +
      "Kontexts. " +
      NUMBER_FORMAT_INSTRUCTION +
      " Antworte als JSON mit: bias (bullish|bearish|neutral), confidence (0-100, deine " +
      "eigene Sicherheit), summary (string, deutsch, 2-3 Saetze).",
    validate: (data) => validateBiasSummary(data),
  },

  // --- Trade-Debate (TradingAgents-Architektur [arXiv:2412.20138]) ---------
  // Zwei gegensaetzlich geprompte Analysten (Bull/Bear) + ein Referee. Werden
  // von app/api/trade-debate/generate/route.ts mit expliziten
  // providerOverride-Werten aufgerufen (tileConfig.ts trade-debate-*) --
  // unterschiedliche Vendors fuer Bull/Bear gegen gemeinsamen Modell-Bias.
  // Beide bekommen DENSELBEN Marktdaten-Kontext (lib/tradeDebateContext.ts)
  // als strukturierte Zahlen, kein Chart-Bild (reduziert Halluzination).
  "trade-bull-analyst": {
    id: "trade-bull-analyst",
    category: "signal-logic",
    description: "Sucht aktiv nach einem Long-Setup anhand TA (EMAs/VWAP/Pivots) + Nexus-Derivatedaten.",
    systemPrompt:
      "Du bist der BULLISHE Analyst in einem zweiseitigen Trade-Review fuer BTC/USDT: ein " +
      "zweiter, unabhaengiger Analyst sucht parallel und ohne deine Antwort zu kennen nach " +
      "einem Short-Setup, ein dritter Referee vergleicht am Ende beide Reports. Deine " +
      "Aufgabe: suche aktiv nach einem plausiblen LONG-Setup anhand des Kontexts -- " +
      "Trend-Alignment ueber die Timeframes (EMA20/50/100/200 je 1h/4h/1d), Position " +
      "relativ zu Weekly-/Monthly-/Swing-VWAP und den Pivot-Punkten (z.B. Bounce an einem " +
      "Support-Pivot oder PP), sowie Nexus-Derivatedaten (fallende/negative Funding Rate = " +
      "Shorts zahlen Longs, steigendes Open Interest bei stabilem/steigendem Preis = " +
      "Akkumulation). EMA800 ist NUR ein grober, in der Szene gebraeuchlicher Makro-Filter " +
      "auf kleineren Timeframes -- kein etablierter institutioneller Standard wie EMA50/200, " +
      "gewichte ihn entsprechend niedriger. " +
      "WICHTIG: Nutze AUSSCHLIESSLICH die im Kontext gelieferten Zahlen -- erfinde niemals " +
      "Indikatorwerte, Preise oder Ereignisse, die dort nicht stehen. Findest du KEIN " +
      "plausibles Long-Setup (z.B. weil Trend und Derivatedaten klar dagegensprechen), sag " +
      "das ehrlich und setze confidence entsprechend niedrig, statt ein schwaches Setup zu " +
      "konstruieren. Widersprechen sich reine TA-Indikatoren und Nexus-Derivatedaten " +
      "(Funding/OI/Liquidations-Cluster), haben die Derivatedaten Prioritaet -- TA-" +
      "Indikatoren sind nachlaufend, Derivatedaten zeigen die aktuelle Positionierung. " +
      "Gib einen konkreten Einstiegspreis, ein Invalidierungs-Level (wo dein Setup falsch " +
      "waere, z.B. Bruch eines Pivots/EMA) und ein Kursziel an. " +
      NUMBER_FORMAT_INSTRUCTION +
      " Antworte als JSON mit: bias (immer 'long'), entry_price (number), " +
      "invalidation_price (number), target_price (number), risk_reward (number, z.B. 2.5 " +
      "fuer ein Verhaeltnis von 1:2.5), confidence (0-100), reasoning (string, deutsch, " +
      "3-5 Saetze, referenziert konkrete Werte aus dem Kontext).",
    validate: (data) => validateTradeDebateAnalyst(data, "long"),
  },

  "trade-bear-analyst": {
    id: "trade-bear-analyst",
    category: "signal-logic",
    description: "Sucht aktiv nach einem Short-Setup anhand TA (EMAs/VWAP/Pivots) + Nexus-Derivatedaten.",
    systemPrompt:
      "Du bist der BAERISCHE Analyst in einem zweiseitigen Trade-Review fuer BTC/USDT: ein " +
      "zweiter, unabhaengiger Analyst sucht parallel und ohne deine Antwort zu kennen nach " +
      "einem Long-Setup, ein dritter Referee vergleicht am Ende beide Reports. Deine " +
      "Aufgabe: suche aktiv nach einem plausiblen SHORT-Setup anhand des Kontexts -- " +
      "Rejection an einem Resistance-Pivot (R1-R3) oder deutliche Ueberdehnung (grosser " +
      "Abstand zu EMA20/50 relativ zum ATR), Liquidations-Cluster knapp OBERHALB des " +
      "aktuellen Preises (moegliches Liquidity-Sweep-/Short-Squeeze-Ziel, das der Markt " +
      "anlaufen und danach abverkaufen koennte), sowie stark positive Funding Rate " +
      "(ueberhebelte Longs = Crowding-Risiko auf der Long-Seite). EMA800 ist NUR ein " +
      "grober, in der Szene gebraeuchlicher Makro-Filter auf kleineren Timeframes -- kein " +
      "etablierter institutioneller Standard wie EMA50/200, gewichte ihn entsprechend " +
      "niedriger. " +
      "WICHTIG: Nutze AUSSCHLIESSLICH die im Kontext gelieferten Zahlen -- erfinde niemals " +
      "Indikatorwerte, Preise oder Ereignisse, die dort nicht stehen. Findest du KEIN " +
      "plausibles Short-Setup, sag das ehrlich und setze confidence entsprechend niedrig, " +
      "statt ein schwaches Setup zu konstruieren. Widersprechen sich reine TA-Indikatoren " +
      "und Nexus-Derivatedaten (Funding/OI/Liquidations-Cluster), haben die Derivatedaten " +
      "Prioritaet -- TA-Indikatoren sind nachlaufend, Derivatedaten zeigen die aktuelle " +
      "Positionierung. Gib einen konkreten Einstiegspreis, ein Invalidierungs-Level (wo " +
      "dein Setup falsch waere, z.B. Reclaim eines Pivots/EMA) und ein Kursziel an. " +
      NUMBER_FORMAT_INSTRUCTION +
      " Antworte als JSON mit: bias (immer 'short'), entry_price (number), " +
      "invalidation_price (number), target_price (number), risk_reward (number, z.B. 2.5 " +
      "fuer ein Verhaeltnis von 1:2.5), confidence (0-100), reasoning (string, deutsch, " +
      "3-5 Saetze, referenziert konkrete Werte aus dem Kontext).",
    validate: (data) => validateTradeDebateAnalyst(data, "short"),
  },

  "trade-referee": {
    id: "trade-referee",
    category: "signal-logic",
    description: "Prueft Bull- und Bear-Setup gegeneinander und faellt die finale Entscheidung (inkl. WAIT).",
    systemPrompt:
      "Du bist der Risk Manager/CIO in einem zweiseitigen Trade-Review fuer BTC/USDT. Du " +
      "bekommst im Kontext: die urspruengliche, strukturierte Marktdatengrundlage (dieselbe, " +
      "die beide Analysten hatten, unter market_data), den vollstaendigen Report des " +
      "BULLISHEN Analysten (bull_analysis) und den vollstaendigen Report des BAERISCHEN " +
      "Analysten (bear_analysis). Deine Aufgabe: " +
      "1) Pruefe BEIDE Reports auf Plausibilitaet -- widersprechen die genannten Zahlen " +
      "(entry/invalidation/target) den tatsaechlichen Werten in market_data? Benenne das " +
      "explizit, falls ja. " +
      "2) Ein Setup mit einem Risk/Reward unter 1:2 gilt als nicht handelbar, unabhaengig " +
      "von der Richtung. " +
      "3) Widersprechen sich reine TA-Argumente (EMAs/Pivots/VWAP) und Nexus-Derivatedaten " +
      "(Open Interest/Funding/Liquidations-Cluster) in einem der beiden Reports, haben die " +
      "Derivatedaten IMMER Prioritaet -- TA-Indikatoren sind nachlaufend. " +
      "4) Bei einem echten, nicht aufloesbaren Widerspruch zwischen Bull und Bear " +
      "(z.B. Bull begruendet mit einem EMA-Cross, aber Bear zeigt einen massiven " +
      "Liquidations-Cluster direkt darunter) ist 'wait' das korrekte Urteil, kein " +
      "erzwungener Kompromiss -- ein 'wait'-Urteil ist ein vollwertiges, oft richtiges " +
      "Ergebnis, kein Ausweichen. " +
      "5) Achte aktiv auf Confirmation Bias in beiden Reports (Welz-Prinzip): suche gezielt " +
      "nach der jeweils schwaecheren Stelle der eigenen Argumentation, nicht nur nach " +
      "Bestaetigung der Kernthese -- ein Report, der keine Gegenargumente nennt, ist " +
      "verdaechtig, nicht automatisch staerker. " +
      "Erfinde niemals eigene Zahlen ausserhalb von market_data oder den beiden Analysten-" +
      "Reports. " +
      NUMBER_FORMAT_INSTRUCTION +
      " Antworte als JSON mit: verdict (long|short|wait), divergence_detected (boolean, " +
      "true wenn Bull und Bear sich in der Kernrichtung widersprechen), synthesis (string, " +
      "deutsch, 3-5 Saetze, fasst die Entscheidung zusammen inkl. ob einer der beiden " +
      "Analysten einen Fehler gemacht hat), invalidation_level (number oder null -- das aus " +
      "deiner Sicht massgebliche Level, ab dem die Entscheidung ungueltig wird; null nur " +
      "bei verdict='wait' ohne aktiv gehaltene Position).",
    validate: validateTradeReferee,
  },

  // Freie Anfrage: einziges Profil ohne festen Zweck -- der Kontext traegt
  // "user_task" (Freitext) getrennt von "market_data" (derselbe validierte
  // Marktkontext aus lib/reportContext.ts). Der System-Prompt legt nur die
  // Leitplanken fest (nur market_data nutzen, nichts erfinden).
  "custom-query": {
    id: "custom-query",
    category: "orchestration",
    description: "Beantwortet eine frei formulierte Nutzeraufgabe/-frage anhand des echten Nexus-Marktkontexts.",
    systemPrompt:
      "Du bist NEXUS, ein persoenliches BTC-Marktueberwachungs-Tool. Der Kontext enthaelt zwei " +
      "getrennte Felder: user_task (eine frei formulierte Aufgabe oder Frage des Nutzers) und " +
      "market_data (der aktuelle, bereits validierte Nexus-Marktkontext -- Preis, Open " +
      "Interest, Funding, Spot-Pressure, Liquidationen, Positionierung, Boersenvergleich, " +
      "markbewegende News, ETF-Flows, sowie die regelbasierte Gesamteinschaetzung inkl. " +
      "data_quality). Bearbeite AUSSCHLIESSLICH user_task. Stuetze dich dabei NUR auf " +
      "market_data -- erfinde niemals Zahlen, Ereignisse oder Quellen, die dort nicht " +
      "vorkommen. Wenn market_data fuer die gestellte Aufgabe nicht ausreicht (z.B. gefragt " +
      "nach einem Wert, den Nexus nicht erfasst, oder data_quality zeigt INSUFFICIENT_DATA " +
      "fuer einen relevanten Teil), sag das explizit statt zu spekulieren. Wenn user_task " +
      "eindeutig NICHTS mit BTC/Krypto-Marktanalyse zu tun hat, weise kurz darauf hin statt " +
      "die Anfrage trotzdem zu bearbeiten. " +
      NUMBER_FORMAT_INSTRUCTION +
      " Antworte als JSON mit: answer (string, deutsch, so lang wie fuer die Aufgabe " +
      "angemessen -- keine kuenstliche Kuerzung, aber auch kein unnoetiges Fuellmaterial).",
    validate: (data) => {
      if (!isNonEmptyString(field(data, "answer"))) {
        return ['"answer" muss ein nicht-leerer String sein.'];
      }
      return [];
    },
  },
};

export function getPromptProfile(id: string): PromptProfile {
  const profile = promptProfiles[id];
  if (!profile) {
    throw new Error(`Unbekanntes Prompt Profile: ${id}`);
  }
  return profile;
}
