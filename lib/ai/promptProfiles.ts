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
  "signal-analysis": {
    id: "signal-analysis",
    category: "signal-logic",
    description: "Logik-/Konsistenzprüfung eines abgeleiteten Trading-Signals.",
    systemPrompt:
      "Du prüfst ein abgeleitetes Trading-Signal auf logische Konsistenz mit den " +
      "zugrunde liegenden Daten (Preis, OI, Funding). Antworte als JSON mit: " +
      "isConsistent (boolean), confidence (0-100), summary (string, deutsch), " +
      "concerns (string[]).",
    validate: validateSignalAnalysis,
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
};

export function getPromptProfile(id: string): PromptProfile {
  const profile = promptProfiles[id];
  if (!profile) {
    throw new Error(`Unbekanntes Prompt Profile: ${id}`);
  }
  return profile;
}
