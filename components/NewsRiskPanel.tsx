"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { NewsAnalysisSnapshot, NewsEvent } from "@/lib/types";
import PanelInfo from "@/components/PanelInfo";
import { newsRiskInfo } from "@/lib/panelInfo";
import { FullDateTime, RelativeTime, StaleBadge } from "@/components/ClientTimestamp";

const REFRESH_INTERVAL_MS = 60_000;
const NEWS_LIMIT = 5;
const NEWS_LOOKBACK_HOURS = 72;

// 20.09.2026 -- vormals eigene Kachel "News-Einordnung (KI)": deckte
// dieselben Schlagzeilen ab wie dieses Panel (siehe eigener Info-Text
// unten: "keine zweite, unabhaengige Nachrichtenquelle und kein Ersatz").
// Aufgeklappter Abschnitt statt eigener Kachel -- eine Kachel weniger,
// Backend/API (/api/news-analysis/generate, news_analysis_snapshots)
// unveraendert.
const NEWS_ANALYSIS_INFO_TEXT = [
  "Was das ist: eine KI-Einordnung derselben Schlagzeilen oben -- keine zweite, unabhaengige Nachrichtenquelle und kein Ersatz fuer die regelbasierte Liste.",
  "Primaerer Provider ist Perplexity (einziger der bei Nexus angebundenen Anbieter mit echter Web-Suche) -- kann dadurch Kontext zu einer Schlagzeile ergaenzen, den die reine Klassifikation nicht zeigt. Faellt Perplexity aus, springt Google Gemini ein (ohne Live-Suche); das Modell darf dabei ausdruecklich keine Nachrichten erfinden, die nicht in der Liste stehen.",
  "Wird NICHT automatisch aktualisiert -- jeder neue Stand kostet einen bezahlten AI-Aufruf und entsteht nur per Klick auf \"Neu generieren\". Ohne markbewegende News der letzten 72h gibt es nichts zu analysieren (kein AI-Aufruf, kein Snapshot).",
  "Kein Handelssignal -- Einordnung/Kontext zu bereits bekannten Schlagzeilen, keine Vorhersage.",
].join("\n\n");

const IMPACT_STYLES: Record<string, string> = {
  high: "border-down/40 bg-down/10 text-down",
  medium: "border-accent/40 bg-accent/10 text-accent",
  low: "border-border text-text-faint",
};

const IMPACT_LABELS: Record<string, string> = {
  high: "Hoch",
  medium: "Mittel",
  low: "Niedrig",
};

const CATEGORY_LABELS: Record<string, string> = {
  fed: "Fed",
  treasury: "Treasury",
  cpi: "CPI",
  etf: "ETF",
  crypto: "Crypto",
  other: "Sonstiges",
};

const DIRECTION_STYLES: Record<string, string> = {
  bullish: "text-up",
  bearish: "text-down",
  neutral: "text-text-faint",
};

const DIRECTION_LABELS: Record<string, string> = {
  bullish: "positiv",
  bearish: "negativ",
  neutral: "neutral",
};

