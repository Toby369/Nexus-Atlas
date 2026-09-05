// Liquidations-/Hebelkarte (Umsetzungsplan Phase 4, 05.09.2026) -- portiert
// aus shared/leverageMap.js + shared/liquidation.js im Crypto-Trading-
// Journal (Toby's Freund). Modell, KEINE Messung: schaetzt aus der Open-
// Interest-Historie, wo gehebelte Positionen liquidiert wuerden. Steigt das
// offene Interesse in einer Periode, wurden dort Positionen eroeffnet; die
// Kerze sagt zu welchem Preis, das Taker-Volumen in welche Richtung. Daraus
// ergibt sich je Hebelstufe ein Liquidationspreis.
//
// Nutzt ausschliesslich bereits vorhandene Nexus-Rohdaten -- keine neue
// Datenquelle: market_features.oi_current (Open Interest je Kerze) +
// candles (OHLCV + taker_buy_base_vol), siehe lib/leverageMapContext.ts.
//
// ── Was das Modell NICHT kann, in Reihenfolge der Schwere (1:1 aus dem
// Vorbild uebernommen -- dieselben Einschraenkungen gelten hier) ──
//  1. ΔOI ist ein Saldo. Innerhalb einer Periode oeffnen und schliessen viele
//     Positionen; der Umschlag bleibt unsichtbar.
//  2. Jeder Kontrakt hat zwei Seiten. Das Modell unterstellt, dass je Periode
//     nur EINE Seite gehebelt neu eroeffnet -- die groesste Fiktion darin.
//  3. Der Einstiegspreis innerhalb einer Kerze ist unbekannt (gleichverteilt
//     angenommen).
//  4. Die Hebelverteilung ist unbekannt; einzelne Stufen sind ein Was-waere-
//     wenn, nicht die tatsaechlich genutzten Hebel.
//  5. Cross Margin und Nachschuss verschieben echte Liquidationspreise
//     beliebig -- das Modell rechnet ausschliesslich isoliert, Stufe 1.

export const LEVERAGE_TIERS = [10, 25, 50, 100] as const;

/**
 * Liquidationspreis einer Long-Position (isoliert, linear, USDⓈ-M-Formel).
 * Liquidiert wird, wenn die Marge bis auf die Wartungsmarge aufgebraucht
 * ist: E/L + P − E = m·P ⇒ P = E·(1 − 1/L)/(1 − m).
 */
export function liqPriceLong(entry: number, leverage: number, mmr: number): number {
  return (entry * (1 - 1 / leverage)) / (1 - mmr);
}

/** Liquidationspreis einer Short-Position. @see liqPriceLong */
export function liqPriceShort(entry: number, leverage: number, mmr: number): number {
  return (entry * (1 + 1 / leverage)) / (1 + mmr);
}

/**
 * Bei `1/Hebel <= mmr` deckt die Marge die Wartungsmarge nicht einmal im
 * Eroeffnungsmoment -- die Boerse liesse die Position gar nicht erst zu.
 */
