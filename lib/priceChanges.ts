import { supabase } from "./supabase";

// Preisveraenderung ueber 1 Std / 4 Std / 1 Tag / 1 Woche neben dem Live-Preis im Lagebild
// (HeroHeader). Referenz ist der erste 5-Minuten-Snapshot ab dem jeweiligen
// Zeitpunkt von derselben Boerse wie der Live-Preis (Bybit, siehe
// REFERENCE_EXCHANGE in app/page.tsx und LivePriceDataProvider.tsx), damit
// kein Boersen-Basisunterschied in die Differenz einfliesst.

export const PRICE_CHANGE_WINDOWS = [
  { label: "1 Std", minutes: 60 },
  { label: "4 Std", minutes: 4 * 60 },
  { label: "1 Tag", minutes: 24 * 60 },
  { label: "1 Woche", minutes: 7 * 24 * 60 },
] as const;

export type PriceChangeLabel = (typeof PRICE_CHANGE_WINDOWS)[number]["label"];

export interface PriceReference {
  label: PriceChangeLabel;
  price: number | null;
}

export interface PriceChange {
  label: PriceChangeLabel;
  abs: number;
  pct: number;
}

const PRICE_REFERENCE_EXCHANGE = "bybit";

// Liegt der erste Snapshot nach dem Zielzeitpunkt weiter weg (Luecke in den
// Daten), gilt der Wert als fehlend statt einen falschen Bezug zu zeigen.
export const MAX_REFERENCE_GAP_MINUTES = 10;

export async function fetchPriceReferences(nowMs: number = Date.now()): Promise<PriceReference[]> {
  return Promise.all(
    PRICE_CHANGE_WINDOWS.map(async ({ label, minutes }) => {
      const targetMs = nowMs - minutes * 60_000;
      const { data, error } = await supabase
        .from("market_snapshots")
        .select("timestamp_utc, last_price")
        .eq("exchange", PRICE_REFERENCE_EXCHANGE)
        .eq("symbol", "BTCUSDT")
        .eq("status", "ok")
        .gte("timestamp_utc", new Date(targetMs).toISOString())
        .order("timestamp_utc", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error || !data || data.last_price == null) {
        if (error) console.error(`Fehler beim Laden der Preis-Referenz (${label}):`, error.message);
        return { label, price: null };
      }
      const gapMinutes = (new Date(data.timestamp_utc).getTime() - targetMs) / 60_000;
      return { label, price: gapMinutes <= MAX_REFERENCE_GAP_MINUTES ? Number(data.last_price) : null };
    })
  );
}

export function computePriceChanges(livePrice: number | null, references: PriceReference[]): PriceChange[] {
  if (livePrice === null) return [];
  return references.flatMap(({ label, price }) => {
    if (price === null || price === 0) return [];
    const abs = livePrice - price;
    return [{ label, abs, pct: (abs / price) * 100 }];
  });
}
