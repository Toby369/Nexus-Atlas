// Footprint-Trainer: Lernkerzen mit Bid × Ask pro Preisstufe. Bid =
// aggressive Verkaeufe (Market-Sell in Kauforders), Ask = aggressive Kaeufe.
// Die Szenarien sind konstruierte Lehrbeispiele in realistischer
// Groessenordnung (BTC-Perp, 15 Min, $50-Stufen), keine echten Marktdaten.

export const FOOTPRINT_TICK = 50;
// Diagonales Ungleichgewicht ab Faktor 3 (gaengige Standardeinstellung in
// Footprint-Software).
export const IMBALANCE_RATIO = 3;
// Gestapelt ab drei Stufen in Folge.
export const STACK_MIN = 3;

export interface FootprintLevel {
  price: number;
  bid: number;
  ask: number;
}

export interface FootprintCandle {
  open: number;
  close: number;
  /** Absteigend nach Preis: levels[0] ist das Hoch, das letzte das Tief. */
  levels: FootprintLevel[];
}

export type FootprintPattern = "absorption" | "exhaustion" | "initiative" | "unfinished" | "trapped";

export const PATTERN_LABELS: Record<FootprintPattern, string> = {
  absorption: "Absorption",
  exhaustion: "Erschöpfung",
  initiative: "Echter Ausbruch",
  unfinished: "Unfertige Auktion",
  trapped: "Gefangene Trader",
};

export type Imbalance = "buy" | "sell" | null;

export function candleDelta(c: FootprintCandle): number {
  return c.levels.reduce((sum, l) => sum + l.ask - l.bid, 0);
}

export function candleVolume(c: FootprintCandle): number {
  return c.levels.reduce((sum, l) => sum + l.ask + l.bid, 0);
}

/** Stufe mit dem meisten Volumen (Point of Control). */
export function pocPrice(c: FootprintCandle): number | null {
  let best: FootprintLevel | null = null;
  for (const l of c.levels) if (!best || l.ask + l.bid > best.ask + best.bid) best = l;
  return best?.price ?? null;
}

/**
 * Diagonaler Vergleich wie in Footprint-Software: Kaeufer-Ungleichgewicht,
 * wenn das Ask auf einer Stufe >= Faktor x das Bid eine Stufe darunter ist;
 * Verkaeufer-Ungleichgewicht, wenn das Bid >= Faktor x das Ask eine Stufe
 * darueber ist. Null auf der Gegenseite zaehlt als 1.
 */
export function diagonalImbalances(c: FootprintCandle, ratio = IMBALANCE_RATIO): Imbalance[] {
  return c.levels.map((l, i) => {
    const below = c.levels[i + 1];
    const above = c.levels[i - 1];
    const buy = below !== undefined && l.ask >= ratio * Math.max(below.bid, 1);
    const sell = above !== undefined && l.bid >= ratio * Math.max(above.ask, 1);
    if (buy && !sell) return "buy";
    if (sell && !buy) return "sell";
    return null;
  });
}

