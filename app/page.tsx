import { supabase } from "@/lib/supabase";
import type { MarketSnapshot } from "@/lib/types";
import LivePricePanel from "@/components/LivePricePanel";

export const revalidate = 0;

async function getLatestSnapshots(limit = 20): Promise<MarketSnapshot[]> {
  const { data, error } = await supabase
    .from("market_snapshots")
    .select("*")
    .eq("status", "ok")
    .order("timestamp_utc", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Fehler beim Laden der Snapshots:", error.message);
    return [];
  }

  return data ?? [];
}

export default async function Home() {
  const snapshots = await getLatestSnapshots();

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
          Datentakt: alle 5&nbsp;Minuten · Quelle: Bybit
        </p>
      </header>

      <section className="flex-1 px-6 py-8 max-w-3xl w-full mx-auto">
        <LivePricePanel initialSnapshots={snapshots} />
      </section>

      <footer className="border-t border-border px-6 py-4 text-xs text-text-faint">
        NEXUS Atlas · Persönliches Marktüberwachungs-Tool, keine Anlageberatung
      </footer>
    </main>
  );
}
