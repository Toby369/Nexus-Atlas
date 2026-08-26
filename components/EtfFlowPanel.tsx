"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { EtfFlowDay, NewsEvent } from "@/lib/types";
import PanelInfo from "@/components/PanelInfo";
import { etfMacroInfo } from "@/lib/panelInfo";

// ETF-Flow-Daten aendern sich hoechstens 1x/Tag (T+1) -- seltenes Polling
// reicht, kein 30s-Live-Takt noetig wie bei Preis/Positioning.
const REFRESH_INTERVAL_MS = 5 * 60_000;
const FLOW_LIMIT = 10;
const CUMULATIVE_DAYS = 5;
// Nur Makro-relevante News-Kategorien fuer die Synthese heranziehen --
// Crypto-/Sonstige-News sagen nichts ueber ETF-Flow-Kontext aus.
const MACRO_CATEGORIES = new Set(["etf", "fed", "treasury", "cpi"]);
const MACRO_NEWS_LOOKBACK_HOURS = 72;
const MACRO_NEWS_LIMIT = 20;

function formatUsdM(value: number) {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "-";
  return `${sign}$${abs.toFixed(1)}M`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "short",
  });
}

// Ein Tag kann sowohl eine (aeltere) Farside- als auch eine (neuere)
// SoSoValue-Zeile haben, seit die Quelle umgestellt wurde. Pro Datum nur
// eine Zeile behalten, SoSoValue bevorzugt.
function dedupeByDate(rows: EtfFlowDay[], limit: number): EtfFlowDay[] {
  const byDate = new Map<string, EtfFlowDay>();
  for (const row of rows) {
    const existing = byDate.get(row.flow_date);
    if (!existing || row.source === "sosovalue") {
      byDate.set(row.flow_date, row);
    }
  }
  return Array.from(byDate.values())
    .sort((a, b) => (a.flow_date < b.flow_date ? 1 : -1))
    .slice(0, limit);
}

async function fetchRecentFlows(): Promise<{
  data: EtfFlowDay[];
  ok: boolean;
}> {
  const { data, error } = await supabase
    .from("etf_flows")
    .select("*")
    .order("flow_date", { ascending: false })
    .limit(FLOW_LIMIT * 2);

  if (error) {
    console.error("Fehler beim Laden der ETF-Flows:", error.message);
    return { data: [], ok: false };
  }
  return { data: dedupeByDate(data ?? [], FLOW_LIMIT), ok: true };
}

// Eigener, unabhaengiger Poll statt die macroNews-Prop dauerhaft auf dem
// Stand des initialen Server-Renders zu belassen -- sonst driftet die
// Synthese bei lange offenem Tab von dem ab, was News Risk gerade zeigt.
async function fetchMacroNews(): Promise<NewsEvent[]> {
  const cutoff = new Date(
    Date.now() - MACRO_NEWS_LOOKBACK_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("news_events")
    .select("*")
    .eq("is_market_moving", true)
    .gte("published_at", cutoff)
    .order("published_at", { ascending: false })
    .limit(MACRO_NEWS_LIMIT);

  if (error) {
    console.error("Fehler beim Laden der Makro-News:", error.message);
    return [];
  }
  return data ?? [];
}

export default function EtfFlowPanel({
  initialFlows,
  macroNews,
}: {
  initialFlows: EtfFlowDay[];
  macroNews: NewsEvent[];
}) {
  const [flows, setFlows] = useState(initialFlows);
  const [macroNewsState, setMacroNewsState] = useState(macroNews);
  const [lastSyncOk, setLastSyncOk] = useState(true);

  useEffect(() => {
    const interval = setInterval(async () => {
      const [flowResult, freshMacroNews] = await Promise.all([
        fetchRecentFlows(),
        fetchMacroNews(),
      ]);
      setLastSyncOk(flowResult.ok);
      if (flowResult.ok) setFlows(flowResult.data);
      setMacroNewsState(freshMacroNews);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  if (flows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-5">
        <p className="text-xs uppercase tracking-[0.15em] text-text-muted">
          ETF-Flows &amp; Makro
        </p>
        <p className="text-sm text-text-faint mt-3">
          {lastSyncOk
            ? "Noch keine ETF-Flow-Daten vorhanden."
            : "Sync-Problem — ETF-Flows derzeit nicht verfügbar."}
        </p>
      </div>
    );
  }

  const latest = flows[0];
  const cumulativeDays = Math.min(flows.length, CUMULATIVE_DAYS);
  const cumulative = flows
    .slice(0, CUMULATIVE_DAYS)
    .reduce((sum, f) => sum + (f.total_flow_usd_m ?? 0), 0);

  const relevantMacroNews = macroNewsState.filter((n) =>
    MACRO_CATEGORIES.has(n.category)
  );
  const bullishMacro = relevantMacroNews.filter(
    (n) => n.market_direction === "bullish"
  ).length;
  const bearishMacro = relevantMacroNews.filter(
    (n) => n.market_direction === "bearish"
  ).length;

  const flowIsPositive = cumulative >= 0;
  const macroLeansSameWay =
    (flowIsPositive && bullishMacro > bearishMacro) ||
    (!flowIsPositive && bearishMacro > bullishMacro);

  let synthesis: string;
  if (relevantMacroNews.length === 0) {
    synthesis = `ETF-Flows der letzten ${cumulativeDays} Handelstage ${
      flowIsPositive ? "netto positiv" : "netto negativ"
    }. Keine markbewegenden Makro-News (Fed/Treasury/CPI/ETF) in den letzten 72h zur Einordnung.`;
  } else if (macroLeansSameWay) {
    synthesis = `ETF-Flows (${
      flowIsPositive ? "netto positiv" : "netto negativ"
    }) und Makro-News-Ton (${bullishMacro} bullish · ${bearishMacro} bearish) zeigen aktuell in dieselbe Richtung.`;
  } else {
    synthesis = `ETF-Flows (${
      flowIsPositive ? "netto positiv" : "netto negativ"
    }) und Makro-News-Ton (${bullishMacro} bullish · ${bearishMacro} bearish) laufen aktuell auseinander — kein einheitliches Bild.`;
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.15em] text-text-muted">
          ETF-Flows &amp; Makro
        </p>
        <PanelInfo title="ETF-Flows & Makro" content={etfMacroInfo} />
      </div>

      {!lastSyncOk && (
        <p className="text-xs text-down">
          Sync-Problem — zuletzt bekannte ETF-Flows werden angezeigt.
        </p>
      )}

      <div className="flex items-baseline justify-between">
        <span
          className={`tabular font-mono text-2xl font-semibold ${
            latest.total_flow_usd_m !== null && latest.total_flow_usd_m >= 0
              ? "text-up"
              : "text-down"
          }`}
        >
          {latest.total_flow_usd_m !== null
            ? formatUsdM(latest.total_flow_usd_m)
            : "—"}
        </span>
        <span className="text-xs text-text-faint">
          {formatDate(latest.flow_date)} · US-Spot-BTC-ETFs
        </span>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-text-muted">
          Summe letzte {cumulativeDays} Handelstage
        </span>
        <span
          className={`tabular font-mono ${
            cumulative >= 0 ? "text-up" : "text-down"
          }`}
        >
          {formatUsdM(cumulative)}
        </span>
      </div>

      <p className="text-sm text-text leading-relaxed">{synthesis}</p>

      <p className="text-xs text-text-faint pt-1">
        Quelle: {latest.source === "sosovalue" ? "SoSoValue" : "Farside Investors"},
        täglich (T+1) · kein Handelssignal
      </p>
    </div>
  );
}