export function leverageSustainable(leverage: number, mmr: number): boolean {
  return 1 / leverage > mmr;
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

// Gewichte der beiden Richtungssignale -- benannte Konstanten wie im
// Vorbild (dort explizit als erste Kandidaten fuer eine spaetere Backtest-
// Kalibrierung markiert).
const TAKER_WEIGHT = 0.6;
const CANDLE_WEIGHT = 0.2;

/**
 * Long-Anteil neu eroeffneter Positionen einer Kerze schaetzen. Taker-Buy-
 * Anteil (Bruttovolumen, enthaelt auch Schliessungen) UND Kerzenrichtung
 * werden gemischt statt hart geschaltet -- ein Doji degradiert exakt aufs
 * reine Taker-Signal, Konsens zweier Signale darf staerker ausschlagen.
 */
export function longSharePct(point: OiCandlePoint): number {
  const taker = point.v > 0 ? point.tb / point.v : 0.5;
  const range = point.h - point.l;
  const candle = range > 0 ? clamp((point.c - point.o) / range, -1, 1) : 0;
  return clamp(0.5 + TAKER_WEIGHT * (taker - 0.5) + CANDLE_WEIGHT * candle, 0.1, 0.9);
}

export interface OiCandlePoint {
  /** ISO-Zeitstempel des Kerzenbeginns. */
  t: string;
  /** Offenes Interesse am Ende dieser Periode (Coins). */
  oi: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** Handelsvolumen (Coins). */
  v: number;
  /** Taker-Buy-Volumen (Coins). */
  tb: number;
}

export interface LiquidationCluster {
  price: number;
  /** "long" = hier werden LONG-Positionen liquidiert (liegt unterhalb des Preises). */
  side: "long" | "short";
  /** Aggregierte Menge in Coins, die bei diesem Preis liquidiert wuerde. */
  massCoins: number;
  /** Welche nominalen Hebelstufen zu diesem Cluster beitragen. */
  tiers: number[];
}

export interface LeverageMapResult {
  mid: number;
  bucketSize: number;
  mmr: number;
  /** Insgesamt attribuierte OI-Zunahme (Coins) -- Bezugsgroesse fuer massShare. */
  attributedCoins: number;
  /** Wegen zu geringer Wartungsmarge verworfene nominale Stufen. */
  droppedTiers: number[];
  /** Erfasste Spanne um mid (%), noetig um alle Stufen abzudecken. */
  capturePct: number;
  /** Cluster aufsteigend nach Abstand zum Mid, getrennt long/short. */
  clusters: LiquidationCluster[];
}

interface EffectiveTier {
  nominal: number;
  effective: number;
}

/**
 * Hebelstufen auf den echten Max-Hebel des Symbols klemmen. Kollabieren
 * zwei Nominale auf denselben Effektivwert, ueberlebt die niedrigere (die,
 * deren Wert der Nutzer sieht/anklickt).
 */
function effectiveTiers(tiers: readonly number[], maxLeverage: number): EffectiveTier[] {
  const cap = maxLeverage > 1 ? maxLeverage : 0;
  const seen = new Set<number>();
  const out: EffectiveTier[] = [];
  for (const nominal of tiers) {
    const effective = cap ? Math.min(nominal, cap) : nominal;
    if (seen.has(effective)) continue;
    seen.add(effective);
    out.push({ nominal, effective });
  }
  return out;
}

/**
 * Einseitige Spanne (% vom Mid), die das Raster braucht, um auch die
 * weiteste Hebelstufe noch abzubilden -- gerechnet von den Fenster-
 * EXTREMEN aus (nicht vom Mid), weil Einstiege an den Fensterraendern
 * liegen koennen.
 */
function requiredSpanPct(points: OiCandlePoint[], tiers: number[], mid: number, mmr: number): number {
  if (tiers.length === 0 || !(mid > 0)) return 0;
  let hi = mid;
  let lo = mid;
  for (const p of points) {
    if (p.h > hi) hi = p.h;
    if (p.l < lo) lo = p.l;
  }
  let span = 0;
  for (const leverage of tiers) {
    span = Math.max(
      span,
      1 - liqPriceLong(lo, leverage, mmr) / mid,
      liqPriceShort(hi, leverage, mmr) / mid - 1
    );
  }
  return span * 100 * 1.02; // kleine Reserve fuer Bucket-Rundung
}

/**
 * Zuwachs je Periode + der Anteil, der bis zum Ende ueberlebt hat.
 * `seed=false` zaehlt nur, was WAEHREND des Fensters dazukam (der
 * Startbestand wurde vor unbekannten Preisen eroeffnet).
 */
function attributeOpenInterest(points: OiCandlePoint[], seed: boolean): { add: number[]; postScale: number[] } {
  const n = points.length;
  const add = new Array<number>(n).fill(0);
  const decay = new Array<number>(n).fill(1);
  if (n === 0) return { add, postScale: decay };

  add[0] = seed ? points[0].oi : 0;
  for (let i = 1; i < n; i++) {
    const prev = points[i - 1].oi;
    const cur = points[i].oi;
    decay[i] = prev > 0 ? Math.min(1, cur / prev) : 1;
    add[i] = Math.max(0, cur - prev);
  }

  const postScale = new Array<number>(n).fill(1);
  let acc = 1;
  for (let i = n - 1; i >= 0; i--) {
    postScale[i] = acc;
    acc *= decay[i];
  }
  return { add, postScale };
}

const DEFAULT_MMR = 0.004;
const DEFAULT_SPAN_PCT = 8;
const DEFAULT_MAX_SUB_STEPS = 64;

/**
 * Baut die aktuelle Hebelkarte aus einer Punktreihe (aufsteigend nach
 * Zeit) und komprimiert sie zu den staerksten Clustern je Seite.
 */
export function buildLeverageClusters(
  points: OiCandlePoint[],
  opts: {
    mid: number;
    bucketSize: number;
    spanPct?: number;
    mmr?: number;
    maxLeverage?: number;
    tiers?: readonly number[];
    maxSubSteps?: number;
    maxClustersPerSide?: number;
  }
): LeverageMapResult {
  const {
    mid,
    bucketSize,
    spanPct = DEFAULT_SPAN_PCT,
    mmr = DEFAULT_MMR,
    maxLeverage = 0,
    tiers = LEVERAGE_TIERS,
    maxSubSteps = DEFAULT_MAX_SUB_STEPS,
    maxClustersPerSide = 8,
  } = opts;

  const stufen = effectiveTiers(tiers, maxLeverage).filter((s) => leverageSustainable(s.effective, mmr));
  const usable = stufen.map((s) => s.effective);
  const nominal = stufen.map((s) => s.nominal);
  const dropped = tiers.filter((t) => !nominal.includes(t));

  const capturePct = Math.max(spanPct, requiredSpanPct(points, usable, mid, mmr));

  const empty: LeverageMapResult = {
    mid,
    bucketSize,
    mmr,
    attributedCoins: 0,
    droppedTiers: dropped,
    capturePct,
    clusters: [],
  };
  if (points.length === 0 || usable.length === 0) return empty;

  const rows = Math.max(8, Math.ceil((mid * (capturePct / 100) * 2) / bucketSize));
  const base = Math.round(mid / bucketSize) - (rows >> 1);
  const rowFor = (price: number) => Math.round(price / bucketSize) - base;
  const priceAt = (row: number) => (base + row) * bucketSize;

  const long = usable.map(() => new Array<number>(rows).fill(0));
  const short = usable.map(() => new Array<number>(rows).fill(0));

  const n = points.length;
  // Aeltestes zuerst noetig fuer die Sweep-Logik unten; sortiere defensiv,
  // falls der Aufrufer absteigend liefert.
  const sorted = [...points].sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());

  const minLowAfter = new Array<number>(n);
  const maxHighAfter = new Array<number>(n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = n - 1; i >= 0; i--) {
    lo = Math.min(lo, sorted[i].l);
    hi = Math.max(hi, sorted[i].h);
    minLowAfter[i] = lo;
    maxHighAfter[i] = hi;
  }

  const { add, postScale } = attributeOpenInterest(sorted, false);
  let attributed = 0;

  for (let i = 0; i < n; i++) {
    const menge = add[i] * postScale[i];
    if (menge <= 0) continue;
    const p = sorted[i];
    const anteilLong = longSharePct(p);
    const spanne = Math.max(0, p.h - p.l);
    const schritte = Math.max(1, Math.min(maxSubSteps, Math.ceil(spanne / bucketSize)));
    const jeSchritt = menge / schritte;

    for (let s = 0; s < schritte; s++) {
      const entry = schritte === 1 ? p.c : p.l + (spanne * (s + 0.5)) / schritte;

      for (let k = 0; k < usable.length; k++) {
        const leverage = usable[k];
        const mengeLong = jeSchritt * anteilLong;
        const mengeShort = jeSchritt * (1 - anteilLong);

        const xLong = liqPriceLong(entry, leverage, mmr);
        if (xLong < minLowAfter[i]) {
          const row = rowFor(xLong);
          if (row >= 0 && row < rows) long[k][row] += mengeLong;
        }

        const xShort = liqPriceShort(entry, leverage, mmr);
        if (xShort > maxHighAfter[i]) {
          const row = rowFor(xShort);
          if (row >= 0 && row < rows) short[k][row] += mengeShort;
        }
      }
    }
    attributed += menge;
  }

  // Zeilen -> Cluster verdichten: pro Seite die Zeilen mit der groessten
  // Masse (ueber alle Stufen summiert) behalten, Rest verwerfen -- fuer
  // die UI zaehlen die paar staerksten Zonen, nicht das volle Raster.
  function topClusters(arrays: number[][], side: "long" | "short"): LiquidationCluster[] {
    const totals = new Array<number>(rows).fill(0);
    for (const arr of arrays) {
      for (let r = 0; r < rows; r++) totals[r] += arr[r];
    }
    const candidates: LiquidationCluster[] = [];
    for (let r = 0; r < rows; r++) {
      if (totals[r] <= 0) continue;
      const contributingTiers = usable
        .filter((_, k) => arrays[k][r] > 0)
        .map((eff) => nominal[usable.indexOf(eff)] ?? eff);
      candidates.push({ price: priceAt(r), side, massCoins: totals[r], tiers: contributingTiers });
    }
    candidates.sort((a, b) => b.massCoins - a.massCoins);
    return candidates.slice(0, maxClustersPerSide).sort((a, b) => Math.abs(a.price - mid) - Math.abs(b.price - mid));
  }

  const clusters = [...topClusters(long, "long"), ...topClusters(short, "short")];

  return {
    mid,
    bucketSize,
    mmr,
    attributedCoins: attributed,
    droppedTiers: dropped,
    capturePct,
    clusters,
  };
}
