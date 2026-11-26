import type { Candle } from "./candles";
import { CROWD_HEAVY_LONG, CROWD_SHORT } from "./positioning";
import { FUNDING_ELEVATED_PCT } from "./fundingLevels";
import { leverageForStop, stopBehindZone } from "./zones";
import { hourlyNoisePct, MAX_LOSSES_IN_ROW, MAX_TRADES_PER_DAY, NOISE_WARN_FACTOR } from "./veto";
import { spotConfirms, type SpotHourBar } from "./spotHourly";

// Setup-Rechner (Toby 22.11.2026, Konzept-Artefakt "Setup-Rechner", alle
// Vorschlaege uebernommen, Spot mit 3 Punkten). Statt fester Setup-Typen:
//   1. Level-Karte: Tobys Zeichnungen aus AutarkTrade (autark_drawings) plus
//      EMA 50/200 (15m), Wochen- und Monats-VWAP. Kein Tages-VWAP.
//   2. Cluster: Level innerhalb 0,3 % (zwei Swing-Level: 0,6 %) werden ein
//      Bereich. Nur Cluster mit mindestens einer eigenen Zeichnung zaehlen.
//   3. Belege am Cluster, hoechstens 10 Punkte (Momentum-Gruppe max. 2).
//   4. Setup-Karte: Einstieg, Stop hinter dem Cluster (Regelwerk 29.10.),
//      Ziele an den naechsten Gegen-Clustern ab 1 %, CRV, Hebel, Veto.
// Hintergrund gegen dich (ab 2 von 3) und US-Datentag -> halbe Groesse.
// Stop nie enger als 1H-Rauschen x 1,2 (Live-Test 22.11.: Mindest-Stop 0,5 %
// lag unter 0,65 % Rauschen); der Hebel passt sich an, Risiko bleibt 1 USDT.
// Rolle eines Clusters nach Herkunft des Kurses (Schluss vor 4 Stunden):
// kam er von oben, ist es eine Unterstuetzung (Long), sonst ein Widerstand.
// Keine KI, keine Trefferquote: die Punkte zaehlen nur Belege.
// Swing-Belege (Toby 26.11.2026): Ist ein Cluster ein Swing-Cluster (nur
// Swing-Zeichnungen), prueft der Rechner auf 4H statt 15m, Spot ueber 24 h
// UND 7 Tage, den ETF-Fluss der letzten 5 Handelstage (ersetzt OI) und den
// Hintergrund an EMA 50/200 (4H) und Monats-VWAP. Stop nie enger als
// 4H-Rauschen x 1,2, Ziele ab 3 %. Fehlen die Swing-Daten, bleibt es bei
// den Intraday-Belegen.

export type Side = "long" | "short";
export type Horizon = "intraday" | "swing";

export interface DrawingInput {
  autark_id: number;
  kind: string;
  label: string | null;
  points: { t: number; p: number }[];
  /** AutarkTrade-Stil (nur text, rechts, links, baender, stufen). */
  style?: Record<string, unknown> | null;
}

export interface SetupLevel {
  lo: number;
  hi: number;
  weight: number;
  name: string;
  own: boolean;
  /** Swing-Level (4H, 1D, Woche); sonst Intraday (15m, 1H). */
  swing: boolean;
}

export interface SetupCluster {
  lo: number;
  hi: number;
  levels: SetupLevel[];
  score: number;
  horizon: Horizon;
}

export interface Evidence {
  id: "close" | "spot" | "momentum" | "volume" | "oi" | "etf" | "funding";
  text: string;
  points: number;
  max: number;
  /** "teil" = halb erfuellt, zaehlt 0 (z. B. laufende Stunde kauft, geschlossene noch nicht). */
  state: "ja" | "nein" | "teil";
}