async function fetchHighImpactNews(): Promise<{
  data: NewsEvent[];
  ok: boolean;
}> {
  const cutoff = new Date(
    Date.now() - NEWS_LOOKBACK_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("news_events")
    .select("*")
    .eq("is_market_moving", true)
    .gte("published_at", cutoff)
    .order("published_at", { ascending: false })
    .limit(NEWS_LIMIT);

  if (error) {
    console.error("Fehler beim Laden der News:", error.message);
    return { data: [], ok: false };
  }
  return { data: data ?? [], ok: true };
}

export default function NewsRiskPanel({
  initialNews,
  initialNewsAnalysis,
}: {
  initialNews: NewsEvent[];
  initialNewsAnalysis: NewsAnalysisSnapshot | null;
}) {
  const [news, setNews] = useState(initialNews);
  const [lastSyncOk, setLastSyncOk] = useState(true);
  const [analysisExpanded, setAnalysisExpanded] = useState(false);
  const [analysisSnapshot, setAnalysisSnapshot] = useState(initialNewsAnalysis);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      const { data, ok } = await fetchHighImpactNews();
      setLastSyncOk(ok);
      if (ok) setNews(data);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  async function handleGenerateAnalysis() {
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const res = await fetch("/api/news-analysis/generate", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setAnalysisSnapshot(json.snapshot as NewsAnalysisSnapshot);
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalysisLoading(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">
          News &amp; Risiko
        </h2>
        <PanelInfo title="News & Risiko" content={newsRiskInfo} />
      </div>

      {!lastSyncOk && news.length > 0 && (
        <p className="text-xs text-down">
          Sync-Problem — zuletzt bekannte News werden angezeigt.
        </p>
      )}

      {news.length === 0 ? (
        <p className="text-sm text-text-faint">
          {lastSyncOk
            ? "Keine markbewegenden Ereignisse in den letzten 72h."
            : "Sync-Problem — News derzeit nicht verfügbar."}
        </p>
      ) : (
        <div className="space-y-3">
          {news.map((item) => (
            <div
              key={item.id}
              className="pb-3 border-b border-border last:border-0 last:pb-0"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-accent">
                  HIGH IMPACT
                </span>
                <span className="text-xs text-text-faint">
                  {CATEGORY_LABELS[item.category] ?? item.category}
                </span>
                <RelativeTime iso={item.published_at} className="text-xs text-text-faint ml-auto" />
              </div>
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-text leading-snug hover:underline"
                >
                  {item.title_de ?? item.title}
                </a>
              ) : (
                <span className="text-sm text-text leading-snug">
                  {item.title_de ?? item.title}
                </span>
              )}
              <div className="mt-1">
                <span
                  className={`text-xs font-mono ${
                    DIRECTION_STYLES[item.market_direction] ??
                    "text-text-faint"
                  }`}
                >
                  {DIRECTION_LABELS[item.market_direction] ?? item.market_direction}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-text-faint pt-1">
        Nur markbewegende Ereignisse der letzten 72h · regelbasierte
        Filterung, keine Anlageberatung
      </p>

      <div className="pt-2 border-t border-border/60">
        <button
          type="button"
          onClick={() => setAnalysisExpanded((e) => !e)}
          className="text-xs text-text-faint hover:text-text-muted underline decoration-dotted"
        >
          {analysisExpanded ? "KI-Einordnung ausblenden" : "KI-Einordnung anzeigen"}
        </button>

        {analysisExpanded && (
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="flex items-center gap-1.5">
                <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
                  News-Einordnung (KI)
                </p>
                <PanelInfo title="News-Einordnung (KI)" content={NEWS_ANALYSIS_INFO_TEXT} />
              </span>
              <button
                type="button"
                onClick={handleGenerateAnalysis}
                disabled={analysisLoading}
                className="px-3 py-1.5 text-xs rounded-md border border-border text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {analysisLoading ? "Generiert…" : "Neu generieren"}
              </button>
            </div>

            {analysisError && <p className="text-xs text-down">{analysisError}</p>}

            {!analysisSnapshot && !analysisError && (
              <p className="text-xs text-text-faint">Noch keine News-Einordnung generiert.</p>
            )}

            {analysisSnapshot && analysisSnapshot.status === "error" && (
              <p className="text-xs text-down">{analysisSnapshot.error ?? "Unbekannter Fehler."}</p>
            )}

            {analysisSnapshot && analysisSnapshot.status === "ok" && analysisSnapshot.result && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  <FullDateTime iso={analysisSnapshot.generated_at} className="text-text-faint" />
                  <StaleBadge iso={analysisSnapshot.generated_at} />
                  {analysisSnapshot.provider && (
                    <span className="text-text-faint">via {analysisSnapshot.provider}</span>
                  )}
                </div>

                <p className="text-sm text-text-muted leading-relaxed">
                  {analysisSnapshot.result.summary}
                </p>

                {analysisSnapshot.result.items.length > 0 && (
                  <div className="space-y-2">
                    {analysisSnapshot.result.items.map((item, i) => (
                      <div key={i} className="rounded-md border border-border/60 p-2.5 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-medium text-text">{item.headline}</p>
                          <span
                            className={`shrink-0 px-1.5 py-0.5 text-[10px] rounded-md border font-medium ${
                              IMPACT_STYLES[item.impact] ?? IMPACT_STYLES.low
                            }`}
                          >
                            {IMPACT_LABELS[item.impact] ?? item.impact}
                          </span>
                        </div>
                        <p className="text-xs text-text-faint">{item.reasoning}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
