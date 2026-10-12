// Lern-Simulator: eine Market-Order frisst sich durch ein Beispiel-Orderbuch.
// Zeigt, warum dieselbe Ordergroesse den Preis in einem duennen Buch weiter
// bewegt. Die Mengen sind erfundene Beispielwerte, keine Live-Daten.

export const SIM_START_PRICE = 60_000;
export const SIM_TICK_USD = 50;
export const SIM_ASKS = [3, 5, 2, 8, 4, 12, 6, 3, 15, 5, 9, 7];
export const SIM_BIDS = [4, 3, 6, 2, 9, 5, 11, 4, 7, 13, 6, 8];
// Am Wochenende/nachts steht deutlich weniger Liquiditaet im Buch.
export const THIN_BOOK_FACTOR = 0.4;

export type OrderSide = "buy" | "sell";

export interface BookLevel {
  price: number;
  size: number;
  filled: number;
}

export interface MarketOrderResult {
  levels: BookLevel[];
  lastPrice: number;
  avgFillPrice: number | null;
  movePct: number;
  /** Order war groesser als das ganze Buch. */
  exhausted: boolean;
}

export function simulateMarketOrder(
  size: number,
  side: OrderSide,
  thin = false,
  start = SIM_START_PRICE,
  tick = SIM_TICK_USD
): MarketOrderResult {
  const sizes = (side === "buy" ? SIM_ASKS : SIM_BIDS).map((q) => (thin ? q * THIN_BOOK_FACTOR : q));
  let rest = Math.max(0, size);
  let cost = 0;
  let filledTotal = 0;
  let lastPrice = start;

  const levels = sizes.map((q, i) => {
    const price = side === "buy" ? start + tick * (i + 1) : start - tick * (i + 1);
    const filled = Math.min(q, rest);
    rest -= filled;
    if (filled > 0) {
      cost += filled * price;
      filledTotal += filled;
      lastPrice = price;
    }
    return { price, size: q, filled };
  });

  return {
    levels,
    lastPrice,
    avgFillPrice: filledTotal > 0 ? cost / filledTotal : null,
    movePct: ((lastPrice - start) / start) * 100,
    exhausted: rest > 1e-9,
  };
}