export interface SetupIdea {
  side: Side;
  cluster: SetupCluster;
  /** Kurs im Cluster oder hoechstens 0,3 % daneben. */
  atCluster: boolean;
  /** Abstand Kurs -> naechste Cluster-Kante in %, 0 am Cluster. */
  distancePct: number;
  entry: number;
  stop: number;
  stopPct: number;
  /** Stop wurde auf Rauschen x 1,2 geweitet (1H, bei Swing 4H). */
  stopWidened: boolean;
  /** Belege auf 4H/24h-7d geprueft (Swing-Cluster mit Swing-Daten). */
  swingEvidence: boolean;
  targets: { price: number; pct: number; crv: number; name: string }[];
  leverage: number;
  evidence: Evidence[];
  score: number;
  against: string[];
  halfSize: string[];
  vetos: string[];
  verdict: { tone: "trade" | "wait" | "watch" | "stop"; short: string };
}

export interface SwingInput {
  /** Abgeschlossene 4H-Kerzen, aelteste zuerst (~240, fuer EMA 200). */
  candles4h: Candle[];
  /** Spot-Netto (Kauf − Verkauf) / Summe in %, null ohne Daten. */
  spot24hPct: number | null;
  spot7dPct: number | null;
  /** ETF-Nettofluss der letzten Handelstage in Mio. USD. */
  etfUsdM: number | null;
  etfDays: number;
}

export interface SetupInput {
  price: number | null;
  nowMs: number;
  /** Abgeschlossene 15m-Kerzen, aelteste zuerst (fuer EMA 200 mind. ~250). */
  candles15m: Candle[];
  drawings: DrawingInput[];
  /** AVWAP-Wert je autark_id (get_anchored_vwaps). */
  avwaps: Record<number, number>;
  weeklyVwap: number | null;
  monthlyVwap: number | null;
  spotBars: SpotHourBar[];
  spot4h: "up" | "down" | "flat" | null;
  oiChangePct: number | null;
  fundingPct: number | null;
  crowdLongPct: number | null;
  /** 1H-Spanne (ATR 14) in % (lib/veto.ts::hourlyNoisePct). */
  noisePct: number | null;
  upcomingRisk: string | null;
  dataDay: string | null;
  tradesToday: number;
  lossesInRow: number;
  swing?: SwingInput | null;
}

export const CLUSTER_GAP_PCT = 0.3;
export const CLUSTER_GAP_SWING_PCT = 0.6;
export const AT_CLUSTER_PCT = 0.3;
export const MIN_TARGET_PCT = 1;
export const MIN_TARGET_SWING_PCT = 3;
/** Spot gilt ueber 24 h / 7 Tage als kaufend/verkaufend ab diesem Netto in %. */
export const SWING_SPOT_FLAT_PCT = 2;
export const MIN_CRV = 2;
export const SETUP_MIN_POINTS = 7;
export const MAX_POINTS = 10;

const fmt = (n: number) => Math.round(n).toLocaleString("de-CH");
const pct = (n: number, d = 1) => n.toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------- Indikatoren ----------
export function emaSeries(values: number[], n: number): number[] {
  const k = 2 / (n + 1);
  let e = values[0] ?? 0;
  return values.map((v) => (e = v * k + e * (1 - k)));
}

/** RSI (Wilder), gleiche Laenge wie values; die ersten Werte sind Anlauf. */
export function rsiSeries(values: number[], n = 14): number[] {
  const out: number[] = [50];
  let g = 0;
  let l = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const up = Math.max(d, 0);
    const dn = Math.max(-d, 0);
    if (i <= n) {
      g += up / n;
      l += dn / n;
    } else {
      g = (g * (n - 1) + up) / n;
      l = (l * (n - 1) + dn) / n;
    }
    out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l));
  }
  return out;
}

// ---------- 1. Level-Karte ----------
// 26.11.2026 (Toby): auch Trendlinien, Strahlen, Kanaele und Fibonacci.
// Schraege Linien zaehlen mit ihrem Wert JETZT (lineare Fortsetzung),
// nur solange sie bis heute reichen (rechts verlaengert, bzw. Strahl).
// Gewicht 2: eine schraege Linie trifft den Preis ungenauer als eine Zone.
const DEFAULT_FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

