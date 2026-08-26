"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { EtfFlowDay, EtfFlowIntelligence, NewsEvent } from "@/lib/types";
import PanelInfo from "@/components/PanelInfo";
import { etfMacroInfo } from "@/lib/panelInfo";

// ETF-Flow-Daten aendern sich hoechstens 1x/Tag (T+1) -- seltenes Polling
// reicht, kein 30s-Live-Takt noetig wie bei Preis/Positioning.
const REFRESH_INTERVAL_MS = 5 * 60_000;
const FLOW_LIMIT = 10;
const CUMULATIVE_DAYS = 5;
// Fenstergroesse fuer die Momentum-/Trend-Analyse (get_etf_flow_intelligence):
// wird in zwei Haelften geteilt (juengere/aeltere 5 Handelstage) -- an
// CUMULATIVE_DAYS angelehnt, damit "Summe letzte 5 Handelstage" und die
// juengere Momentum-Haelfte denselben Zeitraum beschreiben.
const INTELLIGENCE_WINDOW_DAYS = CUMULATIVE_DAYS * 2;
// Betragsschwelle fuer die Trend-Einordnung (in % relativ zur aelteren
// Haelfte) -- unterhalb gilt der Flow-Trend als "stabil", da normales
// Tag-zu-Tag-Rauschen sonst faelschlich als Beschleunigung/Abflachung
// erschiene.
const TREND_STABLE_BAND_PCT = 15;
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

function formatPct(value: number | null): string {
  if (value === null) return "nicht verfügbar";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function trendLabel(momentumPct: number | null): string {
  if (momentumPct === null) return "nicht verfügbar";
  if (momentumPct > TREND_STABLE_BAND_PCT) return "beschleunigend";
  if (momentumPct < -TREND_STABLE_BAND_PCT) return "abflachend";
  return "stabil";
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

async function fetchFlowIntelligence(): Promise<EtfFlowIntelligence | null> {
  const { data, error } = await supabase.rpc("get_etf_flow_intelligence", {
    p_days: INTELLIGENCE_WINDOW_DAYS,
  });
  if (error) {
    console.error("Fehler beim Laden der ETF-Flow-Intelligence:", error.message);
    return null;
  }
  return data ?? null;
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
  const [intelligence, setIntelligence] = useState<EtfFlowIntelligence | null>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      const [flowResult, freshMacroNews, freshIntelligence] = await Promise.all([
        fetchRecentFlows(),
        fetchMacroNews(),
        fetchFlowIntelligence(),
      ]);
      setLastSyncOk(flowResult.ok);
      if (flowResult.ok) setFlows(flowResult.data);
      setMacroNewsState(freshMacroNews);
      setIntelligence(freshIntelligence);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Eigener, einmaliger Mount-Fetch nur fuer die Intelligence-RPC -- flows/
  // macroNews haben bereits einen serverseitigen initialen Wert (SSR-Props),
  // ein sofortiger Re-Fetch dieser beiden wuerde eine unnoetige zusaetzliche
  // Anfrage bei jedem Seitenaufruf bedeuten. Die RPC hat dagegen keinen
  // Server-Anfangswert.
  useEffect(() => {
    fetchFlowIntelligence().then(setIntelligence);
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

      {intelligence && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs pt-2 border-t border-border/60">
          <div>
            <span className="text-text-muted">
              Momentum ({intelligence.recent_days}T vs. {intelligence.prior_days}T):{" "}
            </span>
            <span
              className={
                intelligence.momentum_pct === null
                  ? "text-text-faint"
                  : intelligence.momentum_pct >= 0
                    ? "text-up"
                    : "text-down"
              }
            >
              {formatPct(intelligence.momentum_pct)}
            </span>
          </div>
          <div>
            <span className="text-text-muted">Trend: </span>
            <span className="text-text">{trendLabel(intelligence.momentum_pct)}</span>
          </div>
          <div>
            <span className="text-text-muted">Preis ({intelligence.window_days_used}T): </span>
            <span
              className={
                intelligence.price_change_pct === null
                  ? "text-text-faint"
                  : intelligence.price_change_pct >= 0
                    ? "text-up"
                    : "text-down"
              }
            >
              {formatPct(intelligence.price_change_pct)}
            </span>
          </div>
          <div>
            <span className="text-text-muted">OI ({intelligence.window_days_used}T): </span>
            <span
              className={
                intelligence.oi_change_pct === null
                  ? "text-text-faint"
                  : intelligence.oi_change_pct >= 0
                    ? "text-up"
                    : "text-down"
              }
            >
              {formatPct(intelligence.oi_change_pct)}
            </span>
          </div>
        </div>
      )}

      <p className="text-xs text-text-faint pt-1">
        Quelle: {latest.source === "sosovalue" ? "SoSoValue" : "Farside Investors"},
        täglich (T+1) · kein Handelssignal
      </p>
    </div>
  );
}
