import {
  HOUR_MS,
  LAGE_KEYS,
  nf,
  type LageEvent,
  type LageKey,
  type LagePoint,
} from "./lageChart";

// Lage-Chart: zeichnet alle Spuren als EIN SVG-String (gemeinsame Zeitachse).
// Farben kommen ueber CSS-Klassen "lc-*" aus app/globals.css. Texte aus der
// Datenbank (Termin-Namen) werden mit esc() entschaerft, weil der String per
// dangerouslySetInnerHTML eingesetzt wird.

export interface LageDrawOpts {
  ema20: boolean;
  ema50: boolean;
  ema200: boolean;
  wvwap: boolean;
  mvwap: boolean;
  zones: boolean;
  walls: boolean;
  struct: boolean;
  rsi: boolean;
}

export interface LageZone {
  low: number;
  high: number;
  label: string | null;
}

export interface LageWall {
  side: "bid" | "ask";
  price: number;
  usd: number;
}

export interface LageGeom {
  mL: number;
  st: number;
  n: number;
  /** Index (in points) der ersten sichtbaren Kerze. */
  i0: number;
  W: number;
  H: number;
}

const ZONE_RANGE_PCT = 3;
/** Linien innerhalb dieses Anteils des Preises ausserhalb der Kerzen zaehlen noch zur Achse. */
const LINE_RANGE_MARGIN = 0.02;
const STRUCT_MIN_GAP_PX = 34;
const TZ = "Europe/Zurich";
const dtf = new Intl.DateTimeFormat("de-CH", {
  timeZone: TZ,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
interface Meta {
  wd: string;
  day: string;
  hh: number;
  hm: string;
}
const metaCache = new Map<number, Meta>();
export function metaOf(t: number): Meta {
  const hit = metaCache.get(t);
  if (hit) return hit;
  const p: Record<string, string> = {};
  for (const x of dtf.formatToParts(new Date(t))) p[x.type] = x.value;
  const m = { wd: p.weekday.replace(".", ""), day: `${p.day}.${p.month}.`, hh: Number(p.hour), hm: `${p.hour}:${p.minute}` };
  metaCache.set(t, m);
  return m;
}
export const whenText = (t: number): string => {
  const m = metaOf(t);
  return `${m.wd} ${m.day} ${m.hm}`;
};

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const lin = (a: number, b: number, top: number, bot: number) => (v: number) => bot - ((v - a) / (b - a || 1)) * (bot - top);

function niceTicks(min: number, max: number, count: number): number[] {
  const raw = (max - min) / count;
  if (!(raw > 0)) return [];
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  const t: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) t.push(v);
  return t;
}

const fmtTick = (v: number, d: number) => nf(Math.abs(v) < Math.pow(10, -d) / 2 ? 0 : v, d);

export function drawLage(args: {
  points: LagePoint[];
  n: number;
  width: number;
  hours: number;
  opts: LageDrawOpts;
  zones: LageZone[];
  walls: LageWall[];
  events: LageEvent[];
  /** Vollbild: Hoehe der Preis-Spur in px und Faktor fuer die kleinen Spuren. */
  priceHeight?: number;
  subScale?: number;
}): { svg: string; geom: LageGeom; height: number } {
  const { points, opts, hours } = args;
  const W = Math.max(300, Math.floor(args.width));
  const phone = W < 560;
  const mL = 8;
  const mR = 62;
  const n = Math.min(args.n, points.length);
  const i0 = points.length - n;
  const vis = points.slice(i0);
  const L = W - mR;
  const pw = L - mL;
  const st = pw / n;
  const X = (j: number) => mL + (j + 0.5) * st;
  const o: string[] = [];

  const sub = args.subScale ?? 1;
  const panes: { id: string; h: number; title?: string; y: number; top: number; bot: number }[] = [
    { id: "price", h: args.priceHeight ?? (phone ? 250 : 330) },
    { id: "rib", h: LAGE_KEYS.length * 14 + 20, title: "Lage-Verlauf" },
    { id: "cvd", h: Math.round(72 * sub), title: "Fluss · CVD kumuliert (BTC)" },
    { id: "oi", h: Math.round(62 * sub), title: "Fluss · Offenes Interesse Δ (%)" },
    { id: "fund", h: Math.round(66 * sub), title: "Positionierung · Funding (%)" },
    { id: "basis", h: Math.round(62 * sub), title: "Positionierung · Basis (%)" },
    ...(opts.rsi ? [{ id: "rsi", h: Math.round(72 * sub), title: "Momentum · RSI 14" }] : []),
  ].map((p) => ({ ...p, y: 0, top: 0, bot: 0 }));
  let y = 8;
  for (const p of panes) {
    p.y = y;
    p.top = y + (p.id === "price" ? (phone ? 40 : 24) : 18);
    p.bot = y + p.h;
    y += p.h + 14;
  }
  const H = y - 14 + 24;
  const pane = (id: string) => panes.find((p) => p.id === id);
  const bw = Math.max(1, st * 0.64);

  // Tageswechsel (Schweizer Zeit)
  const days: number[] = [];
  vis.forEach((x, j) => {
    const prev = j > 0 ? vis[j - 1] : points[i0 - 1];
    if (prev && metaOf(prev.t).day !== metaOf(x.t).day) days.push(j);
  });
  for (const j of days) {
    const x = X(j) - st / 2;
    o.push(`<line class="lc-gd" x1="${x}" x2="${x}" y1="8" y2="${H - 24}"/>`);
  }
  for (const p of panes) {
    if (p.title) o.push(`<text class="lc-tt" x="${mL}" y="${p.y + 10}">${esc(p.title.toUpperCase())}</text>`);
  }

  const axis = (p: { top: number; bot: number }, lo: number, hi: number, d: number, count = 2, fmt?: (v: number) => string) => {
    const Y = lin(lo, hi, p.top, p.bot);
    for (const v of niceTicks(lo, hi, count)) {
      o.push(
        `<line class="lc-g" x1="${mL}" x2="${L}" y1="${Y(v)}" y2="${Y(v)}"/><text class="lc-tx" x="${L + 6}" y="${Y(v) + 3}">${fmt ? fmt(v) : fmtTick(v, d)}</text>`
      );
    }
    return Y;
  };
  /** Linie mit Luecken bei fehlenden Werten. */
  const pathOf = (get: (x: LagePoint) => number | null, Y: (v: number) => number, breakAt?: (x: LagePoint) => boolean) => {
    let d = "";
    let pen = false;
    vis.forEach((x, j) => {
      const v = get(x);
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen && !(breakAt && breakAt(x)) ? "L" : "M"}${X(j).toFixed(1)} ${Y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  // ---------- Preis ----------
  {
    const p = pane("price")!;
    const last = vis[vis.length - 1];
    let lo = Math.min(...vis.map((x) => x.low));
    let hi = Math.max(...vis.map((x) => x.high));
    const near = (v: number) => Math.abs(v - last.close) / last.close <= ZONE_RANGE_PCT / 100;
    const zones = opts.zones ? args.zones.filter((z) => near(z.low) || near(z.high)) : [];
    const walls = opts.walls ? args.walls.filter((w) => near(w.price)) : [];
    for (const z of zones) {
      lo = Math.min(lo, z.low);
      hi = Math.max(hi, z.high);
    }
    for (const w of walls) {
      lo = Math.min(lo, w.price);
      hi = Math.max(hi, w.price);
    }
    const lines: { key: "ema20" | "ema50" | "ema200" | "wvwap" | "mvwap"; cls: string; dash?: string }[] = [
      { key: "ema200", cls: "lc-e200" },
      { key: "ema50", cls: "lc-e50" },
      { key: "ema20", cls: "lc-e20" },
      { key: "mvwap", cls: "lc-mv", dash: "8 3 2 3" },
      { key: "wvwap", cls: "lc-wv", dash: "5 3" },
    ];
    // Linien weit ausserhalb der Kerzen (z.B. Monats-VWAP 4 % entfernt) dehnen die
    // Achse nicht, sonst werden die Kerzen flach. Sie werden abgeschnitten und
    // am Rand mit Wert und Pfeil beschriftet.
    const rLo = lo;
    const rHi = hi;
    const margin = last.close * LINE_RANGE_MARGIN;
    for (const l of lines) {
      if (!opts[l.key]) continue;
      for (const x of vis) {
        const v = x[l.key];
        if (v !== null && v >= rLo - margin && v <= rHi + margin) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
    }
    const pad = (hi - lo) * 0.05;
    lo -= pad;
    hi += pad;
    const Y = lin(lo, hi, p.top, p.bot);
    for (const v of niceTicks(lo, hi, phone ? 4 : 5)) {
      o.push(`<line class="lc-g" x1="${mL}" x2="${L}" y1="${Y(v)}" y2="${Y(v)}"/><text class="lc-tx" x="${L + 6}" y="${Y(v) + 3}">${nf(v)}</text>`);
    }
    // Zonen: ueber dem Kurs Verkaeufer-Zone, darunter Kaeufer-Zone
    for (const z of zones) {
      const above = (z.low + z.high) / 2 >= last.close;
      const top = Y(z.high);
      const h = Math.max(2, Y(z.low) - top);
      o.push(
        `<rect class="${above ? "lc-zr" : "lc-zs"}" x="${mL}" y="${top}" width="${pw}" height="${h}" fill-opacity=".12"/>`
      );
      if (z.label) o.push(`<text class="lc-tx" x="${mL + 4}" y="${top + 11}">${esc(z.label)}</text>`);
    }
    for (const w of walls) {
      const usd = w.usd >= 1e6 ? `$${nf(w.usd / 1e6, 1)}M` : `$${nf(w.usd / 1e3, 0)}K`;
      o.push(
        `<line class="${w.side === "ask" ? "lc-wa" : "lc-wb"}" x1="${mL}" x2="${L}" y1="${Y(w.price)}" y2="${Y(w.price)}" stroke-width="1.5" stroke-dasharray="1 4" stroke-linecap="round"/>`,
        `<text class="lc-tx" text-anchor="end" x="${L - 4}" y="${Y(w.price) - 4}">${w.side === "ask" ? "Ask" : "Bid"}-Wand ${usd}</text>`
      );
    }
    // Termine
    for (const e of args.events) {
      const idx = points.findIndex((x) => x.t <= e.t && e.t < x.t + hours * HOUR_MS);
      if (idx < i0) continue;
      const j = idx - i0;
      const right = j > n / 2;
      o.push(
        `<line class="lc-ev" x1="${X(j)}" x2="${X(j)}" y1="${p.top - 4}" y2="${H - 24}" stroke-dasharray="4 3"/>`,
        `<text class="lc-tx lc-evt" text-anchor="${right ? "end" : "start"}" x="${X(j) + (right ? -4 : 4)}" y="${p.top + 8}">${esc(e.label)}</text>`
      );
    }
    vis.forEach((x, j) => {
      const c = x.close >= x.open ? "lc-up" : "lc-dn";
      const cx = X(j);
      o.push(
        `<line class="${c}" x1="${cx}" x2="${cx}" y1="${Y(x.high)}" y2="${Y(x.low)}" stroke-width="1"/>`,
        `<rect class="${c}" x="${cx - bw / 2}" y="${Math.min(Y(x.open), Y(x.close))}" width="${bw}" height="${Math.max(1, Math.abs(Y(x.open) - Y(x.close)))}" stroke-width="0"/>`
      );
    });
    o.push(`<clipPath id="lcp"><rect x="${mL}" y="${p.top - 2}" width="${pw}" height="${p.bot - p.top + 4}"/></clipPath><g clip-path="url(#lcp)">`);
    for (const l of lines) {
      if (!opts[l.key]) continue;
      const brk =
        l.key === "wvwap" ? (x: LagePoint) => x.wBreak : l.key === "mvwap" ? (x: LagePoint) => x.mBreak : undefined;
      const d = pathOf((x) => x[l.key], Y, brk);
      if (d)
        o.push(
          `<path class="${l.cls}" d="${d}" fill="none" stroke-width="1.5" stroke-linejoin="round"${l.dash ? ` stroke-dasharray="${l.dash}"` : ""}/>`
        );
    }
    o.push("</g>");
    // Linien ausserhalb des Bildes: Wert am Rand
    let upN = 0;
    let downN = 0;
    for (const l of lines) {
      const v = opts[l.key] ? last[l.key] : null;
      if (v === null) continue;
      const name = l.key === "wvwap" ? "VWAP Woche" : l.key === "mvwap" ? "VWAP Monat" : l.key === "ema200" ? "EMA 200" : l.key === "ema50" ? "EMA 50" : "EMA 20";
      if (v > hi) {
        o.push(`<text class="${l.cls}-t lc-tx" text-anchor="end" x="${L - 4}" y="${p.top + 10 + 11 * upN++}">${name} ${nf(v)} ↑</text>`);
      } else if (v < lo) {
        o.push(`<text class="${l.cls}-t lc-tx" text-anchor="end" x="${L - 4}" y="${p.bot - 4 - 11 * downN++}">${name} ${nf(v)} ↓</text>`);
      }
    }
    if (opts.struct) {
      let lastX = -1e9;
      vis.forEach((x, j) => {
        if (!x.structure) return;
        // BOS-Beschriftungen mit Mindestabstand, CHoCH immer
        if (x.structure.type === "BOS" && X(j) - lastX < STRUCT_MIN_GAP_PX) return;
        lastX = X(j);
        const up = x.structure.dir > 0;
        o.push(
          `<text text-anchor="middle" font-size="9" font-weight="600" class="${up ? "lc-c-bull" : "lc-c-bear"}" x="${X(j)}" y="${up ? Y(x.high) - 6 : Y(x.low) + 13}">${x.structure.type}</text>`
        );
      });
    }
    // Preis-Tag
    const ly = Y(last.close);
    const cc = last.close >= last.open ? "lc-up" : "lc-dn";
    o.push(
      `<line class="${cc}" x1="${mL}" x2="${L}" y1="${ly}" y2="${ly}" stroke-width="1" stroke-dasharray="2 3"/>`,
      `<rect class="${cc}" x="${L + 1}" y="${ly - 8}" width="${mR - 2}" height="16" rx="3" stroke-width="0"/><text class="lc-tag" x="${L + 6}" y="${ly + 3.5}">${nf(last.close)}</text>`
    );
    // Titel + Legende
    o.push(`<text class="lc-tt" x="${mL}" y="${p.y + 10}">PREIS · BTCUSDT ${hours}H</text>`);
    const items: [string, string, string, boolean][] = [
      ["EMA 20", "lc-e20", "", opts.ema20],
      ["EMA 50", "lc-e50", "", opts.ema50],
      ["EMA 200", "lc-e200", "", opts.ema200],
      ["VWAP Woche", "lc-wv", "4 2", opts.wvwap],
      ["VWAP Monat", "lc-mv", "7 2 2 2", opts.mvwap],
    ];
    let lx = phone ? mL : 150;
    const ly0 = p.y + 7 + (phone ? 14 : 0);
    for (const [t, cls, dash, on] of items) {
      if (!on) continue;
      o.push(
        `<line class="${cls}" x1="${lx}" x2="${lx + 14}" y1="${ly0}" y2="${ly0}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ""}/><text class="lc-tx" x="${lx + 18}" y="${ly0 + 3}">${t}</text>`
      );
      lx += t.length * 6.2 + 30;
    }
  }

  // ---------- Lage-Verlauf ----------
  {
    const p = pane("rib")!;
    const names: Record<LageKey, string> = { trend: "Trend", flow: "Fluss", fund: "Funding", risk: "Risiko" };
    LAGE_KEYS.forEach((k, r) => {
      const ry = p.top + r * 14;
      o.push(`<text class="lc-tx" x="${L + 6}" y="${ry + 9}">${names[k]}</text>`);
      vis.forEach((x, j) => {
        const s = x.states[k];
        o.push(
          `<rect class="lc-c-${s.kind}" x="${X(j) - st / 2 + 0.5}" y="${ry}" width="${Math.max(1, st - 1)}" height="11" rx="1.5" fill-opacity="${s.kind === "flat" ? 0.55 : 0.95}"/>`
        );
      });
    });
  }

  // ---------- CVD ----------
  {
    const p = pane("cvd")!;
    const base = vis.find((x) => x.cvdCum !== null)?.cvdCum ?? 0;
    const get = (x: LagePoint) => (x.cvdCum === null ? null : x.cvdCum - base);
    const vals = vis.map(get).filter((v): v is number => v !== null);
    let lo = Math.min(0, ...vals);
    let hi = Math.max(0, ...vals);
    const pad = (hi - lo) * 0.08 || 1;
    lo -= pad;
    hi += pad;
    const Y = axis(p, lo, hi, 1, 2, (v) => `${nf(v / 1000, 1)}k`);
    const d = pathOf(get, Y);
    o.push(`<path class="lc-acc" d="${d}" fill="none" stroke-width="1.75" stroke-linejoin="round"/>`);
  }
  // ---------- OI ----------
  {
    const p = pane("oi")!;
    const m = Math.max(0.01, ...vis.map((x) => Math.abs(x.oiDeltaPct ?? 0))) * 1.1;
    const Y = axis(p, -m, m, 2, 2);
    const z = Y(0);
    vis.forEach((x, j) => {
      if (x.oiDeltaPct === null) return;
      const yy = Y(x.oiDeltaPct);
      o.push(
        `<rect class="${x.oiDeltaPct >= 0 ? "lc-f-acc" : "lc-f-flat"}" x="${X(j) - bw / 2}" y="${Math.min(yy, z)}" width="${bw}" height="${Math.max(1, Math.abs(yy - z))}"/>`
      );
    });
  }
  // ---------- Funding ----------
  {
    const p = pane("fund")!;
    const vals = vis.map((x) => x.funding).filter((v): v is number => v !== null);
    const lo = Math.min(-0.01, ...vals) * 1.1;
    const hi = Math.max(0.05, ...vals) * 1.1;
    const Y = axis(p, lo, hi, 3, 2);
    for (const v of [0.025, 0.045]) {
      o.push(`<line class="lc-th" x1="${mL}" x2="${L}" y1="${Y(v)}" y2="${Y(v)}" stroke-dasharray="2 4"/>`);
    }
    const z = Y(0);
    vis.forEach((x, j) => {
      if (x.funding === null) return;
      const f = x.funding;
      const cls = f > 0.045 || f < -0.02 ? "lc-f-hot" : f > 0.025 || f < -0.005 ? "lc-f-warn" : "lc-f-flat";
      const yy = Y(f);
      o.push(`<rect class="${cls}" x="${X(j) - bw / 2}" y="${Math.min(yy, z)}" width="${bw}" height="${Math.max(1, Math.abs(yy - z))}"/>`);
    });
  }
  // ---------- Basis ----------
  {
    const p = pane("basis")!;
    const vals = vis.map((x) => x.basisPct).filter((v): v is number => v !== null);
    if (vals.length === 0) {
      o.push(`<text class="lc-tx" x="${mL}" y="${p.top + 24}">Keine Basis-Daten in diesem Zeitraum.</text>`);
    } else {
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      const pad = (hi - lo) * 0.15 || 0.01;
      const Y = axis(p, lo - pad, hi + pad, 2, 2);
      o.push(`<path class="lc-e50" d="${pathOf((x) => x.basisPct, Y)}" fill="none" stroke-width="1.75" stroke-linejoin="round"/>`);
    }
  }
  // ---------- RSI ----------
  if (opts.rsi) {
    const p = pane("rsi")!;
    const Y = lin(0, 100, p.top, p.bot);
    for (const v of [30, 50, 70]) {
      o.push(`<line class="${v === 50 ? "lc-g" : "lc-gd"}" x1="${mL}" x2="${L}" y1="${Y(v)}" y2="${Y(v)}"/><text class="lc-tx" x="${L + 6}" y="${Y(v) + 3}">${v}</text>`);
    }
    o.push(`<path class="lc-acc" d="${pathOf((x) => x.rsi, Y)}" fill="none" stroke-width="1.75"/>`);
  }

  // ---------- Zeitachse ----------
  {
    const ey = H - 8;
    const need = Math.ceil(66 / st);
    const hs = [1, 2, 3, 4, 6, 12, 24];
    const everyH = hs.find((h) => h >= need) ?? 24;
    vis.forEach((x, j) => {
      const m = metaOf(x.t);
      const show = hours === 1 ? m.hh % everyH === 0 : (points.length - 1 - (i0 + j)) % Math.max(1, need) === 0;
      if (!show) return;
      const isDay = m.hh < hours;
      o.push(
        `<text class="lc-tx${isDay ? " lc-day" : ""}" text-anchor="middle" x="${X(j)}" y="${ey}">${isDay ? `${m.wd} ${m.day.slice(0, 5)}` : m.hm}</text>`
      );
    });
  }

  return { svg: o.join(""), geom: { mL, st, n, i0, W, H }, height: H };
}

