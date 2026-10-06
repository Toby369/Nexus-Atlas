import { getChartStructureData, withConfirmationLevels, type ChartStructureData, type KeyLevel } from "./chartStructureContext";
import { getLevelStructureData, type LevelStructureZone } from "./levelStructureContext";
import { buildSystemBriefingContext, type SystemBriefingContext } from "./systemBriefingContext";

// Chart-Narrativ-Report (Nutzer-Wunsch 06.10.2026, Vorbild: ein von Gemini
// per Screenshot erstellter Bull-/Bear-Szenario-Bericht mit Key Levels,
// Dreieck/Keil-Muster und Kurszielen). Bewusst NICHT vision-basiert (siehe
// systemBriefingContext.ts-Kommentar: "Chart-Vision" wurde am 25.09.2026
// entfernt, durch die algorithmische Struktur-Kachel ueberholt) -- die
// Formationen (Dreieck/Flagge/Wimpel/Keil), Key Levels und Level-Struktur
// (haelt/gebrochen) sind bereits aus echten Kerzendaten berechnet, keine
// Pixel-Schaetzung. Zusaetzlich (Nutzer-Wunsch: "auch die anderen Daten/
// Signale miteinbeziehen") der komplette breite Signal-Satz aus
// buildSystemBriefingContext() (14-Faktoren-Engine, CVD/VWAP/GUSS,
// Liquidations, Marktkontext, ETF-Flows, Positionierung, News) --
// wiederverwendet, kein zweiter Rechenweg.
//
// Auf Knopfdruck (Nutzer-Entscheidung, siehe AskUserQuestion 06.10.2026),
// kein Zeitplan -- wie YouTube-Gesamtanalyse/Eskalation, kein Gratis-Tier-
// Verbrauch im Hintergrund.
//
// Server-only (nutzt Supabase direkt) -- niemals aus einer "use client"
// Komponente importieren.

export interface ChartNarrativeContext {
  generated_at: string;
  currentPrice: number | null;
  dataAsOf: string | null;
  triangle: ChartStructureData["triangle"];
  continuationFormation: ChartStructureData["continuationFormation"];
  swingFormations: ChartStructureData["swingFormations"];
  // Nur die juengsten 5 -- aeltere Kerzenmuster sind fuer eine "wie steht's
  // GERADE"-Analyse ohnehin nicht mehr relevant (gleiche Begrenzung wie bei
  // anderen Kontext-Bausteinen, z.B. TOP_CLUSTERS_COUNT in
  // systemBriefingContext.ts).
  recentCandlestickPatterns: ChartStructureData["candlestickPatterns"];
  keyLevels: KeyLevel[];
  // signalTally bewusst weggelassen -- die zugrunde liegenden Signale
  // (CVD-Trend, Warn-Muster, MTF-Ampel) stehen bereits vollstaendig im
  // broaderSignals-Block, eine zweite Zaehlung waere Dopplung im Kontext.
  levelStruktur: Array<Omit<LevelStructureZone, "signalTally">>;
  broaderSignals: SystemBriefingContext;
}

export async function buildChartNarrativeContext(): Promise<ChartNarrativeContext> {
  const [chartStructure, broaderSignals] = await Promise.all([
    getChartStructureData(),
    buildSystemBriefingContext(),
  ]);

  // Dieselbe Anreicherung wie app/lernen/page.tsx (chartStructureEnriched)
  // -- EMA13/50/200 und VWAP-Vector sind in broaderSignals bereits geladen,
  // kein zweiter Fetch.
  const chartStructureEnriched = withConfirmationLevels(chartStructure, [
    { label: "ema13", price: broaderSignals.mein_system_checklist.ema13 },
    { label: "ema50", price: broaderSignals.mein_system_checklist.ema50 },
    { label: "ema200", price: broaderSignals.mein_system_checklist.ema200 },
    { label: "vwap_daily", price: broaderSignals.trading_indicators.vwapVector.dayVwap },
    { label: "vwap_weekly", price: broaderSignals.trading_indicators.vwapVector.weeklyVwap },
    { label: "vwap_swing_high", price: broaderSignals.trading_indicators.vwapVector.swingHighVwap },
    { label: "vwap_swing_low", price: broaderSignals.trading_indicators.vwapVector.swingLowVwap },
  ]);

  const levelStructureZones = await getLevelStructureData(
    chartStructureEnriched.keyLevels,
    broaderSignals.trading_indicators.cvd.trend
  );

  return {
    generated_at: new Date().toISOString(),
    currentPrice: chartStructureEnriched.currentPrice,
    dataAsOf: chartStructureEnriched.dataAsOf,
    triangle: chartStructureEnriched.triangle,
    continuationFormation: chartStructureEnriched.continuationFormation,
    swingFormations: chartStructureEnriched.swingFormations,
    recentCandlestickPatterns: chartStructureEnriched.candlestickPatterns.slice(-5),
    keyLevels: chartStructureEnriched.keyLevels,
    levelStruktur: levelStructureZones.map((zone) => {
      const { signalTally, ...rest } = zone;
      void signalTally;
      return rest;
    }),
    broaderSignals,
  };
}
