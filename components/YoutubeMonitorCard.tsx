"use client";

import { useState } from "react";
import type { YoutubeVideoAnalysis } from "@/lib/types";
import { RelativeTime } from "@/components/ClientTimestamp";
import PanelInfo from "@/components/PanelInfo";

// Krypto-YouTube-Monitor, Thema KI (05.09.2026) -- findet neue BTC/Krypto-
// relevante YouTube-Videos (YouTube Data API v3, kostenloses Tages-
// kontingent) und laesst sie per Gemini direkt per Video-URL analysieren
// (Google-Free-Tier, siehe lib/ai/youtubeVideoAnalysis.ts). Zeigt
// ausschliesslich bereits gespeicherte Analysen an -- ein neuer Suchlauf
// passiert nur auf Klick.

const INFO_TEXT = [
  "Was das ist: sucht per YouTube-Suche nach kuerzlich veroeffentlichten Videos zu 'Bitcoin BTC' (letzte 24h) und laesst neue, noch nicht analysierte Videos per Gemini direkt anhand der Video-URL auswerten (Bild+Ton, kein Transkript-Umweg) -- keine kuratierte Kanal-Liste, sondern eine offene Stichprobe.",
  "Kostenlos: sowohl die YouTube-Suche (Google-Gratiskontingent) als auch die Gemini-Video-Analyse (Google-Free-Tier, Flash-Modelle) laufen ohne Kreditkarte -- pro Lauf werden aber nur wenige neue Videos analysiert (Kostenkontrolle ueber das Free-Tier-Anfragelimit).",
  "Rohe Stichprobe, kein kuratierter Feed: YouTube-Suche findet nicht jedes relevante Video und kann auch Off-Topic-Treffer liefern (dafuer gibt es das relevance-Feld). Kein Handelssignal -- die im Video vertretene Meinung ist nicht Nexus' eigene Einschaetzung.",
  "Wird NICHT automatisch aktualisiert -- ein neuer Suchlauf entsteht nur per Klick auf \"Neu pruefen\".",
].join("\n\n");

const BIAS_STYLES: Record<string, string> = {
  bullish: "border-up/40 bg-up/10 text-up",
  bearish: "border-down/40 bg-down/10 text-down",
  neutral: "border-border text-text-faint",
};

const BIAS_LABELS: Record<string, string> = {
  bullish: "Bullish",
  bearish: "Bearish",
  neutral: "Neutral",
};

const RELEVANCE_LABELS: Record<string, string> = {
  high: "Hoch relevant",
  medium: "Mittel relevant",
  low: "Kaum relevant",
};

export default function YoutubeMonitorCard({
  initialAnalyses,
}: {
  initialAnalyses: YoutubeVideoAnalysis[];
}) {
  const [analyses, setAnalyses] = useState(initialAnalyses);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setStatusNote(null);
    try {
      const res = await fetch("/api/youtube-monitor/generate", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setStatusNote(`${json.analyzed} von ${json.checked} neuen Videos analysiert.`);

      const newAnalyses = json.newAnalyses as YoutubeVideoAnalysis[];
      if (newAnalyses.length > 0) {
        setAnalyses((prev) => [...newAnalyses, ...prev].slice(0, 8));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-text">Krypto-YouTube-Monitor (KI)</p>
          <PanelInfo title="Krypto-YouTube-Monitor (KI)" content={INFO_TEXT} />
        </span>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="px-3 py-1.5 text-xs rounded-md border border-border text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? "Prüft…" : "Neu prüfen"}
        </button>
      </div>

      {statusNote && <p className="text-xs text-text-faint">{statusNote}</p>}
      {error && <p className="text-xs text-down">{error}</p>}

      {analyses.length === 0 && !error && (
        <p className="text-xs text-text-faint">Noch keine Videos analysiert.</p>
      )}

      <div className="space-y-2">
        {analyses.map((a) => (
          <div key={a.id} className="rounded-md border border-border/60 p-2.5 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-text hover:underline"
              >
                {a.title}
              </a>
              {a.result && (
                <span
                  className={`shrink-0 px-1.5 py-0.5 text-[10px] rounded-md border font-medium ${
                    BIAS_STYLES[a.result.bias] ?? BIAS_STYLES.neutral
                  }`}
                >
                  {BIAS_LABELS[a.result.bias] ?? a.result.bias}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-text-faint flex-wrap">
              {a.channel_title && <span>{a.channel_title}</span>}
              <RelativeTime iso={a.published_at} />
              {a.result && <span>· {RELEVANCE_LABELS[a.result.relevance] ?? a.result.relevance}</span>}
            </div>
            {a.status === "ok" && a.result && (
              <p className="text-xs text-text-faint">{a.result.summary}</p>
            )}
            {a.status === "error" && (
              <p className="text-xs text-down">{a.error ?? "Analyse fehlgeschlagen."}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
