import type { PromptProfile } from "./types";

// Prompt Profiles liegen zentral hier statt in einzelnen UI-Komponenten.
// Aendert sich ein Analyse-Prompt, wird NUR diese Datei angepasst – keine
// Dashboard-Kachel muss dafür angefasst werden.
//
// Die Markteinschätzungs-Box läuft weiterhin regelbasiert (siehe
// supabase/functions/compute-market-state) -- die meisten Profile hier sind
// vorbereitetes Fundament ohne UI-Anbindung. "handelslage" (Umsetzungsplan
// Phase 3, 05.09.2026) ist die erste produktiv über runTileAnalysis()
// aufgerufene Kachel; report-* laufen seit der AI Report Engine bereits
// produktiv über runReportAnalysis().

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

  return errors;
}

export const promptProfiles: Record<string, PromptProfile> = {
  "oi-analysis": {
    id: "oi-analysis",
    category: "market-mechanics",
    description: "Interpretation von Open-Interest-Bewegungen relativ zu Preis und Funding.",
    systemPrompt:
      "Du analysierst Open-Interest-Daten für BTC/USDT Perpetual Futures. " +
      "Ordne die OI-Bewegung im Verhältnis zu Preis und Funding ein (Positionsaufbau, " +
      "-abbau, Short-Covering, Long-Liquidation). Formuliere Wahrscheinlichkeiten, keine " +
      "Fakten. Antworte als JSON mit den Feldern: bias (bullish|bearish|neutral), " +
      "confidence (0-100), summary (string, deutsch), keyFactors (string[]).",
    validate: (data) => validateBiasSummary(data, { requireKeyFactors: true }),
  },
  "funding-analysis": {
    id: "funding-analysis",
    category: "market-mechanics",
    description: "Einordnung der Funding-Rate-Situation und was sie für Positionierung bedeutet.",
    systemPrompt:
      "Du analysierst die Funding Rate von BTC/USDT Perpetual Futures über mehrere " +
      "Börsen hinweg. Ordne ein, ob der Markt eher long- oder short-lastig positioniert " +
      "ist und ob Abweichungen zwischen Börsen auffällig sind. Antworte als JSON mit: " +
      "bias (bullish|bearish|neutral), confidence (0-100), summary (string, deutsch), " +
      "keyFactors (string[]).",
    validate: (data) => validateBiasSummary(data, { requireKeyFactors: true }),
  },
  "liquidation-analysis": {
    id: "liquidation-analysis",
    category: "market-mechanics",
    description: "Einordnung von Liquidationsereignissen (Größe, Richtung, Häufung).",
    systemPrompt:
      "Du analysierst BTC-Futures-Liquidationsdaten. Ordne ein, ob es sich um vereinzelte " +
      "Liquidationen oder eine Häufung (Cascade) handelt und in welche Richtung " +
      "(Long/Short) sie überwiegen. Antworte als JSON mit: bias (bullish|bearish|neutral), " +
      "confidence (0-100), summary (string, deutsch), keyFactors (string[]).",
    validate: (data) => validateBiasSummary(data, { requireKeyFactors: true }),
  },
  "market-structure": {
    id: "market-structure",
    category: "market-mechanics",
    description: "Gesamtbild aus Preis, OI, Funding und Liquidationen über mehrere Börsen.",
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
  "macro-analysis": {
    id: "macro-analysis",
    category: "research",
    description: "Fed, CPI, ETF-Flows und geopolitische Faktoren mit BTC-Relevanz.",
    systemPrompt:
      "Du bewertest makroökonomische Faktoren (Fed-Politik, CPI, ETF-Flows, Geopolitik) " +
      "auf ihre Relevanz für den BTC-Markt. Antworte als JSON mit: bias " +
      "(risk-on|risk-off|neutral), confidence (0-100), summary (string, deutsch), " +
      "keyFactors (string[]).",
    validate: (data) =>
      validateBiasSummary(data, { biasValues: RISK_ON_OFF, requireKeyFactors: true }),
  },
  "etf-analysis": {
    id: "etf-analysis",
    category: "research",
    description: "Einordnung von BTC-ETF-Zu-/Abflüssen.",
    systemPrompt:
      "Du analysierst BTC-ETF-Flow-Daten. Ordne ein, ob Zuflüsse oder Abflüsse " +
      "überwiegen und was das für institutionelle Nachfrage bedeuten könnte. Antworte " +
      "als JSON mit: bias (bullish|bearish|neutral), confidence (0-100), summary (string, " +
      "deutsch).",
    validate: (data) => validateBiasSummary(data),
  },
  "market-intelligence": {
    id: "market-intelligence",
    category: "orchestration",
    description: "Gesamtbewertung, die mehrere Einzelanalysen zusammenführt.",
    systemPrompt:
      "Du führst mehrere Einzelanalysen (Marktstruktur, News, Makro) zu einer " +
      "Gesamtbewertung für BTC/USDT Futures zusammen. Antworte als JSON mit: " +
      "overallBias (bullish|bearish|neutral), confidence (0-100), summary (string, " +
      "deutsch), riskLevel (low|medium|high).",
    validate: (data) =>
      validateBiasSummary(data, { biasField: "overallBias", requireRiskLevel: true }),
  },
  // --- Signal Engine (Thema KI, Punkt 2/2, 05.09.2026) ---------------------
  // Kein neuer Bias -- prueft, ob die bereits bestehende, regelbasierte
  // Gesamteinschaetzung (14-Faktoren-Engine, market_states) in sich logisch
  // konsistent ist: passt overall_state/score/confidence zur Mehrheit der
  // einzelnen Faktor-Werte, widerspricht ein Muster (patterns) der Richtung,
  // ist eine hohe confidence mit niedrigem consensus_pct erklaerbar? Kontext
  // aus lib/signalEngineContext.ts (buildSignalEngineContext).
  "signal-analysis": {
    id: "signal-analysis",
    category: "signal-logic",
    description:
      "Konsistenzpruefung der bestehenden regelbasierten Gesamteinschaetzung (14-Faktoren-Engine) -- kein neuer Bias, sondern ein zweites Paar Augen auf deren eigene Ausgabe.",
    systemPrompt:
      "Du bekommst die aktuelle Ausgabe der regelbasierten 14-Faktoren-Marktzustands-Engine " +
      "fuer BTC/USDT-Futures (market_states): overall_state, score, confidence samt " +
      "confidence_breakdown (coverage_pct/consensus_pct/signal_strength_pct), risk_level, " +
      "risk_factors, patterns und die einzelnen factors (je -1/baerisch, 0/neutral, " +
      "+1/bullisch, oder null wenn keine Daten, mit basis-Feldern als Beleg). Deine Aufgabe " +
      "ist NICHT, selbst eine neue Marktrichtung zu bestimmen, sondern zu pruefen, ob diese " +
      "Ausgabe in sich WIDERSPRUCHSFREI ist. Beispiele fuer echte Widersprueche: " +
      "overall_state weicht von der Mehrheitsrichtung der verfuegbaren factors ab; ein " +
      "gemeldetes pattern deutet in eine andere Richtung als overall_state; confidence ist " +
      "hoch, obwohl consensus_pct niedrig ist (widerspruechliche Faktoren) oder " +
      "signal_strength_pct niedrig ist (fast alle Faktoren neutral); risk_level passt nicht " +
      "zu den genannten risk_factors. Ist alles stimmig, sag das explizit statt Widersprueche " +
      "zu konstruieren, die es nicht gibt -- concerns bleibt dann ein leeres Array. Erfinde " +
      "keine zusaetzlichen Daten ausserhalb des Kontexts. " +
      NUMBER_FORMAT_INSTRUCTION +
      " Antworte als JSON mit: isConsistent (boolean, true nur wenn KEIN Widerspruch " +
      "gefunden wurde), confidence (0-100, deine eigene Sicherheit in dieses Urteil), " +
      "summary (string, deutsch), concerns (string[], leer wenn keine Widersprueche).",
    validate: validateSignalAnalysis,
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
      "(das ist keine Trading-Kachel). Nenne robuste Funde (significant_after_bh=true in " +
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
      DATA_QUALITY_INSTRUCTION +
      NUMBER_FORMAT_INSTRUCTION +
      " Antworte als JSON mit: overallBias (bullish|bearish|neutral|conflicting), " +
      "confidence (0-100), summary (string, deutsch), conflicts (string[], leer wenn " +
      "keine), componentBiases ({ marketStructure, positioning, newsMacro } als kurze " +
      "String-Zusammenfassungen der jeweiligen Einzelrichtung).",
    validate: validateMasterReport,
  },

  // --- Umsetzungsplan Phase 3 (05.09.2026): Handelslage-KI-Kachel ----------
  // Eigenstaendig von der grossen AI Report Engine (report-*) und der
  // regelbasierten Gesamteinschaetzung: eine kurze "was halten die naechsten
  // Stunden bereit"-Einschaetzung, Kontext aus lib/handelslageContext.ts.
  // Laeuft ueber runTileAnalysis() (tileConfig.ts), nicht ueber
  // runReportAnalysis() -- es gibt keinen Nutzer-konfigurierbaren Slot dafuer.
  handelslage: {
    id: "handelslage",
    category: "signal-logic",
    description:
      "Kurzeinschaetzung 'was halten die naechsten Stunden bereit' anhand des Bewegungsvorrats -- kein Zyklus-/Tages-Report.",
    systemPrompt:
      "Du gibst eine kurze Einschaetzung fuer die naechsten Stunden im BTC/USDT-Futures-" +
      "Markt (NICHT: wo stehen wir im Zyklus -- das beantwortet eine andere Kachel). Die " +
      "wichtigste Kennzahl im Kontext ist bewegungsvorrat.ratio_pct: das Verhaeltnis der " +
      "heutigen Tagesspanne zum MEDIAN der letzten 10 abgeschlossenen Tage. Ein Wert " +
      "deutlich ueber 100 heisst, der Tag hat sein uebliches Bewegungspensum bereits " +
      "ausgeschoepft -- eine Fortsetzung derselben Bewegung ist dann unwahrscheinlicher, " +
      "unabhaengig davon wie sauber der Trend aussieht. Ist ratio_pct null, sag das explizit " +
      "statt eine Einschaetzung ohne diese Grundlage zu konstruieren. Nutze zusaetzlich " +
      "factors/overall_state/risk_level/patterns als Kontext, erfinde keine zusaetzlichen " +
      "Daten. Formuliere Bedingungen (wenn/dann, an eine konkrete Zahl oder ein konkretes " +
      "Ereignis gebunden) statt vager Aussagen -- keine Kursziele, keine Einstiegsempfehlung. " +
      "Nenne explizit, wodurch/ab wann deine Einschaetzung ungueltig wird. Gib zusaetzlich " +
      "bias an: bullish/bearish nur, wenn deine Einschaetzung tatsaechlich eine Richtung " +
      "fuer die naechsten Stunden nahelegt, sonst neutral -- keine erzwungene Richtung nur " +
      "um das Feld zu befuellen. " +
      NUMBER_FORMAT_INSTRUCTION +
      " Antworte als JSON mit: einschaetzung (string, deutsch, 2-4 Saetze), bedingungen " +
      "(string[], je Eintrag ein wenn/dann-Satz), ungueltigWenn (string, deutsch), " +
      `bias (einer von ${BIAS_3.join("/")}).`,
    validate: (data) => {
      const errors: string[] = [];
      if (!isNonEmptyString(field(data, "einschaetzung"))) {
        errors.push(`"einschaetzung" muss ein nicht-leerer String sein.`);
      }
      if (!isStringArray(field(data, "bedingungen"))) {
        errors.push(`"bedingungen" muss ein String-Array sein.`);
      }
      if (!isNonEmptyString(field(data, "ungueltigWenn"))) {
        errors.push(`"ungueltigWenn" muss ein nicht-leerer String sein.`);
      }
      if (!isEnum(field(data, "bias"), BIAS_3)) {
        errors.push(`"bias" muss einer von ${BIAS_3.join(", ")} sein.`);
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
