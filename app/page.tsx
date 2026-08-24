import { supabase } from "@/lib/supabase";
import type {
  EtfFlowDay,
  LiquidationEvent,
  MarketCommentary,
  MarketSnapshot,
  NewsEvent,
  PositioningSignal,
  PositioningSnapshot,
} from "@/lib/types";
import LivePricePanel from "@/components/LivePricePanel";
import PositioningPanel from "@/components/PositioningPanel";
import NewsRiskPanel from "@/components/NewsRiskPanel";
import LiquidationPanel from "@/components/LiquidationPanel";
import EtfFlowPanel from "@/components/EtfFlowPanel";

export const revalidate = 0;

const REFERENCE_EXCHANGE = "bybit";
export const COMPARE_EXCHANGES = ["bybit", "binance", "bitunix", "pionex"];
const NEWS_LIMIT = 5;
const NEWS_LOOKBACK_HOURS = 72;
const LIQUIDATION_LOOKBACK_HOURS = 6;
const LIQUIDATION_LIMIT = 300;
const ETF_FLOW_LIMIT = 10;

// 180 Punkte a 5 Min ~= 15 Std. Historie fuer die Zeitreihen-Charts.
// Nur die Referenzboerse (Bybit), damit sich Kurse mehrerer Boersen nicht
// in einer Zeitreihe vermischen.
async function getSnapshotHistory(limit = 180): Promise<MarketSnapshot[]> {
  const { data, error } = await supabase
    .from("market_snapshots")
    .select("*")
    .eq("status", "ok")
    .eq("exchange", REFERENCE_EXCHANGE)
    .order("timestamp_utc", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Fehler beim Laden der Snapshots:", error.message);
    return [];
  }

  return (data ?? []).slice().reverse();
}

// Letzter bekannter Datenpunkt je Boerse, fuer den Boersenvergleich.
async function getLatestPerExchange(): Promise<MarketSnapshot[]> {
  const { data, error } = await supabase
    .from("market_snapshots")
    .select("*")
    .eq("status", "ok")
    .in("exchange", COMPARE_EXCHANGES)
    .order("timestamp_utc", { ascending: false })
    .limit(40);

  if (error) {
    console.error("Fehler beim Laden des Boersenvergleichs:", error.message);
    return [];
  }

  const seen = new Set<string>();
  const latestByExchange: MarketSnapshot[] = [];
  for (const row of data ?? []) {
    if (!seen.has(row.exchange)) {
      seen.add(row.exchange);
      latestByExchange.push(row);
    }
  }
  return latestByExchange;
}

async function getLatestCommentary(): Promise<MarketCommentary | null> {
  const { data, error } = await supabase
    .from("market_commentary")
    .select("*")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Fehler beim Laden der Markteinschaetzung:", error.message);
    return null;
  }

  return data;
}

async function getLatestPositioningSnapshot(
  exchange: string
): Promise<PositioningSnapshot | null> {
  const { data, error } = await supabase
    .from("positioning_snapshots")
    .select("*")
    .eq("status", "ok")
    .eq("exchange", exchange)
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      `Fehler beim Laden des Positioning-Snapshots (${exchange}):`,
      error.message
    );
    return null;
  }

  return data;
}

async function getLatestPositioningSignal(): Promise<PositioningSignal | null> {
  const { data, error } = await supabase
    .from("positioning_signals")
    .select("*")
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Fehler beim Laden des Positioning-Signals:", error.message);
    return null;
  }

  return data;
}

// Nur markbewegende News der letzten 72h, max. 5 - bewusst kompakt statt
// einer Rohdaten-Flut.
async function getHighImpactNews(): Promise<NewsEvent[]> {
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
    return [];
  }

  return data ?? [];
}

// Stichprobenerfassung (~25s alle 5 Min je Boerse) -- letzte Fenster fuer
// eine aussagekraeftige Aggregation (Groesse/Richtung/Haeufung).
async function getRecentLiquidations(): Promise<LiquidationEvent[]> {
  const cutoff = new Date(
    Date.now() - LIQUIDATION_LOOKBACK_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("liquidation_events")
    .select("*")
    .eq("status", "ok")
    .gte("event_time_utc", cutoff)
    .order("event_time_utc", { ascending: false })
    .limit(LIQUIDATION_LIMIT);

  if (error) {
    console.error("Fehler beim Laden der Liquidationen:", error.message);
    return [];
  }

  return data ?? [];
}

// Die Quelle wurde von Farside (Scraping) auf SoSoValue (offizielle API)
// umgestellt. Aeltere Farside-Zeilen bleiben als Historie stehen, ein Datum
// kann also kurzzeitig doppelt vorkommen -- pro Datum nur eine Zeile
// behalten, SoSoValue bevorzugt.
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

async function getRecentEtfFlows(): Promise<EtfFlowDay[]> {
  const { data, error } = await supabase
    .from("etf_flows")
    .select("*")
    .order("flow_date", { ascending: false })
    .limit(ETF_FLOW_LIMIT * 2);

  if (error) {
    console.error("Fehler beim Laden der ETF-Flows:", error.message);
    return [];
  }

  return dedupeByDate(data ?? [], ETF_FLOW_LIMIT);
}

export default async function Home() {
  const [
    snapshots,
    commentary,
    exchangeComparison,
    positioningBinance,
    positioningBybit,
    positioningOkx,
    positioningSignal,
    highImpactNews,
    recentLiquidations,
    recentEtfFlows,
  ] = await Promise.all([
    getSnapshotHistory(),
    getLatestCommentary(),
    getLatestPerExchange(),
    getLatestPositioningSnapshot("binance"),
    getLatestPositioningSnapshot("bybit"),
    getLatestPositioningSnapshot("okx"),
    getLatestPositioningSignal(),
    getHighImpactNews(),
    getRecentLiquidations(),
    getRecentEtfFlows(),
  ]);

  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b border-border px-6 py-5 flex items-baseline justify-between">
        <div>
          <p className="text-xs tracking-[0.2em] text-text-faint uppercase">
            Nexus Atlas
          </p>
          <h1 className="text-lg font-semibold text-text mt-1">
            BTC Marktüberwachung
          </h1>
        </div>
        <p className="text-xs text-text-faint hidden sm:block">
          Datentakt: alle 5&nbsp;Minuten · Referenz: Bybit
        </p>
      </header>

      <section className="flex-1 px-4 sm:px-6 py-8 max-w-3xl w-full mx-auto">
        <div className="space-y-4">
          <LivePricePanel
            initialSnapshots={snapshots}
            initialCommentary={commentary}
            initialExchangeComparison={exchangeComparison}
          />
          <PositioningPanel
            initialBinance={positioningBinance}
            initialBybit={positioningBybit}
            initialOkx={positioningOkx}
            initialSignal={positioningSignal}
          />
          <LiquidationPanel initialEvents={recentLiquidations} />
          <EtfFlowPanel initialFlows={recentEtfFlows} macroNews={highImpactNews} />
          <NewsRiskPanel initialNews={highImpactNews} />
        </div>
      </section>

      <footer className="border-t border-border px-6 py-4 text-xs text-text-faint">
        NEXUS Atlas · Persönliches Marktüberwachungs-Tool, keine Anlageberatung
      </footer>
    </main>
  );
}
