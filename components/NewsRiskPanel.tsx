"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { NewsEvent } from "@/lib/types";

const REFRESH_INTERVAL_MS = 60_000;
const NEWS_LIMIT = 5;
const NEWS_LOOKBACK_HOURS = 72;

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

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `vor ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std`;
  const days = Math.floor(hours / 24);
  return `vor ${days} Tg`;
}

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
}: {
  initialNews: NewsEvent[];
}) {
  const [news, setNews] = useState(initialNews);
  const [lastSyncOk, setLastSyncOk] = useState(true);

  useEffect(() => {
    const interval = setInterval(async () => {
      const { data, ok } = await fetchHighImpactNews();
      setLastSyncOk(ok);
      if (ok) setNews(data);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <p className="text-xs uppercase tracking-[0.15em] text-text-muted">
        News Risk
      </p>

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
                <span className="text-xs text-text-faint ml-auto">
                  {timeAgo(item.published_at)}
                </span>
              </div>
              <a
                href={item.url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-text leading-snug hover:underline"
              >
                {item.title_de ?? item.title}
              </a>
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
    </div>
  );
}
