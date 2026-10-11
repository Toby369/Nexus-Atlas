// Datenbeschaffung fuer die Zyklus-Indikatoren-Kachel (Pi-Cycle-Top +
// Log-Preiskanal). Reine Lesefunktion,
// keine AI, kein Schreiben -- nutzt die bereits vorhandene candles-Tabelle
// (1d, Binance, gesamte Historie seit dem Backfill).
//
// Server-only (nutzt Supabase direkt) -- niemals aus einer "use client"
// Komponente importieren.

import { supabase } from "./supabase";
import { fetchPaged } from "./fetchPaged";
import { computePiCycleTop, type PiCycleTopResult } from "./piCycleTop";
import { computeLogPriceChannel, type LogPriceChannelResult } from "./logPriceChannel";

const SYMBOL = "BTCUSDT";
const EXCHANGE = "binance";
// Obergrenze als Schutz gegen unbegrenztes Nachladen (~27 Jahre Tageskerzen).
const MAX_DAILY_CANDLES = 10_000;

export interface CycleIndicators {
  piCycleTop: PiCycleTopResult | null;
  logPriceChannel: LogPriceChannelResult | null;
  daysOfHistory: number;
}

export async function buildCycleIndicators(): Promise<CycleIndicators> {
  // Die Tageshistorie ist laenger als die 1000 Zeilen, die PostgREST pro
  // Antwort liefert. Mit einem einzelnen .limit(1000) bei aufsteigender
  // Sortierung endeten die Daten still beim 1000. Tag, und Pi-Cycle und
  // Log-Kanal rechneten mit einem veralteten "aktuellen" Preis.
  const { rows: data, error } = await fetchPaged(
    (from, to) =>
      supabase
        .from("candles")
        .select("open_time, close")
        .eq("exchange", EXCHANGE)
        .eq("symbol", SYMBOL)
        .eq("interval", "1d")
        .order("open_time", { ascending: true })
        .range(from, to),
    MAX_DAILY_CANDLES
  );

  if (error || data.length === 0) {
    console.error("Fehler beim Laden der Kerzen-Historie fuer Zyklus-Indikatoren:", error);
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
