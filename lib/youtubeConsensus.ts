// Kanal-Vergleich fuer den Krypto-YouTube-Monitor (Nutzer-Wunsch 08.09.2026:
// "er soll Kanal Info vergleichen und mir mitteilen, wo Einigkeit oder
// komplett andere Meinung"). Reine Funktion, keine DB-/Netzwerk-Zugriffe --
// bewusst so, damit sie sowohl serverseitig (app/page.tsx) als auch
// clientseitig (YoutubeMonitorCard.tsx nach einem neuen Lauf) mit denselben
// bereits geladenen Analysen aufgerufen werden kann, ohne Code zu
// duplizieren.
//
// Vergleicht NICHT "die letzten N Videos", sondern die JEWEILS NEUESTE
// erfolgreiche Analyse PRO konfiguriertem Kanal -- sonst wuerde ein Kanal,
// der oft postet, die anderen aus der Liste verdraengen und der Vergleich
// waere kein Kanal-Vergleich mehr, sondern nur "juengste Videos zufaellig
// welcher Kanaele".

import type { YoutubeVideoAnalysis, YoutubeVideoAnalysisResult } from "./types";

export interface YoutubeChannelTake {
  channelTitle: string;
  bias: YoutubeVideoAnalysisResult["bias"];
  confidence: number;
  relevance: YoutubeVideoAnalysisResult["relevance"];
  summary: string;
  videoTitle: string;
  url: string;
  publishedAt: string;
}

export type YoutubeAgreementLevel = "einig" | "mehrheitlich" | "gespalten";

export interface YoutubeConsensusResult {
  channelsCompared: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  majorityBias: YoutubeVideoAnalysisResult["bias"] | null;
  agreementLevel: YoutubeAgreementLevel;
  /** Kanaele, deren Einschaetzung von der Mehrheit abweicht -- leer bei "einig". */
  outliers: YoutubeChannelTake[];
  takes: YoutubeChannelTake[];
}

const MIN_CHANNELS_FOR_COMPARISON = 2;

/** Neueste erfolgreiche Analyse je Kanal, sortiert nach Erscheinungsdatum absteigend. */
export function latestTakePerChannel(analyses: YoutubeVideoAnalysis[]): YoutubeChannelTake[] {
  const sorted = [...analyses].sort(
    (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
  );

  const seen = new Set<string>();
  const takes: YoutubeChannelTake[] = [];
  for (const a of sorted) {
    if (a.status !== "ok" || !a.result || !a.channel_title) continue;
    if (seen.has(a.channel_title)) continue;
    seen.add(a.channel_title);
    takes.push({
      channelTitle: a.channel_title,
      bias: a.result.bias,
      confidence: a.result.confidence,
      relevance: a.result.relevance,
      summary: a.result.summary,
      videoTitle: a.title,
      url: a.url,
      publishedAt: a.published_at,
    });
  }
  return takes;
}

/**
 * Vergleicht die aktuellsten Kanal-Einschaetzungen. Gibt null zurueck, wenn
 * weniger als 2 Kanaele eine erfolgreiche Analyse haben -- ein Vergleich mit
 * nur einem Kanal waere keine Aussage ueber Einigkeit/Uneinigkeit.
 */
export function computeYoutubeConsensus(
  analyses: YoutubeVideoAnalysis[]
): YoutubeConsensusResult | null {
  const takes = latestTakePerChannel(analyses);
  if (takes.length < MIN_CHANNELS_FOR_COMPARISON) return null;

  const bullish = takes.filter((t) => t.bias === "bullish");
  const bearish = takes.filter((t) => t.bias === "bearish");
  const neutral = takes.filter((t) => t.bias === "neutral");

  const counts: Array<[YoutubeVideoAnalysisResult["bias"], YoutubeChannelTake[]]> = [
    ["bullish", bullish],
    ["bearish", bearish],
    ["neutral", neutral],
  ];
  const maxCount = Math.max(bullish.length, bearish.length, neutral.length);
  const leaders = counts.filter(([, group]) => group.length === maxCount);

  let agreementLevel: YoutubeAgreementLevel;
  let majorityBias: YoutubeVideoAnalysisResult["bias"] | null;
  let outliers: YoutubeChannelTake[];

  if (maxCount === takes.length) {
    // Alle Kanaele stimmen ueberein.
    agreementLevel = "einig";
    majorityBias = leaders[0][0];
    outliers = [];
  } else if (leaders.length > 1) {
    // Gleichstand zwischen mind. zwei Lagern (z.B. 3 bullish vs. 3 bearish) --
    // es gibt keine Mehrheit, die eine Seite als "Ausreisser" markieren
    // koennte.
    agreementLevel = "gespalten";
    majorityBias = null;
    outliers = [];
  } else {
    agreementLevel = "mehrheitlich";
    majorityBias = leaders[0][0];
    outliers = takes.filter((t) => t.bias !== majorityBias);
  }

  return {
    channelsCompared: takes.length,
    bullishCount: bullish.length,
    bearishCount: bearish.length,
    neutralCount: neutral.length,
    majorityBias,
    agreementLevel,
    outliers,
    takes,
  };
}
