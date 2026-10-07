import type { PromptProfile } from "./types";

// Prompt Profiles liegen zentral hier statt in einzelnen UI-Komponenten.
// Aendert sich ein Analyse-Prompt, wird NUR diese Datei angepasst – keine
// Dashboard-Kachel muss dafür angefasst werden.
//
// Die Markteinschätzungs-Box läuft weiterhin regelbasiert (siehe
// supabase/functions/compute-market-state) -- die meisten Profile hier sind
// vorbereitetes Fundament ohne UI-Anbindung. "system-briefing" (Umsetzungsplan
// Phase 3/4, 05./18.09.2026) ist eine der ersten produktiv über
// runTileAnalysis() aufgerufenen Kacheln; report-* laufen seit der AI
// Report Engine bereits produktiv über runReportAnalysis().

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

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

const BIAS_3 = ["bullish", "bearish", "neutral"] as const;
const RISK_ON_OFF = ["risk-on", "risk-off", "neutral"] as const;
const RISK_LEVELS = ["low", "medium", "high"] as const;
const IMPACT_LEVELS = ["high", "medium", "low"] as const;
// Master-Report darf zusätzlich "conflicting" melden -- siehe
// validateMasterReport weiter unten (Vorgabe: Widersprüche zwischen den
// Einzelreports erkennen statt sie zu einem falschen "bullish" zu mitteln).
const MASTER_BIAS = ["bullish", "bearish", "neutral", "conflicting"] as const;

// Wird an JEDES Report-Profile angehängt (siehe Vorgabe Teil Q/T): die KI
// bekommt data_quality explizit im Kontext mitgeliefert und MUSS eine
// eingeschränkte Datenbasis in der summary benennen statt sie zu
// ignorieren oder fehlende Werte zu erfinden.
const DATA_QUALITY_INSTRUCTION =
  "Der Kontext enthält ein data_quality-Feld (overall: OK|PRELIMINARY|INSUFFICIENT_DATA, " +
  "plus Detail-Notizen). Ist overall nicht 'OK', muss die summary das explizit benennen und " +
  "die Einschätzung entsprechend vorsichtiger formulieren. Nutze ausschliesslich die im " +
  "Kontext gelieferten Werte -- erfinde niemals fehlende Zahlen, Ereignisse oder Quellen.";

// Einheitliche Zahlen-/Formatierungsregeln für die "summary"/Freitext-Felder
// -- an alle Report-Profile angehängt (Report 1-4, deren summary direkt im
// Dashboard angezeigt wird), damit AI-Text und die regelbasierten UI-Werte
// (siehe z.B. LivePricePanel.tsx/MarketContextCard.tsx, durchgehend
// toLocaleString("de-CH") bzw. .toFixed()) nicht auseinanderlaufen -- vorher
// gab es dafür keine Vorgabe, wodurch je nach Provider/Modell uneinheitlich
// formatiert wurde (mal Komma, mal Punkt, mal ohne Vorzeichen).
const NUMBER_FORMAT_INSTRUCTION =
  "Formatiere Zahlen in der summary wie im Dashboard: Prozentwerte mit Vorzeichen und einer " +
  "Nachkommastelle (z.B. +1.5%, -0.3%), Punkt als Dezimaltrennzeichen (nie Komma), große " +
  "USD-Beträge gerundet mit Einheit (z.B. $12.3M, $450K) statt ausgeschriebener Nullen.";

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

