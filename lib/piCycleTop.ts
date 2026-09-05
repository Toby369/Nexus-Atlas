// Pi-Cycle-Top-Indikator (Umsetzungsplan Phase 5, 05.09.2026) -- Konzept
// aus der Marktradar-Kachel "picycle" im Crypto-Trading-Journal. Vergleicht
// den 111-Tage- mit dem verdoppelten 350-Tage-gleitenden-Durchschnitt der
// taeglichen Schlusskurse: kreuzt der 111DMA von unten ueber den 2x350DMA,
// fiel das historisch (2013, 2017, 2021) auf wenige Tage genau mit
// grossen BTC-Zyklus-Hochs zusammen. Reines Muster aus der Vergangenheit,
// keine Garantie -- genau wie jedes andere Modell in diesem Projekt nicht
// als Vorhersage zu lesen.
//
// Reine Funktion, keine Netzwerk-/DB-Zugriffe -- nimmt Schlusskurse
// (aufsteigend nach Zeit) entgegen, die der Aufrufer bereits geladen hat.

export interface PiCycleTopResult {
  ma111: number;
  ma350x2: number;
  /** ma111 / ma350x2 * 100 -- >=100 heisst: Kreuzung hat stattgefunden. */
  ratioPct: number;
  triggered: boolean;
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * @param closesAscending Tages-Schlusskurse, AELTESTER zuerst. Braucht
 *   mindestens 350 Werte (der laengere der beiden gleitenden Durchschnitte).
 */
export function computePiCycleTop(closesAscending: number[]): PiCycleTopResult | null {
  if (closesAscending.length < 350) return null;

  const ma111 = average(closesAscending.slice(-111));
  const ma350x2 = average(closesAscending.slice(-350)) * 2;
  const ratioPct = (ma111 / ma350x2) * 100;

  return {
    ma111,
    ma350x2,
    ratioPct: Math.round(ratioPct * 100) / 100,
    triggered: ratioPct >= 100,
  };
}