/** Laengste Folge gleichgerichteter Ungleichgewichte. */
export function longestStack(imbalances: Imbalance[], side: "buy" | "sell"): number {
  let best = 0;
  let run = 0;
  for (const imb of imbalances) {
    run = imb === side ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

export interface FootprintScenario {
  id: string;
  context: string;
  candle: FootprintCandle;
  answer: FootprintPattern;
  explanation: string;
  action: string;
}

// Hilfsfunktion fuer die Szenarien: Stufen von oben nach unten im $50-Raster.
function ladder(high: number, rows: [number, number][]): FootprintLevel[] {
  return rows.map(([bid, ask], i) => ({ price: high - i * FOOTPRINT_TICK, bid, ask }));
}

export const FOOTPRINT_SCENARIOS: FootprintScenario[] = [
  {
    id: "absorption-high",
    context: "Zweiter Anlauf auf den Widerstand 83'000–83'400. Du überlegst, den Ausbruch long zu kaufen.",
    candle: {
      open: 83150,
      close: 83200,
      levels: ladder(83350, [
        [210, 640],
        [380, 910],
        [260, 520],
        [190, 340],
        [120, 230],
        [60, 90],
      ]),
    },
    answer: "absorption",
    explanation:
      "Oben wurde massiv aggressiv gekauft (Delta stark positiv), aber die Kerze schliesst nur 50 USD über dem Open, mit langem Docht nach oben. Ein grosser passiver Verkäufer hat mit Limit-Orders alles aufgenommen.",
    action:
      "Kein Long-Einstieg. Wer oben gekauft hat, ist gefangen, wenn die nächste Kerze dreht. Erst ein Schluss über dem Hoch mit neuem Kaufdruck hebt die Absorption auf.",
  },
  {
    id: "absorption-low",
    context: "Retest von oben an 82'200 (VWAP, Basis der Ausbruchskerze). Deine Idee: Long, wenn das Level hält.",
    candle: {
      open: 82350,
      close: 82300,
      levels: ladder(82400, [
        [40, 70],
        [150, 180],
        [260, 210],
        [420, 160],
        [880, 240],
        [610, 150],
      ]),
    },
    answer: "absorption",
    explanation:
      "Am Level 82'200/82'150 wurde stark aggressiv verkauft (Delta deutlich negativ), aber der Preis kam nicht tiefer und schloss wieder bei 82'300. Passive Käufer haben die Verkäufe aufgenommen.",
    action:
      "Das ist die Bestätigung, auf die dein Retest wartet. Einstieg erst, wenn die Folgekerze schliesst und das Delta dreht (Dominanzwechsel). Stop unter dem Absorptions-Tief plus Puffer.",
  },
  {
    id: "exhaustion",
    context: "Schneller Anstieg seit drei Kerzen. Diese Kerze macht ein neues Hoch.",
    candle: {
      open: 82650,
      close: 82800,
      levels: ladder(82900, [
        [4, 3],
        [12, 9],
        [140, 310],
        [180, 420],
        [210, 380],
        [160, 290],
      ]),
    },
    answer: "exhaustion",
    explanation:
      "Auf den obersten zwei Stufen wurde fast nichts mehr gehandelt (4 × 3, 12 × 9). Es kamen keine neuen Käufer, die Bewegung ist ausgelaufen und wurde nicht abgewehrt. Das ist keine Absorption: dafür bräuchte es dort viel Volumen.",
    action:
      "Kein neuer Long am Hoch. Ein Short wäre nur mit Bestätigung sinnvoll, z. B. wenn die nächste Kerze unter dem POC schliesst. Bestehende Longs: Teilgewinn erwägen.",
  },
  {
    id: "initiative",
    context: "Ausbruch über 83'000 nach mehreren Stunden Range darunter.",
    candle: {
      open: 82950,
      close: 83300,
      levels: ladder(83300, [
        [90, 260],
        [70, 410],
        [60, 520],
        [80, 610],
        [150, 330],
        [140, 180],
        [110, 120],
        [90, 100],
      ]),
    },
    answer: "initiative",
    explanation:
      "Vier Stufen in Folge mit Käufer-Ungleichgewicht (gestapelt), Schluss am Hoch, und oben wird weiter gehandelt. Käufer räumen die Ask-Seite ab, und der Preis kommt voran. So sieht echte Initiative aus.",
    action:
      "Kein Einstieg in die Kerze hinein, sondern auf den Retest warten. Die gestapelte Zone 83'150–83'300 und das Ausbruchslevel 83'000 sind die Unterstützung. Hält sie beim Rücksetzer (Absorption), ist das dein Entry.",
  },
  {
    id: "unfinished",
    context: "Rücksetzer im Aufwärtstrend. Die Kerze dreht am Tief und schliesst stark.",
    candle: {
      open: 82300,
      close: 82450,
      levels: ladder(82500, [
        [30, 60],
        [120, 260],
        [180, 310],
        [240, 280],
        [260, 150],
        [130, 95],
      ]),
    },
    answer: "unfinished",
    explanation:
      "Auf der tiefsten Stufe (82'250) wurde auf beiden Seiten gehandelt (130 × 95). Bei einem sauberen Tief stünde auf der Ask-Seite fast 0. Die Auktion ist dort nicht abgeschlossen, und der Markt kommt oft zurück, um sie fertigzumachen.",
    action:
      "Rechne damit, dass 82'250 noch einmal getestet wird. Setze deinen Stop nicht genau dort, sondern darunter. Wer long will, kann den Retest von 82'250 abwarten.",
  },
  {
    id: "trapped",
    context: "Die Kerze davor brach über 83'000 aus. Das ist die nächste Kerze.",
    candle: {
      open: 83250,
      close: 82950,
      levels: ladder(83400, [
        [120, 480],
        [160, 560],
        [210, 390],
        [260, 180],
        [340, 90],
        [420, 70],
        [380, 60],
        [310, 50],
        [260, 40],
        [140, 30],
      ]),
    },
    answer: "trapped",
    explanation:
      "Oben (83'300–83'400) wurde aggressiv gekauft, danach fiel die Kerze bis unter 83'000, mit Verkäufer-Ungleichgewichten unten. Alle, die oben gekauft haben, liegen jetzt im Minus. Sie sind gefangen.",
    action:
      "Ihre Stops und Liquidationen liegen unter dem Ausbruchslevel und sind Treibstoff nach unten. Kein Long, solange der Preis unter 83'000 bleibt. Kommt er zurück auf 83'300, verkaufen viele zum Einstand: Dort ist Widerstand.",
  },
];