// Master-Report: prüft die drei Einzelreports auf Widersprüche statt sie
// zu kopieren/mitteln. componentBiases macht nachvollziehbar, WELCHE
// Einzelmeinung in welche Richtung zeigt (Transparenz, keine Black Box).
function validateMasterReport(data: unknown): string[] {
  const errors: string[] = [];

  const overallBias = field(data, "overallBias");
  if (!isEnum(overallBias, MASTER_BIAS)) {
    errors.push(
      `"overallBias" muss einer von [${MASTER_BIAS.join(", ")}] sein, war: ${JSON.stringify(overallBias)}`
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

  const componentBiases = field(data, "componentBiases");
  for (const key of ["marketStructure", "positioning", "newsMacro"]) {
    if (!isNonEmptyString(field(componentBiases, key))) {
      errors.push(`"componentBiases.${key}" muss ein nicht-leerer String sein.`);
    }
  }

  // changeSinceLast (03.10.2026, Nutzer-Wunsch "kann der report auf den
  // vorherigen kurz eingehen?!") -- null ist der korrekte Wert, wenn der
  // Kontext keinen vorherigen Lauf enthielt (allererster Master-Lauf
  // ueberhaupt, oder der vorherige Lauf konnte nicht geladen werden), KEIN
  // Validierungsfehler. Ein nicht-leerer String ist nur dann falsch, wenn
  // er fehlt, obwohl ein vorherigerLauf im Kontext mitgegeben wurde -- das
  // kann diese rein strukturelle Pruefung aber nicht unterscheiden (kennt
  // den Kontext nicht), daher hier nur der Typ geprueft.
  if (!isNullableNonEmptyString(field(data, "changeSinceLast"))) {
    errors.push(`"changeSinceLast" muss ein nicht-leerer String oder null sein.`);
  }

  return errors;
}

// YouTube-Gesamtanalyse (Nutzer-Wunsch 14.09.2026: "gesamt analyse der
// einzelnen analysierten youtube beitraege") -- gleiche Philosophie wie
// der Master-Report: NICHT die Einzelvideos zu einem Bias mitteln, sondern
// Widersprueche zwischen den Kanaelen/Videos explizit benennen. Anders als
// beim Master-Report ist die Anzahl der Quellen variabel (nicht fix 3),
// daher kein componentBiases-Objekt mit festen Schluesseln -- stattdessen
// "conflicts" als Freitext-Liste, die auf konkrete Kanalnamen verweist.
function validateYoutubeOverallAnalysis(data: unknown): string[] {
  const errors: string[] = [];

  const overallBias = field(data, "overallBias");
  if (!isEnum(overallBias, MASTER_BIAS)) {
    errors.push(
      `"overallBias" muss einer von [${MASTER_BIAS.join(", ")}] sein, war: ${JSON.stringify(overallBias)}`
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
  // --- Periodischer KI-Rueckblick, Phase 3 (10.09.2026) --------------------
  // Liest AUSSCHLIESSLICH die in Phase 2 (compute_signal_stats(),
  // signal_stats_results) bereits fertig berechneten Zahlen -- kein eigener
  // Bias, kein Handelssignal, keine eigene Statistik (Kontext aus
  // lib/signalReviewContext.ts). Aufgabe: eine verstaendliche deutsche
  // Einordnung, welche Signale genug Stichprobe haben, welche die
  // BH-FDR-Korrektur ueberstehen, welche verfallen (decay_flag) und welche
  // "zu wenig Daten" bleiben. Woechentlich vom signal-review-scheduler-Cron
  // ausgeloest, nicht manuell pro Klick wie die meisten anderen Kacheln.
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

  // --- NEXUS AI Report Engine (Report 1-4) ---------------------------------
  // Bekommen ihren Kontext ausschliesslich aus lib/reportContext.ts
  // (buildMarketContext) -- ein bereits validiertes, strukturiertes Objekt,
  // niemals rohe Tabellenzeilen. Werden über runReportAnalysis() in
  // router.ts ausgeführt (Provider/Modell kommen aus der Nutzer-Konfiguration
  // je Report-Slot, nicht aus tileConfig.ts).
  "report-market-structure": {
    id: "report-market-structure",
    category: "market-mechanics",
    description: "Report 1: Preis, OI, Funding, Liquidationen, Spot Pressure, Exchange-Daten.",
    systemPrompt:
      "Du analysierst die aktuelle BTC/USDT-Futures-Marktstruktur für den im Kontext " +
      "angegebenen Zeitraum (timeframe). Nutze btc_price, oi (inkl. by_exchange), funding, " +
      "liquidations, spot_pressure und exchange_comparison. Ordne ein, ob Preis- und " +
      "OI-Bewegung zusammen mit dem Spot-Flow für echten Positionsaufbau/-abbau oder eher " +
      "gehebelte/mechanische Bewegung sprechen (das regelbasierte assessment-Feld gibt dir " +
      "bereits eine Einordnung dazu -- widersprich ihr nicht ohne Grund, sondern nutze sie " +
      "als Ausgangspunkt). " +
      DATA_QUALITY_INSTRUCTION +
      NUMBER_FORMAT_INSTRUCTION +
      " Antworte als JSON mit: bias (bullish|bearish|neutral), confidence (0-100), " +
      "summary (string, deutsch), keyFactors (string[]), riskLevel (low|medium|high).",
    validate: (data) =>
      validateBiasSummary(data, { requireKeyFactors: true, requireRiskLevel: true }),
  },
  "report-positioning": {
    id: "report-positioning",
    category: "market-mechanics",
    description: "Report 2: Long/Short, Top Trader, Retail, OI, Taker Flow, Exchange Divergence.",
    systemPrompt:
      "Du analysierst die aktuelle BTC-Futures-Positionierung. Nutze positioning (Retail- " +
      "und Top-Trader-Ratios je Börse, Taker-Buy/Sell), oi.by_exchange (Exchange Divergence " +
      "-- zieht eine einzelne Börse die OI-Bewegung überproportional?) und liquidations als " +
      "Kontext. Ordne insbesondere ein, ob Retail- und Top-Trader-Positionierung " +
      "übereinstimmen oder auseinanderlaufen, und ob die OI-Bewegung breit über mehrere " +
      "Börsen oder konzentriert auf eine einzelne stattfindet. " +
      DATA_QUALITY_INSTRUCTION +
      NUMBER_FORMAT_INSTRUCTION +
      " Antworte als JSON mit: bias (bullish|bearish|neutral), confidence (0-100), " +
      "summary (string, deutsch), keyFactors (string[]).",
    validate: (data) => validateBiasSummary(data, { requireKeyFactors: true }),
  },
  "report-news-macro": {
    id: "report-news-macro",
    category: "research",
    description: "Report 3: News Risk, ETF-Flows, Makro-relevante Ereignisse.",
    systemPrompt:
      "Du bewertest die aktuelle News- und Makro-Lage für BTC. Nutze ausschliesslich " +
      "news_macro.items (bereits gefilterte, marktbewegende News der letzten " +
      "news_macro.window_hours Stunden) und etf_flows. Erfinde keine Ereignisse, die nicht " +
      "in den gelieferten Items stehen. Sind items leer, sag explizit, dass aktuell keine " +
      "markbewegenden News/Makro-Ereignisse im Datenbestand vorliegen, statt eine " +
      "Einschätzung zu konstruieren. " +
      DATA_QUALITY_INSTRUCTION +
      NUMBER_FORMAT_INSTRUCTION +
      " Antworte als JSON mit: bias (risk-on|risk-off|neutral), confidence (0-100), " +
      "summary (string, deutsch), keyFactors (string[]).",
    validate: (data) =>
      validateBiasSummary(data, { biasValues: RISK_ON_OFF, requireKeyFactors: true }),
  },
  "report-master": {
    id: "report-master",
    category: "orchestration",
    description:
      "Report 4: prüft die Ergebnisse der Reports 1-3 auf Widersprüche statt sie zu mitteln.",
    systemPrompt:
      "Du erhältst im Kontext die strukturierten Ergebnisse von drei Einzelreports " +
      "(marketStructureReport, positioningReport, newsMacroReport -- jeweils mit bias/" +
      "confidence/summary) sowie die rohen Nexus-Marktdaten (marketData) und das " +
      "regelbasierte assessment. Deine Aufgabe ist NICHT, die Einzelreports zu kopieren " +
      "oder ihren Bias einfach zu mitteln, sondern zu prüfen, ob sie sich WIDERSPRECHEN. " +
      "Beispiel: Market Structure bullish, Positioning bearish, News neutral -> overallBias " +
      "muss 'conflicting' sein, nicht blind 'bullish'. Nenne jeden konkreten Widerspruch " +
      "in 'conflicts' (z.B. \"Market Structure bullish, aber Positioning zeigt Retail-Short-" +
      "Überhang bei fallendem Top-Trader-Interesse\"). Stimmen alle drei überein, ist " +
      "conflicts ein leeres Array und overallBias entspricht der gemeinsamen Richtung. " +
      "Erfinde keine zusätzlichen Daten -- nutze ausschliesslich die gelieferten " +
      "Report-Ergebnisse und Marktdaten. " +
      "Enthält der Kontext zusätzlich previousMasterReport (generated_at/overallBias/" +
      "confidence/summary deines eigenen vorherigen Laufs), vergleiche kurz: hat sich " +
      "overallBias geändert, ist confidence deutlich gestiegen/gefallen, hat sich einer " +
      "der drei componentBiases gedreht? Schreibe das als 1-2 Sätze in changeSinceLast " +
      "(z.B. \"Bias von neutral auf bullish gedreht, seit Positioning von Short- auf " +
      "Long-Überhang gewechselt hat -- Confidence damit von 42 auf 61 gestiegen.\"). Gab " +
      "es keine relevante Änderung, sag das explizit (\"Kaum Veränderung seit dem letzten " +
      "Lauf.\"), erfinde keine Bewegung. Fehlt previousMasterReport im Kontext (erster " +
      "Lauf, oder vorheriger Lauf nicht verfügbar), setze changeSinceLast auf null -- " +
      "nie erfinden, was vorher war. " +
      DATA_QUALITY_INSTRUCTION +
      NUMBER_FORMAT_INSTRUCTION +
      " Antworte als JSON mit: overallBias (bullish|bearish|neutral|conflicting), " +
      "confidence (0-100), summary (string, deutsch), conflicts (string[], leer wenn " +
      "keine), componentBiases ({ marketStructure, positioning, newsMacro } als kurze " +
      "String-Zusammenfassungen der jeweiligen Einzelrichtung), changeSinceLast (string " +
      "oder null, siehe oben).",
    validate: validateMasterReport,
  },

  // YouTube-Gesamtanalyse (Nutzer-Wunsch 14.09.2026: "gesamt analyse der
  // einzelnen analysierten youtube beitraege") -- laeuft ueber
  // runTileAnalysis() (tileConfig.ts), Kontext aus den zuletzt gespeicherten
  // Einzelanalysen (app/api/youtube-monitor/overall-analysis/route.ts).
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

  // --- System-Briefing (Umsetzungsplan Phase 4, 18.09.2026; erweitert
  // 22.09.2026 um Marktkontext/ETF-Flows/Positionierung/News) -------------
  // 30.09.2026 -- komplett neu strukturiert UND mit der vormals eigenstaendigen
  // Handelslage-Kachel (Phase 3, 05.09.2026) zusammengelegt (Nutzer: "brauche
  // nicht weitere Kacheln, moechte vorhandenes komprimieren"). Vorher: ein
  // einzelner 7-11-Saetze-Fliesstext ("narrative"), der u.a. GUSS/VWAP-Vector/
  // CVD gegen Salomon-Phase gegen Regime Matrix abglich -- drei Perspektiven
  // auf groesstenteils dieselben Rohwerte (siehe Chat-Verlauf, Redundanz-
  // Analyse), dazu Handelslage als komplett separate Kachel fuer denselben
  // "was jetzt"-Zweck. Jetzt: VIER klar benannte Abschnitte statt einem Block,
  // Salomon-Phase/Regime Matrix als eigene Quellen entfernt (stehen bereits in
  // der Marktphase-Kachel), bewegungsvorrat (Handelslage) ist Bestandteil von
  // lib/systemBriefingContext.ts geworden. Kursziel/Trigger-Sprache ist jetzt
  // explizit erlaubt (Nutzer-Entscheidung 30.09.2026, vorher verboten) --
  // dieselbe Sprache, die Trade-Debate (siehe unten) schon laenger nutzt.
  //
  // 02.10.2026 -- Kachel-Audit (Nutzer: "braucht es alle Kacheln so wie sie
  // sind?"): die vormals eigenstaendige "Signal-Engine"-Kachel (Konsistenz-
  // Check "passt overall_state/score/risk_level zu den einzelnen Faktoren?")
  // war 13 Tage ungenutzt und wurde komplett entfernt -- ihr Zweck ist jetzt
  // Teil des kontextCheck-Abschnitts hier (market_state enthaelt dafuer neu
  // auch factors), kein zusaetzlicher AI-Aufruf noetig. Die Eskalations-
  // Kachel liest ihren entsprechenden Trigger seither aus DIESEM Snapshot
  // statt aus einem separaten signal_engine_snapshots-Eintrag (siehe
  // lib/escalationContext.ts).
  // 06.10.2026 -- Zusammengelegt mit der vormals eigenstaendigen Chart-
  // Narrativ-Kachel (Nutzer-Audit "welche Reports sind sehr aehnlich?":
  // beide nutzten bereits denselben breiten Signal-Satz und erzeugten ein
  // sehr aehnlich geformtes Ergebnis bias/confidence/Narrativ/Szenario+
  // Kursziel/Invalidierung -- nur mit unterschiedlicher Linse, Regelwerk-
  // Gates hier vs. Chart-Formationen/Key Levels dort). Jetzt EIN Profil mit
  // fuenf Abschnitten statt vier: Fazit, Regelwerk-Check (unveraendert),
  // NEU Chart-Struktur (Formationen/Key Levels/Level-Struktur, vormals
  // "structureNarrative" in der Chart-Narrativ-Kachel), Konfluenz-Check
  // (zusammengefuehrter kontextCheck + confluence -- beide fragten im Kern
  // dasselbe: widerspricht etwas dem bisherigen Bild?), und Trigger&Szenario
  // JETZT IMMER BEIDE RICHTUNGEN (bullish+bearish, Nutzer-Entscheidung per
  // AskUserQuestion) statt nur eines Pfads -- Kursziel in beiden Richtungen
  // zwingend an ein echtes keyLevels-Level gebunden (ersetzt die alte, vagere
  // "liquidations/mein_system_checklist"-Herleitung: keyLevels fasst Pivot-,
  // Liquidations- UND EMA/VWAP-Konfluenz bereits zusammen, ist die strengere
  // Obermenge). lib/systemBriefingContext.ts liefert die Chart-Strukturdaten
  // jetzt direkt mit (kein eigener chartNarrativeContext.ts-Umweg mehr).
  "system-briefing": {
    id: "system-briefing",
    category: "signal-logic",
    description:
      "Fuenf Abschnitte: Fazit, Regelwerk-Check, Chart-Struktur (Formationen/Key Levels/Level-Struktur), optionaler Konfluenz-Check bei Widerspruch, Trigger&Szenario (bullish+bearish) inkl. Kursziel.",
    systemPrompt:
      // 07.10.2026 -- gekuerzt (Nutzer-Entscheidung per AskUserQuestion, nach
      // Live-Vorfall: Vercel Hobby-Plan erlaubt max. 60s/Funktionsaufruf, die
      // Route scheiterte nach der Zusammenlegung mit Chart-Narrativ bei JEDEM
      // Versuch exakt bei 60s -- kein DB-Problem (parallel, moderate Mengen),
      // sondern die laengere Generierung fuer den groesseren Prompt/Output.
      // Funktionsumfang (5 Abschnitte, beide Richtungen) bleibt unveraendert,
      // nur knapper formuliert -- jede einzelne Regel von vorher ist noch da.
      "Daten: regelwerk (Tobys Welz-/Salomon-/'Mein Trading System'-Regelwerk, Array " +
      "module/section/title/content); LIVE-Stand (bewegungsvorrat.ratio_pct: heutige " +
      "Tagesspanne vs. Median 10 Tage, deutlich >100 = Tagespensum ausgeschoepft; " +
      "mein_system_checklist: Funding/OI/EMA13-50-200-Gates + closePrice; " +
      "trading_indicators: GUSS/VWAP-Vector/CVD, EINZIGE Orderflow-Quelle, nicht mit " +
      "market_state.factors doppeln; market_state: overall_state/score/confidence/" +
      "risk_level/patterns + factors (nur zum Abgleich, ob Aggregat zu den Einzelwerten " +
      "passt, nicht einzeln aufzaehlen); liquidations: Preis-Cluster nahe Kurs; " +
      "market_context/etf_flows/positioning/news: kurz); Chart-Struktur: triangle " +
      "(ascending/descending/symmetric + upperValue/lowerValue, null = keins), " +
      "continuationFormation (flag/pennant/wedge + poleDirection, null = keine), " +
      "swingFormations (double_top/bottom/head_and_shoulders + direction/necklineValue/" +
      "confirmed), recentCandlestickPatterns, keyLevels (price/side/timeframes/" +
      "confirmedBy -- mehr confirmedBy-Eintraege = staerkere Konfluenz), levelStruktur " +
      "(je Key Level: phase respecting/broken, fertiger narrative-Satz, confluenceTier 1-3). " +
      "Alles davon steht dem Nutzer schon einzeln in eigenen Kacheln -- nicht " +
      "nacherzaehlen, sondern Regelwerk anwenden und zu einem Urteil verdichten. " +
      "Antworte in GENAU FUENF Abschnitten: " +
      "(1) fazit: bias (bullish/bearish/neutral, nur bei echter Richtung, sonst neutral), " +
      "confidence (0-100), kernaussage (1-2 Saetze). Erster Satz darf bias nicht " +
      "widersprechen (bei neutral nicht unqualifiziert 'bullisch/baerisch' eroeffnen, " +
      "sondern die Gemengelage selbst benennen). " +
      "(2) regelwerkCheck: max. 4 Zeilen 'Label: Befund', getrennt durch \\n, nur " +
      "befuellte Zeilen. 'Gates: ...' (Funding/OI/EMA13-50-200-Gates erfuellt? immer). " +
      "'Orderflow: ...' (VWAP-Vector/CVD gleiche Richtung? immer; GUSS nur erwaehnen " +
      "wenn guss.regimeAllowsGuss=true, sonst komplett weglassen, kein 'n/a'-Rauschen). " +
      "'Bewegungsvorrat: ...' nur wenn ratio_pct deutlich >100. 'Liquidation: ...' nur " +
      "bei relevantem Cluster nahe Kurs. " +
      "(3) chartStruktur: 2-4 Saetze -- welche Formation (falls vorhanden), Kurs vs. " +
      "naechste keyLevels, levelStruktur-Status (haelt/gebrochen). Keine Formation " +
      "erkannt? Das explizit sagen statt eine hineinzuinterpretieren. " +
      "(4) konfluenzCheck: NUR befuellen bei echtem Widerspruch -- market_context/" +
      "etf_flows/positioning/news vs. regelwerkCheck/chartStruktur, ODER market_state-" +
      "Aggregat vs. factors, ODER chartStruktur vs. regelwerkCheck. 1-2 Saetze, welcher " +
      "Widerspruch. Sonst null, keine erzwungene Erwaehnung. " +
      "(5) trigger: bullish und bearish, je { bedingungen: string[] (wenn/dann-Saetze, " +
      "an ein Regelwerk-Gate ODER ein keyLevels-Level gebunden), kursziel: Zahl oder " +
      "null }. kursziel MUSS null sein oder EXAKT einem keyLevels-price entsprechen, nie " +
      "frei berechnet, und ist NICHT der Trigger-Preis selbst, sondern das naechste " +
      "sinnvolle Level dahinter. Kein plausibles Szenario fuer eine Richtung? Dann " +
      "bedingungen leer und kursziel null fuer diese Richtung, nicht erzwingen. Dazu " +
      "invalidierung (string, fuer beide Richtungen gemeinsam). " +
      "Regelwerk nur als Referenz, keine neuen Regeln erfinden, keine Daten ausserhalb " +
      "des Kontexts. market_state null? Das in regelwerkCheck explizit sagen. " +
      NUMBER_FORMAT_INSTRUCTION +
      " JSON: fazit ({ bias, confidence, kernaussage }), regelwerkCheck (string), " +
      "chartStruktur (string), konfluenzCheck (string oder null), trigger " +
      "({ bullish: { bedingungen: string[], kursziel: Zahl oder null }, bearish: { " +
      "bedingungen: string[], kursziel: Zahl oder null }, invalidierung: string }).",
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
      if (!isNonEmptyString(field(data, "regelwerkCheck"))) {
        errors.push(`"regelwerkCheck" muss ein nicht-leerer String sein.`);
      }
      if (!isNonEmptyString(field(data, "chartStruktur"))) {
        errors.push(`"chartStruktur" muss ein nicht-leerer String sein.`);
      }
      const konfluenzCheck = field(data, "konfluenzCheck");
      if (konfluenzCheck !== null && !isNonEmptyString(konfluenzCheck)) {
        errors.push(`"konfluenzCheck" muss ein nicht-leerer String oder null sein.`);
      }
      const trigger = field(data, "trigger");
      for (const key of ["bullish", "bearish"] as const) {
        const scenario = field(trigger, key);
        if (!isStringArray(field(scenario, "bedingungen"))) {
          errors.push(`"trigger.${key}.bedingungen" muss ein String-Array sein.`);
        }
        if (!isNullableFiniteNumber(field(scenario, "kursziel"))) {
          errors.push(`"trigger.${key}.kursziel" muss eine Zahl oder null sein.`);
        }
      }
      if (!isNonEmptyString(field(trigger, "invalidierung"))) {
        errors.push(`"trigger.invalidierung" muss ein nicht-leerer String sein.`);
      }
      return errors;
    },
  },

  // --- Eskalations-Kachel ("gezielte Eskalation", 05.09.2026) --------------
  // Wird NICHT ueber "auto" geroutet, sondern von app/api/escalation/
  // generate/route.ts mit mehreren expliziten providerOverride-Werten
  // parallel aufgerufen (siehe lib/escalationContext.ts fuer die
  // Trigger-Erkennung: nur wenn Signal-Engine/Divergenz-Radar/Report-Master
  // bereits einen Widerspruch melden). Jeder Provider bekommt DIESELBE
  // rohe Gesamteinschaetzung und liefert unabhaengig bias/confidence/
  // summary -- die Auswertung (Konsens/Divergenz zwischen den Providern)
  // passiert danach rein regelbasiert in lib/escalationConsensus.ts, nicht
  // durch ein weiteres Modell.
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

  // --- Trade-Debate-Kachel (Nutzer-Idee 07.09.2026, nach TradingAgents-
  // Architektur [arXiv:2412.20138] recherchiert) -----------------------------
  // Zwei gegensaetzlich geprompte Analysten (Bull/Bear) + ein Referee/CIO.
  // Werden NICHT ueber "auto" geroutet, sondern von app/api/trade-debate/
  // generate/route.ts mit expliziten providerOverride-Werten aufgerufen
  // (siehe tileConfig.ts trade-debate-bull/-bear/-referee) -- unterschiedliche
  // Vendors fuer Bull/Bear, damit nicht derselbe Modell-Bias in beiden
  // "Seiten" steckt. Beide Analysten bekommen DENSELBEN Marktdaten-Kontext
  // (lib/tradeDebateContext.ts) mit unterschiedlichem System-Prompt --
  // strukturierte Zahlen, kein Chart-Bild (Recherche 07.09.2026: reduziert
  // Halluzination nachweislich).
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

  // Freie-Anfrage-Kachel (Nutzer-Wunsch 08.09.2026): einziges Profil ohne
  // festen Zweck -- der Kontext traegt "user_task" (Freitext des Nutzers)
  // getrennt von "market_data" (derselbe validierte Kontext wie die
  // Report-Engine). Die Aufgabe im Kontext, nicht der System-Prompt, legt
  // fest, WAS beantwortet wird; der System-Prompt legt nur die Leitplanken
  // fest (nur market_data nutzen, nichts erfinden).
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
