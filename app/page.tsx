import { supabase } from "@/lib/supabase";
import type { MarketCommentary, MarketSnapshot } from "@/lib/types";
import LivePricePanel from "@/components/LivePricePanel";

export const revalidate = 0;

const REFERENCE_EXCHANGE = "bybit";
export const COMPARE_EXCHANGES = ["bybit", "binance", "bitunix", "pionex"];

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

export default async function Home() {
  const [snapshots, commentary, exchangeComparison] = await Promise.all([
    getSnapshotHistory(),
    getLatestCommentary(),
    getLatestPerExchange(),
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
        <LivePricePanel
          initialSnapshots={snapshots}
          initialCommentary={commentary}
          initialExchangeComparison={exchangeComparison}
        />
      </section>

      <footer className="border-t border-border px-6 py-4 text-xs text-text-faint">
        NEXUS Atlas · Persönliches Marktüberwachungs-Tool, keine Anlageberatung
      </footer>
    </main>
  );
}