function lineAt(a: { t: number; p: number }, b: { t: number; p: number }, t: number): number | null {
  if (a.t === b.t) return null;
  return a.p + ((b.p - a.p) * (t - a.t)) / (b.t - a.t);
}

/** Reicht die Linie bis "jetzt"? Ohne Verlaengerung nur innerhalb ihrer Punkte. */
function reachesNow(a: { t: number }, b: { t: number }, nowMs: number, right: boolean, left: boolean): boolean {
  const lo = Math.min(a.t, b.t);
  const hi = Math.max(a.t, b.t);
  return (nowMs <= hi || right) && (nowMs >= lo || left);
}

function fmtRatio(w: number): string {
  return String(w).replace(".", ",");
}

const SWING_LABEL = /(4h|1d|daily|1w|w close|weekly|woche|monat)/i;

function zurichShort(ms: number): string {
  return new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

export function buildLevels(input: {
  drawings: DrawingInput[];
  avwaps: Record<number, number>;
  ema50: number | null;
  ema200: number | null;
  weeklyVwap: number | null;
  monthlyVwap: number | null;
  nowMs: number;
}): SetupLevel[] {
  const levels: SetupLevel[] = [];
  for (const d of input.drawings) {
    const prices = d.points.map((p) => p.p).filter((p) => p > 0);
    const label = (d.label ?? "").trim();
    const swing = SWING_LABEL.test(label);
    if (d.kind === "rechteck" && prices.length >= 2) {
      levels.push({ lo: Math.min(...prices), hi: Math.max(...prices), weight: 3, name: label || "Zone", own: true, swing });
    } else if ((d.kind === "horizontale" || d.kind === "strahlH") && prices.length >= 1) {
      const weight = /swing|poc/i.test(label) ? 2 : 3;
      levels.push({ lo: prices[0], hi: prices[0], weight, name: label || "Linie", own: true, swing });
    } else if ((d.kind === "trendlinie" || d.kind === "strahl") && d.points.length >= 2) {
      const [a, b] = d.points;
      const right = d.kind === "strahl" || d.style?.rechts === true;
      const left = d.kind !== "strahl" && d.style?.links === true;
      const v = reachesNow(a, b, input.nowMs, right, left) ? lineAt(a, b, input.nowMs) : null;
      if (v !== null && v > 0) {
        levels.push({ lo: v, hi: v, weight: 2, name: label || (d.kind === "strahl" ? "Strahl" : "Trendlinie"), own: true, swing });
      }
    } else if (d.kind === "kanal" && d.points.length >= 3) {
      const [a, b, c] = d.points;
      const right = d.style?.rechts !== false;
      const base = reachesNow(a, b, input.nowMs, right, false) ? lineAt(a, b, input.nowMs) : null;
      const offset = lineAt(a, b, c.t);
      if (base !== null && offset !== null) {
        const other = base + (c.p - offset);
        const [lo, hi] = [Math.min(base, other), Math.max(base, other)];
        const name = label || "Kanal";
        if (lo > 0) levels.push({ lo, hi: lo, weight: 2, name: `${name} unten`, own: true, swing });
        if (hi > 0 && hi !== lo) levels.push({ lo: hi, hi, weight: 2, name: `${name} oben`, own: true, swing });
      }
    } else if (d.kind === "fib" && d.points.length >= 2) {
      const [a, b] = d.points;
      const stufen = Array.isArray(d.style?.stufen)
        ? (d.style!.stufen as { w?: unknown; an?: unknown }[]).filter((x) => x?.an !== false).map((x) => Number(x?.w))
        : DEFAULT_FIB;
      for (const w of stufen) {
        if (!Number.isFinite(w)) continue;
        // Wie im Chart: 0 am Endpunkt, 1 am Startpunkt.
        const v = b.p - w * (b.p - a.p);
        if (v <= 0) continue;
        const golden = w === 0.5 || w === 0.618;
        levels.push({ lo: v, hi: v, weight: golden ? 2 : 1, name: `Fib ${fmtRatio(w)}${label ? ` (${label})` : ""}`, own: true, swing });
      }
    } else if (d.kind === "avwap" && d.points[0]) {
      const v = input.avwaps[d.autark_id];
      if (!(v > 0)) continue;
      const anchorMs = d.points[0].t;
      const name = label || `AVWAP ab ${zurichShort(anchorMs)}`;
      // AVWAP mit Anker aelter als 7 Tage gilt als Swing-Level.
      levels.push({ lo: v, hi: v, weight: 2, name, own: true, swing: input.nowMs - anchorMs > 7 * 86_400_000 });
    }
  }
  const nexus: [number | null, string, boolean][] = [
    [input.ema50, "EMA 50 (15m)", false],
    [input.ema200, "EMA 200 (15m)", false],
    [input.weeklyVwap, "Wochen-VWAP", true],
    [input.monthlyVwap, "Monats-VWAP", true],
  ];
  for (const [v, name, swing] of nexus) if (v !== null && v > 0) levels.push({ lo: v, hi: v, weight: 1, name, own: false, swing });
  return levels;
}

// ---------- 2. Cluster ----------
export function buildClusters(levels: SetupLevel[]): SetupCluster[] {
  const sorted = [...levels].sort((a, b) => a.lo - b.lo);
  const groups: SetupLevel[][] = [];
  for (const l of sorted) {
    const g = groups[groups.length - 1];
    if (g) {
      const hi = Math.max(...g.map((x) => x.hi));
      const bothSwing = l.swing && g.every((x) => x.swing);
      const gap = (bothSwing ? CLUSTER_GAP_SWING_PCT : CLUSTER_GAP_PCT) / 100;
      if (l.lo <= hi * (1 + gap)) {
        g.push(l);
        continue;
      }
    }
    groups.push([l]);
  }
  return groups
    .filter((g) => g.some((l) => l.own))
    .map((g) => ({
      lo: Math.min(...g.map((l) => l.lo)),
      hi: Math.max(...g.map((l) => l.hi)),
      levels: g,
      score: g.reduce((s, l) => s + l.weight, 0),
      horizon: g.filter((l) => l.own).every((l) => l.swing) ? "swing" : "intraday",
    }));
}

// ---------- 3. Belege ----------
interface Frame {
  c: Candle[];
  closes: number[];
  rsi: number[];
  /** "15m" oder "4H" fuer die Texte. */
  tf: string;
}

function spotWord(v: number | null, side: Side): "ja" | "nein" {
  if (v === null) return "nein";
  return (side === "long" ? v >= SWING_SPOT_FLAT_PCT : v <= -SWING_SPOT_FLAT_PCT) ? "ja" : "nein";
}

const signed = (v: number, d = 1) => `${v >= 0 ? "+" : "−"}${pct(Math.abs(v), d)}`;

function evidenceFor(side: Side, cluster: SetupCluster, input: SetupInput, frame: Frame, swing: SwingInput | null): Evidence[] {
  const { c, closes, rsi, tf } = frame;
  const dir = side === "long" ? 1 : -1;
  const last = c[c.length - 1];
  const ev: Evidence[] = [];
  const tol = AT_CLUSTER_PCT / 100;

  // Schluss auf der richtigen Seite nach Beruehrung (letzte 4 Kerzen, Swing: 6 x 4H).
  const touched = c
    .slice(swing ? -6 : -4)
    .some((k) => (side === "long" ? k.low <= cluster.hi * (1 + tol) : k.high >= cluster.lo * (1 - tol)));
  const closeOk = last ? (side === "long" ? last.close > cluster.lo : last.close < cluster.hi) : false;
  ev.push({
    id: "close",
    text: touched
      ? closeOk
        ? `${tf} schliesst ${side === "long" ? "über" : "unter"} dem Cluster (${fmt(last!.close)})`
        : `${tf} schliesst ${side === "long" ? "unter" : "über"} dem Cluster`
      : "Kurs hat den Cluster noch nicht getestet",
    points: touched && closeOk ? 2 : 0,
    max: 2,
    state: touched && closeOk ? "ja" : "nein",
  });

  // Spot: letzte geschlossene + laufende Stunde (ab 15 Min) in Traderichtung.
  // Swing: 24 h UND 7 Tage in Traderichtung (eines davon = halb, 0 Punkte).
  if (swing) {
    const a = spotWord(swing.spot24hPct, side);
    const b = spotWord(swing.spot7dPct, side);
    const state = a === "ja" && b === "ja" ? "ja" : a === "ja" || b === "ja" ? "teil" : "nein";
    const val = (v: number | null) => (v === null ? "keine Daten" : `${signed(v)} %`);
    ev.push({
      id: "spot",
      text: `Spot ${side === "long" ? "kauft" : "verkauft"}? 24 h ${val(swing.spot24hPct)}, 7 Tage ${val(swing.spot7dPct)}`,
      points: state === "ja" ? 3 : 0,
      max: 3,
      state,
    });
  }
  const spot = spotConfirms(input.spotBars, side, input.nowMs);
  if (!swing) ev.push({
    id: "spot",
    text:
      spot === "ja"
        ? `Spot ${side === "long" ? "kauft" : "verkauft"}: letzte und laufende Stunde`
        : spot === "teil"
          ? `Spot: laufende Stunde ${side === "long" ? "kauft" : "verkauft"}, geschlossene noch nicht`
          : `Spot ${side === "long" ? "kauft" : "verkauft"} nicht mit`,
    points: spot === "ja" ? 3 : 0,
    max: 3,
    state: spot,
  });

  // Momentum-Gruppe (max. 2): Divergenz 2, Extrem 1, MACD-Kreuz 1, RSI-Mitte 1.
  const parts: string[] = [];
  let mom = 0;
  const n = closes.length;
  if (n >= 60) {
    const lows = c.map((k) => (side === "long" ? k.low : -k.high));
    const argMin = (from: number, to: number) => {
      let best = from;
      for (let i = from; i < to; i++) if (lows[i] < lows[best]) best = i;
      return best;
    };
    const a = argMin(n - 12, n);
    const b = argMin(n - 48, n - 12);
    if (lows[a] < lows[b] && (rsi[a] - rsi[b]) * dir > 0) {
      mom += 2;
      parts.push("RSI-Divergenz");
    }
    const recent = rsi.slice(-8);
    if (side === "long" ? Math.min(...recent) <= 30 : Math.max(...recent) >= 70) {
      mom += 1;
      parts.push(side === "long" ? "RSI unter 30" : "RSI über 70");
    }
    const e12 = emaSeries(closes, 12);
    const e26 = emaSeries(closes, 26);
    const macd = e12.map((v, i) => v - e26[i]);
    const sig = emaSeries(macd, 9);
    const crossed = [n - 3, n - 2, n - 1].some((i) => (macd[i - 1] - sig[i - 1]) * dir <= 0 && (macd[i] - sig[i]) * dir > 0);
    if (crossed) {
      mom += 1;
      parts.push("MACD-Kreuz");
    }
    if ((rsi[n - 1] - 50) * dir > 0) {
      mom += 1;
      parts.push(side === "long" ? "RSI über 50" : "RSI unter 50");
    }
  }
  ev.push({
    id: "momentum",
    text: parts.length > 0 ? `Momentum ${tf}: ${parts.join(", ")}` : `Momentum ${tf}: kein Signal`,
    points: Math.min(2, mom),
    max: 2,
    state: mom >= 2 ? "ja" : mom === 1 ? "teil" : "nein",
  });

  // Wenig Volumen beim Test: letzte Kerze unter dem Schnitt der 20 davor.
  const vols = c.map((k) => k.volume ?? null);
  const lastVol = vols[vols.length - 1];
  const prev = vols.slice(-21, -1).filter((v): v is number => v !== null);
  const avg = prev.length > 0 ? prev.reduce((s, v) => s + v, 0) / prev.length : null;
  const volOk = touched && lastVol !== null && avg !== null && lastVol < avg;
  ev.push({
    id: "volume",
    text:
      lastVol !== null && avg !== null
        ? `Volumen ${tf} ${fmt(lastVol)} ${lastVol < avg ? "unter" : "über"} Schnitt ${fmt(avg)}`
        : "Volumen: keine Daten",
    points: volOk ? 1 : 0,
    max: 1,
    state: volOk ? "ja" : "nein",
  });

  // Swing: ETF-Nettofluss der letzten Handelstage in Traderichtung (statt OI).
  if (swing) {
    const e = swing.etfUsdM;
    const ok = e !== null && (side === "long" ? e > 0 : e < 0);
    ev.push({
      id: "etf",
      text: e === null ? "ETF-Fluss: keine Daten" : `ETF ${swing.etfDays} Tage ${signed(e, 0)} Mio. USD${ok ? "" : ": gegen dich"}`,
      points: ok ? 1 : 0,
      max: 1,
      state: ok ? "ja" : "nein",
    });
  }

  // OI: Hebel abgebaut (OI faellt) spricht fuer die Gegenbewegung am Cluster.
  const oi = input.oiChangePct;
  if (!swing) ev.push({
    id: "oi",
    text: oi === null ? "OI: keine Daten" : `OI ${oi >= 0 ? "+" : "−"}${pct(Math.abs(oi))} %${oi <= 0 ? ": Hebel abgebaut" : ": neutral"}`,
    points: oi !== null && oi <= 0 ? 1 : 0,
    max: 1,
    state: oi !== null && oi <= 0 ? "ja" : "nein",
  });

  // Funding und Masse nicht gegen dich.
  const f = input.fundingPct;
  const crowd = input.crowdLongPct;
  const fundOk =
    f !== null &&
    (side === "long"
      ? f < FUNDING_ELEVATED_PCT && (crowd === null || crowd < CROWD_HEAVY_LONG * 100)
      : f > -FUNDING_ELEVATED_PCT && (crowd === null || crowd >= CROWD_SHORT * 100));
  ev.push({
    id: "funding",
    text:
      f === null
        ? "Funding: keine Daten"
        : `Funding ${pct(f, 3)} %${crowd !== null ? `, Masse ${Math.round(crowd)} % long` : ""}`,
    points: fundOk ? 1 : 0,
    max: 1,
    state: fundOk ? "ja" : "nein",
  });
  return ev;
}

// ---------- 4. Setup ----------
export function evaluateSetup(input: SetupInput): { ideas: SetupIdea[]; clusters: SetupCluster[]; levels: SetupLevel[] } {
  const { price, candles15m } = input;
  const closes = candles15m.map((k) => k.close);
  const ema50 = closes.length >= 60 ? emaSeries(closes, 50)[closes.length - 1] : null;
  const ema200 = closes.length >= 220 ? emaSeries(closes, 200)[closes.length - 1] : null;
  const levels = buildLevels({ ...input, ema50, ema200 });
  const clusters = buildClusters(levels);
  if (price === null || clusters.length === 0) return { ideas: [], clusters, levels };
  const rsi = rsiSeries(closes);
  const tol = AT_CLUSTER_PCT / 100;
  const intraday: Frame = { c: candles15m, closes, rsi, tf: "15m" };
  const swingData = input.swing && input.swing.candles4h.length >= 60 ? input.swing : null;
  const closes4h = swingData ? swingData.candles4h.map((k) => k.close) : [];
  const swingFrame: Frame | null = swingData ? { c: swingData.candles4h, closes: closes4h, rsi: rsiSeries(closes4h), tf: "4H" } : null;
  const ema50h4 = closes4h.length >= 60 ? emaSeries(closes4h, 50)[closes4h.length - 1] : null;
  const ema200h4 = closes4h.length >= 220 ? emaSeries(closes4h, 200)[closes4h.length - 1] : null;
  const noise4h = swingData ? hourlyNoisePct(swingData.candles4h) : null;

  // Herkunft: Schluss vor 4 Stunden (16 Kerzen), sonst der aktuelle Kurs.
  const before = closes.length > 16 ? closes[closes.length - 17] : price;
  const inside = (c: SetupCluster) => price >= c.lo * (1 - tol) && price <= c.hi * (1 + tol);
  const roleOf = (c: SetupCluster): Side => (inside(c) ? (before >= (c.lo + c.hi) / 2 ? "long" : "short") : price > c.hi ? "long" : "short");

  const idea = (side: Side): SetupIdea | null => {
    const cluster =
      side === "long"
        ? clusters.filter((c) => c.lo <= price * (1 + tol) && roleOf(c) === "long").sort((a, b) => b.hi - a.hi)[0]
        : clusters.filter((c) => c.hi >= price * (1 - tol) && roleOf(c) === "short").sort((a, b) => a.lo - b.lo)[0];
    if (!cluster) return null;
    const atCluster = price >= cluster.lo * (1 - tol) && price <= cluster.hi * (1 + tol);
    const distancePct = atCluster
      ? 0
      : side === "long"
        ? ((price - cluster.hi) / price) * 100
        : ((cluster.lo - price) / price) * 100;
    const isSwing = cluster.horizon === "swing" && swingFrame !== null;
    const entry = atCluster ? price : side === "long" ? cluster.hi : cluster.lo;
    const behind = stopBehindZone(side, { price: cluster.lo, low: cluster.lo, high: cluster.hi }, entry);
    const noise = isSwing ? noise4h : input.noisePct;
    const noiseStopPct = noise !== null ? noise * NOISE_WARN_FACTOR : 0;
    const minTarget = isSwing ? MIN_TARGET_SWING_PCT : MIN_TARGET_PCT;
    const stopWidened = noiseStopPct > behind.stopPct;
    const stopPct = stopWidened ? noiseStopPct : behind.stopPct;
    const stop = side === "long" ? entry * (1 - stopPct / 100) : entry * (1 + stopPct / 100);
    const risk = Math.abs(entry - stop);
    const targets = clusters
      .filter((c) => c !== cluster && (side === "long" ? c.lo >= entry * (1 + minTarget / 100) : c.hi <= entry * (1 - minTarget / 100)))
      .sort((a, b) => (side === "long" ? a.lo - b.lo : b.hi - a.hi))
      .slice(0, 2)
      .map((c) => {
        const p = side === "long" ? c.lo : c.hi;
        return {
          price: p,
          pct: (Math.abs(p - entry) / entry) * 100,
          crv: risk > 0 ? Math.abs(p - entry) / risk : 0,
          name: c.levels.filter((l) => l.own).map((l) => l.name).join(" + "),
        };
      });
    const evidence = isSwing
      ? evidenceFor(side, cluster, input, swingFrame!, swingData)
      : evidenceFor(side, cluster, input, intraday, null);
    const score = evidence.reduce((s, e) => s + e.points, 0);

    const against: string[] = [];
    const below = (v: number | null) => v !== null && (side === "long" ? price < v : price > v);
    const word = side === "long" ? "unter" : "über";
    if (isSwing) {
      if (below(ema50h4) && (ema200h4 === null || below(ema200h4))) against.push(`Kurs ${word} EMA 50${ema200h4 !== null ? " und 200" : ""} (4H)`);
      if (below(input.monthlyVwap)) against.push(`Kurs ${word} dem Monats-VWAP`);
      if (below(input.weeklyVwap)) against.push(`Kurs ${word} dem Wochen-VWAP`);
    } else {
      if (below(ema50) && below(ema200)) against.push(`Kurs ${word} EMA 50 und 200 (15m)`);
      if (below(input.weeklyVwap)) against.push(`Kurs ${word} dem Wochen-VWAP`);
      if (input.spot4h === (side === "long" ? "down" : "up")) against.push(`Spot ${side === "long" ? "verkauft" : "kauft"} über 4H`);
    }
    const halfSize: string[] = [];
    if (against.length >= 2) halfSize.push("Hintergrund gegen dich");
    if (input.dataDay) halfSize.push(`US-Datentag (${input.dataDay})`);

    const vetos: string[] = [];
    if (input.upcomingRisk) vetos.push(input.upcomingRisk);
    if (input.tradesToday >= MAX_TRADES_PER_DAY) vetos.push(`${MAX_TRADES_PER_DAY} Trades heute erreicht`);
    if (input.lossesInRow >= MAX_LOSSES_IN_ROW) vetos.push(`${MAX_LOSSES_IN_ROW} Verluste in Folge`);
    if (targets.length === 0) vetos.push(`Kein Ziel ab ${minTarget} %`);
    else if (targets[0].crv < MIN_CRV) vetos.push(`CRV ${pct(targets[0].crv)} unter ${MIN_CRV}`);

    const sideWord = side === "long" ? "Long" : "Short";
    const range = cluster.lo === cluster.hi ? fmt(cluster.lo) : `${fmt(cluster.lo)}–${fmt(cluster.hi)}`;
    let verdict: SetupIdea["verdict"];
    if (!atCluster) verdict = { tone: "wait", short: `${sideWord}-Idee ${range}: ${pct(distancePct)} % entfernt` };
    else if (vetos.length > 0) verdict = { tone: "stop", short: `Veto: ${vetos[0]}` };
    else if (score >= SETUP_MIN_POINTS) verdict = { tone: "trade", short: `${sideWord}-Setup steht (${score}/${MAX_POINTS})` };
    else verdict = { tone: "watch", short: `${sideWord} ${range} beobachten (${score}/${MAX_POINTS})` };

    return {
      side,
      cluster,
      atCluster,
      distancePct,
      entry,
      stop,
      stopPct,
      stopWidened,
      swingEvidence: isSwing,
      targets,
      leverage: leverageForStop(stopPct),
      evidence,
      score,
      against,
      halfSize,
      vetos,
      verdict,
    };
  };

  const ideas = [idea("long"), idea("short")].filter((x): x is SetupIdea => x !== null);
  // Am Cluster zuerst, dann die naehere Idee; bei zwei Ideen am Cluster die mit mehr Belegen.
  ideas.sort((a, b) => Number(b.atCluster) - Number(a.atCluster) || (a.atCluster ? b.score - a.score : a.distancePct - b.distancePct));
  return { ideas, clusters, levels };
}

// ---------- 5. Swing-Eingaben (get_swing_inputs) ----------
export interface SwingInputsRow {
  candles4h?: { open_time: string; open: number; high: number; low: number; close: number; volume: number | null }[];
  spot24h?: { buy: number | null; sell: number | null } | null;
  spot7d?: { buy: number | null; sell: number | null } | null;
  etf?: { flow_date: string; usd_m: number | null }[];
}

function netPct(s: { buy: number | null; sell: number | null } | null | undefined): number | null {
  const b = Number(s?.buy ?? 0);
  const v = Number(s?.sell ?? 0);
  return b + v > 0 ? ((b - v) / (b + v)) * 100 : null;
}

export function parseSwingInputs(row: SwingInputsRow | null | undefined, nowMs: number): SwingInput | null {
  if (!row) return null;
  const candles4h = (row.candles4h ?? [])
    .map((r) => ({
      openTime: r.open_time,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: r.volume === null ? undefined : Number(r.volume),
    }))
    .filter((k) => Date.parse(k.openTime) + 4 * 3_600_000 <= nowMs);
  const etf = (row.etf ?? []).filter((e) => e.usd_m !== null);
  return {
    candles4h,
    spot24hPct: netPct(row.spot24h),
    spot7dPct: netPct(row.spot7d),
    etfUsdM: etf.length > 0 ? etf.reduce((s, e) => s + Number(e.usd_m), 0) : null,
    etfDays: etf.length,
  };
}
