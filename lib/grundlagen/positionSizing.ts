// Positionsgroessen-Rechner: aus Kontogroesse, Risiko pro Trade und Stop-
// Abstand ergibt sich die Positionsgroesse -- nicht umgekehrt. Dazu CRV,
// Break-even-Trefferquote, Erwartungswert und eine Naeherung des
// Liquidationspreises bei isolierter Margin, damit sichtbar wird, wenn der
// Boersen-Hebel den Stop ueberholt.

// Wartungsmarge fuer BTC-Perps auf den grossen Boersen in der untersten
// Risikostufe; jede Boerse rechnet leicht anders, daher nur Naeherung.
export const MAINTENANCE_MARGIN_RATE = 0.005;
// Liegt die Liquidation naeher als 0,5 % des Entry am Stop, kann ein
// durchrutschender Stop trotzdem zur Liquidation fuehren.
const TIGHT_LIQ_DISTANCE = 0.005;

export interface PositionInput {
  account: number;
  riskPct: number;
  entry: number;
  stop: number;
  target: number;
  winRatePct: number;
  leverage: number;
}

export interface PositionResult {
  side: "long" | "short";
  riskAmount: number;
  stopDistancePct: number;
  sizeBtc: number;
  notional: number;
  effectiveLeverage: number;
  /** null, wenn das Ziel auf der falschen Seite liegt. */
  rewardRisk: number | null;
  breakEvenWinRatePct: number | null;
  /** Erwartungswert in R pro Trade (ohne Gebuehren). */
  expectancyR: number | null;
  liquidationPrice: number | null;
  liquidationBeforeStop: boolean;
  liquidationTight: boolean;
}

export function computePosition(input: PositionInput): PositionResult | null {
  const { account, riskPct, entry, stop, target, winRatePct, leverage } = input;
  const distance = Math.abs(entry - stop);
  if (!(account > 0) || !(entry > 0) || !(distance > 0) || !(riskPct > 0)) return null;

  const side = stop < entry ? "long" : "short";
  const riskAmount = (account * riskPct) / 100;
  const sizeBtc = riskAmount / distance;
  const notional = sizeBtc * entry;

  const reward = side === "long" ? target - entry : entry - target;
  const rewardRisk = reward > 0 ? reward / distance : null;
  const winRate = Math.min(Math.max(winRatePct, 0), 100) / 100;

  const lev = Math.max(1, leverage || 1);
  const liquidationPrice =
    lev <= 1
      ? null
      : side === "long"
      ? entry * (1 - 1 / lev + MAINTENANCE_MARGIN_RATE)
      : entry * (1 + 1 / lev - MAINTENANCE_MARGIN_RATE);
  const liquidationBeforeStop =
    liquidationPrice !== null && (side === "long" ? liquidationPrice >= stop : liquidationPrice <= stop);
  const liquidationTight =
    liquidationPrice !== null &&
    !liquidationBeforeStop &&
    Math.abs(liquidationPrice - stop) / entry < TIGHT_LIQ_DISTANCE;

  return {
    side,
    riskAmount,
    stopDistancePct: (distance / entry) * 100,
    sizeBtc,
    notional,
    effectiveLeverage: notional / account,
    rewardRisk,
    breakEvenWinRatePct: rewardRisk === null ? null : (1 / (1 + rewardRisk)) * 100,
    expectancyR: rewardRisk === null ? null : winRate * rewardRisk - (1 - winRate),
    liquidationPrice,
    liquidationBeforeStop,
    liquidationTight,
  };
}
