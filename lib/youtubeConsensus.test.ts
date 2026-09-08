import { describe, it, expect } from "vitest";
import { computeYoutubeConsensus, latestTakePerChannel } from "./youtubeConsensus";
import type { YoutubeVideoAnalysis, YoutubeVideoAnalysisResult } from "./types";

function analysis(
  channel: string,
  bias: YoutubeVideoAnalysisResult["bias"],
  overrides: Partial<YoutubeVideoAnalysis> = {}
): YoutubeVideoAnalysis {
  return {
    id: Math.floor(Math.random() * 1_000_000),
    video_id: `vid-${channel}-${Math.random()}`,
    channel_title: channel,
    title: `Video von ${channel}`,
    published_at: "2026-09-08T12:00:00.000Z",
    url: `https://www.youtube.com/watch?v=${channel}`,
    generated_at: "2026-09-08T12:05:00.000Z",
    model: "gemini-test",
    status: "ok",
    error: null,
    result: {
      bias,
      confidence: 70,
      relevance: "high",
      summary: `${channel} ist ${bias}.`,
    },
    ...overrides,
  };
}

describe("latestTakePerChannel", () => {
  it("dedupliziert nach Kanal und behaelt das juengste Video", () => {
    const takes = latestTakePerChannel([
      analysis("A", "bullish", { published_at: "2026-09-01T00:00:00.000Z", title: "alt" }),
      analysis("A", "bearish", { published_at: "2026-09-05T00:00:00.000Z", title: "neu" }),
    ]);
    expect(takes).toHaveLength(1);
    expect(takes[0].bias).toBe("bearish");
    expect(takes[0].videoTitle).toBe("neu");
  });

  it("ignoriert fehlgeschlagene Analysen und Analysen ohne Kanalnamen", () => {
    const takes = latestTakePerChannel([
      analysis("A", "bullish", { status: "error", result: null }),
      analysis("B", "bullish", { channel_title: null }),
      analysis("C", "neutral"),
    ]);
    expect(takes.map((t) => t.channelTitle)).toEqual(["C"]);
  });
});

describe("computeYoutubeConsensus", () => {
  it("liefert null bei weniger als 2 verglichenen Kanaelen", () => {
    expect(computeYoutubeConsensus([])).toBeNull();
    expect(computeYoutubeConsensus([analysis("A", "bullish")])).toBeNull();
  });

  it("erkennt 'einig' wenn alle Kanaele denselben bias haben", () => {
    const result = computeYoutubeConsensus([
      analysis("A", "bullish"),
      analysis("B", "bullish"),
      analysis("C", "bullish"),
    ]);
    expect(result?.agreementLevel).toBe("einig");
    expect(result?.majorityBias).toBe("bullish");
    expect(result?.outliers).toHaveLength(0);
    expect(result?.channelsCompared).toBe(3);
  });

  it("erkennt 'mehrheitlich' und benennt die abweichenden Kanaele", () => {
    const result = computeYoutubeConsensus([
      analysis("A", "bullish"),
      analysis("B", "bullish"),
      analysis("C", "bullish"),
      analysis("D", "bearish"),
    ]);
    expect(result?.agreementLevel).toBe("mehrheitlich");
    expect(result?.majorityBias).toBe("bullish");
    expect(result?.outliers.map((o) => o.channelTitle)).toEqual(["D"]);
  });

  it("erkennt 'gespalten' bei echtem Patt ohne Mehrheit", () => {
    const result = computeYoutubeConsensus([
      analysis("A", "bullish"),
      analysis("B", "bullish"),
      analysis("C", "bearish"),
      analysis("D", "bearish"),
    ]);
    expect(result?.agreementLevel).toBe("gespalten");
    expect(result?.majorityBias).toBeNull();
    expect(result?.outliers).toHaveLength(0);
  });

  it("zaehlt bullish/bearish/neutral korrekt", () => {
    const result = computeYoutubeConsensus([
      analysis("A", "bullish"),
      analysis("B", "bearish"),
      analysis("C", "neutral"),
    ]);
    expect(result?.bullishCount).toBe(1);
    expect(result?.bearishCount).toBe(1);
    expect(result?.neutralCount).toBe(1);
    expect(result?.agreementLevel).toBe("gespalten");
  });

  it("nutzt pro Kanal nur die juengste Analyse fuer den Vergleich", () => {
    const result = computeYoutubeConsensus([
      analysis("A", "bullish", { published_at: "2026-09-08T00:00:00.000Z" }),
      analysis("A", "bearish", { published_at: "2026-09-01T00:00:00.000Z" }),
      analysis("B", "bullish", { published_at: "2026-09-08T00:00:00.000Z" }),
    ]);
    expect(result?.agreementLevel).toBe("einig");
    expect(result?.majorityBias).toBe("bullish");
  });
});
