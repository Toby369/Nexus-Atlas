// Datenbeschaffung fuer die Zyklus-Indikatoren-Kachel (Umsetzungsplan
// Phase 5, 05.09.2026: Pi-Cycle-Top + Log-Preiskanal). Reine Lesefunktion,
// keine AI, kein Schreiben -- nutzt die bereits vorhandene candles-Tabelle
// (1d, Binance, ~2 Jahre Historie seit dem Backfill).
//
// Server-only (nutzt Supabase direkt) -- niemals aus einer "use client"
// Komponente importieren.

import { supabase } from "./supabase";
import { computePiCycleTop, type PiCycleTopResult } from "./piCycleTop";
import { computeLogPriceChannel, type LogPriceChannelResult } from "./logPriceChannel";

const SYMBOL = "BTCUSDT";
const EXCHANGE = "binance";

export interface CycleIndicators {
  piCycleTop: PiCycleTopResult | null;
  logPriceChannel: LogPriceChannelResult | null;
  daysOfHistory: number;
}

export async function buildCycleIndicators(): Promise<CycleIndicators> {
  const { data, error } = await supabase
    .from("candles")
    .select("open_time, close")
    .eq("exchange", EXCHANGE)
    .eq("symbol", SYMBOL)
    .eq("interval", "1d")
    .order("open_time", { ascending: true })
    .limit(1000);

  if (error || !data) {
    console.error("Fehler beim Laden der Kerzen-Historie fuer Zyklus-Indikatoren:", error?.message);
    return { piCycleTop: null, logPriceChannel: null, daysOfHistory: 0 };
  }

  const closes = data.map((r) => Number(r.close));
  const points = data.map((r) => ({ t: r.open_time as string, price: Number(r.close) }));

  return {
    piCycleTop: computePiCycleTop(closes),
    logPriceChannel: computeLogPriceChannel(points),
    daysOfHistory: data.length,
  };
}
