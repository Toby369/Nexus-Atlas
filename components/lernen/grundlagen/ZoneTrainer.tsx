"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { supabase } from "@/lib/supabase";
import {
  MAX_ZONES,
  REGIME_TEXT,
  ZONE_FUTURE_CANDLES,
  ZONE_HIST_CANDLES,
  ZONE_RESULT_LABELS,
  classifyRegime,
  evaluateZone,
  referenceZones,
  zoneTips,
  type Ohlc,
  type Zone,
  type ZoneResultKind,
} from "@/lib/grundlagen/zones";
import { Pill, ToolBox, formatNum, type Tone } from "./ui";

// Zufaelliger 4H-Ausschnitt aus der Nexus-Kerzenhistorie (Binance-Perp seit
// 09/2022): 20 Tage sichtbar, 6 Tage verdeckt. Liest nur vorhandene Daten.

const W = 1000;
const H = 480;
const PAD = { l: 8, r: 70, t: 14, b: 26 };
const CLICK_PCT = 0.004;
const FOUR_H = 4 * 3600_000;
const DAY = 24 * 3600_000;
const FIRST_CUT = Date.parse("2022-09-25T00:00:00Z");
const ZONE_COLOR = "#6f9fd8";

const RESULT_TONE: Record<ZoneResultKind, Tone> = { react: "bullish", break: "bearish", weak: "watch", none: "neutral" };
const RESULT_STROKE: Record<ZoneResultKind, string> = {
  react: "var(--up)",
  break: "var(--down)",
  weak: "var(--accent)",
  none: "var(--text-faint)",
};

interface Window {
  t0: number;
  cut: number;
  candles: Ohlc[];
  nHist: number;
}

async function loadRandomWindow(): Promise<Window | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = Date.now() - 7 * DAY;
    const cut = Math.floor((FIRST_CUT + Math.random() * (latest - FIRST_CUT)) / FOUR_H) * FOUR_H;
    const start = cut - ZONE_HIST_CANDLES * FOUR_H;
    const { data, error } = await supabase
      .from("candles")
      .select("open_time, open, high, low, close")
      .eq("exchange", "binance")
      .eq("symbol", "BTCUSDT")
      .eq("interval", "4h")
      .gte("open_time", new Date(start).toISOString())
      .order("open_time", { ascending: true })
      .limit(ZONE_HIST_CANDLES + ZONE_FUTURE_CANDLES);
    if (error) {
      console.error("ZoneTrainer: Fehler beim Laden der 4H-Kerzen:", error.message);
      return null;
    }
    const rows = data ?? [];
    const nHist = rows.filter((r) => Date.parse(r.open_time as string) < cut).length;
    if (rows.length >= ZONE_HIST_CANDLES + ZONE_FUTURE_CANDLES - 2 && nHist >= ZONE_HIST_CANDLES - 2) {
      return {
        t0: Date.parse(rows[0].open_time as string),
        cut,
        nHist,
        candles: rows.map((r) => [Number(r.open), Number(r.high), Number(r.low), Number(r.close)] as Ohlc),
      };
    }
  }
  return null;
}

function niceStep(range: number): number {
  const raw = range / 7;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

function dateLabel(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCFullYear()).slice(2)}`;
}

export default function ZoneTrainer() {
  const [win, setWin] = useState<Window | null>(null);
  const [loading, setLoading] = useState(true);
  const [zones, setZones] = useState<Zone[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [tally, setTally] = useState({ react: 0, reached: 0, rounds: 0 });
  const [drag, setDrag] = useState<{ y0: number; y1: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const next = useCallback(async () => {
    setLoading(true);
    setZones([]);
    setRevealed(false);
    setWin(await loadRandomWindow());
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadRandomWindow().then((w) => {
      if (cancelled) return;
      setWin(w);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading && !win) return <ToolBox title="Zonen-Trainer · echte 4H-Charts">{<p className="text-xs text-text-faint">Lade Ausschnitt…</p>}</ToolBox>;
  if (!win) {
    return (
      <ToolBox title="Zonen-Trainer · echte 4H-Charts">
        <p className="text-xs text-text-faint">Kerzen konnten nicht geladen werden.</p>
        <button type="button" onClick={next} className="text-[11px] px-2 py-0.5 rounded border border-accent/40 text-accent">
          Erneut versuchen
        </button>
      </ToolBox>
    );
  }

  const { candles, nHist } = win;
  const last = candles[nHist - 1][3];
  const shown = revealed ? candles : candles.slice(0, nHist);
  let lo = Math.min(...shown.map((k) => k[2]));
  let hi = Math.max(...shown.map((k) => k[1]));
  for (const z of zones) {
    lo = Math.min(lo, z.lo);
    hi = Math.max(hi, z.hi);
  }
  const span = hi - lo;
  lo -= span * 0.08;
  hi += span * 0.08;
  const cw = (W - PAD.l - PAD.r) / candles.length;
  const x = (i: number) => PAD.l + i * cw + cw / 2;
  const y = (p: number) => PAD.t + ((hi - p) / (hi - lo)) * (H - PAD.t - PAD.b);
  const priceAt = (py: number) => hi - ((py - PAD.t) / (H - PAD.t - PAD.b)) * (hi - lo);
  const xCut = x(nHist) - cw / 2;
  const step = niceStep(hi - lo);
  const gridPrices: number[] = [];
  for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) gridPrices.push(p);

  const results = zones.map((z) => evaluateZone(candles, nHist, z));
  const refs = revealed ? referenceZones(candles, nHist) : [];
  const refResults = refs.map((z) => evaluateZone(candles, nHist, z));
  const reached = results.filter((r) => r.kind !== "none").length;
  const good = results.filter((r) => r.kind === "react").length;

  function svgY(e: ReactPointerEvent<SVGSVGElement>): number {
    const r = svgRef.current!.getBoundingClientRect();
    return ((e.clientY - r.top) / r.height) * H;
  }

  function onDown(e: ReactPointerEvent<SVGSVGElement>) {
    const target = e.target as Element;
    const zi = target.getAttribute("data-zone");
    if (zi !== null) {
      setZones((zs) => zs.filter((_, i) => i !== Number(zi)));
      return;
    }
    if (zones.length >= MAX_ZONES) return;
    const py = svgY(e);
    if (py < PAD.t || py > H - PAD.b) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    setDrag({ y0: py, y1: py });
    e.preventDefault();
  }

  function onMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (drag) setDrag({ ...drag, y1: svgY(e) });
  }

  function onUp() {
    if (!drag) return;
    let a = priceAt(drag.y0);
    let b = priceAt(drag.y1);
    if (Math.abs(drag.y1 - drag.y0) < 6) {
      b = a * (1 + CLICK_PCT);
      a = a * (1 - CLICK_PCT);
    }
    setZones((zs) => [...zs, { lo: Math.min(a, b), hi: Math.max(a, b) }]);
    setDrag(null);
  }

  function reveal() {
    setRevealed(true);
    setTally((t) => ({ react: t.react + good, reached: t.reached + reached, rounds: t.rounds + 1 }));
  }

  const above = zones.filter((z) => z.lo > last).length;
  const below = zones.filter((z) => z.hi < last).length;
  const regime = classifyRegime(candles, nHist);
  const tips = revealed ? zoneTips(candles, nHist, zones) : [];

  return (
    <ToolBox title="Zonen-Trainer · echte 4H-Charts">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-text-faint">
          {revealed ? (
            <>
              {dateLabel(win.t0)} bis {dateLabel(win.cut + (candles.length - nHist) * FOUR_H)} · Binance BTC-Perp
            </>
          ) : (
            <>
              Letzter Schluss <span className="font-mono text-text">{formatNum(last)}</span> · Zonen darüber {above}, darunter {below} ·{" "}
              {zones.length}/{MAX_ZONES}
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setZones((zs) => zs.slice(0, -1))}
            disabled={zones.length === 0}
            className="text-[11px] px-2 py-0.5 rounded border border-border text-text-muted disabled:opacity-40"
          >
            Letzte löschen
          </button>
          {!revealed ? (
            <button
              type="button"
              onClick={reveal}
              disabled={zones.length === 0}
              className="text-[11px] px-2 py-0.5 rounded border border-accent/40 text-accent disabled:opacity-40"
            >
              Aufdecken
            </button>
          ) : (
            <button type="button" onClick={next} className="text-[11px] px-2 py-0.5 rounded border border-accent/40 text-accent">
              Neuer Ausschnitt
            </button>
          )}
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto select-none touch-none"
        role="img"
        aria-label="4H-Kerzenchart zum Einzeichnen von Zonen"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
      >
        {gridPrices.map((p) => (
          <g key={p}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(p)} y2={y(p)} stroke="var(--border)" strokeWidth={0.6} />
            <text x={W - PAD.r + 6} y={y(p) + 4} fill="var(--text-faint)" fontSize={12} fontFamily="var(--font-mono)">
              {formatNum(p)}
            </text>
          </g>
        ))}
        {Array.from({ length: Math.ceil(candles.length / 12) }, (_, j) => j * 12).map((i) => (
          <text key={i} x={x(i)} y={H - 7} fill="var(--text-faint)" fontSize={11} textAnchor="middle" fontFamily="var(--font-mono)">
            {revealed ? dateLabel(win.t0 + i * FOUR_H).slice(0, 6) : i < nHist ? `Tag ${i / 6 + 1}` : ""}
          </text>
        ))}
        <rect
          x={xCut}
          y={PAD.t}
          width={W - PAD.r - xCut}
          height={H - PAD.t - PAD.b}
          fill="var(--surface-raised)"
          opacity={revealed ? 0.4 : 1}
        />
        {!revealed && (
          <text x={(xCut + W - PAD.r) / 2} y={H / 2} fill="var(--text-faint)" fontSize={15} textAnchor="middle">
            nächste 6 Tage
          </text>
        )}
        <line x1={xCut} x2={xCut} y1={PAD.t} y2={H - PAD.b} stroke="var(--border)" strokeDasharray="4 4" />

        {refs.map((z, i) => (
          <rect
            key={`ref-${i}`}
            x={PAD.l}
            width={W - PAD.r - PAD.l}
            y={y(z.hi)}
            height={Math.max(2, y(z.lo) - y(z.hi))}
            fill="none"
            stroke="var(--accent)"
            strokeDasharray="5 4"
            opacity={0.8}
          />
        ))}

        {zones.map((z, i) => {
          const stroke = revealed ? RESULT_STROKE[results[i].kind] : ZONE_COLOR;
          return (
            <g key={`z-${i}`}>
              <rect
                data-zone={i}
                x={PAD.l}
                width={W - PAD.r - PAD.l}
                y={y(z.hi)}
                height={Math.max(3, y(z.lo) - y(z.hi))}
                fill={ZONE_COLOR}
                fillOpacity={0.2}
                stroke={stroke}
                className="cursor-pointer"
              />
              <text x={PAD.l + 6} y={y(z.hi) - 4} fill={stroke} fontSize={12}>
                {revealed ? `${i + 1} · ${ZONE_RESULT_LABELS[results[i].kind]}` : i + 1}
              </text>
            </g>
          );
        })}

        {shown.map(([o, h, l, c], i) => {
          const col = c >= o ? "var(--up)" : "var(--down)";
          const bw = Math.max(1.5, cw * 0.62);
          return (
            <g key={i}>
              <line x1={x(i)} x2={x(i)} y1={y(h)} y2={y(l)} stroke={col} strokeWidth={1} />
              <rect x={x(i) - bw / 2} y={y(Math.max(o, c))} width={bw} height={Math.max(1, Math.abs(y(o) - y(c)))} fill={col} />
            </g>
          );
        })}

        <line x1={PAD.l} x2={W - PAD.r} y1={y(last)} y2={y(last)} stroke="var(--accent)" opacity={0.7} />
        <rect x={W - PAD.r + 2} y={y(last) - 9} width={PAD.r - 4} height={18} rx={3} fill="var(--accent)" />
        <text x={W - PAD.r + 6} y={y(last) + 4} fill="var(--bg)" fontSize={12} fontWeight={600} fontFamily="var(--font-mono)">
          {formatNum(last)}
        </text>

        {drag && (
          <rect
            x={PAD.l}
            width={W - PAD.r - PAD.l}
            y={Math.min(drag.y0, drag.y1)}
            height={Math.max(2, Math.abs(drag.y1 - drag.y0))}
            fill={ZONE_COLOR}
            fillOpacity={0.3}
            stroke={ZONE_COLOR}
            strokeDasharray="3 3"
          />
        )}
      </svg>

      {!revealed && (
        <p className="text-[11px] text-text-faint">
          Senkrecht ziehen zeichnet eine Zone von Docht bis Körper, ein Klick setzt ±0,4 %, Klick auf eine Zone löscht sie.
          Zeichne die nächsten 1–2 Zonen über und unter dem letzten Preis.
        </p>
      )}

      {revealed && (
        <div className="rounded-md bg-surface-raised p-3 space-y-2" aria-live="polite">
          <p className="text-sm font-medium text-text">
            {reached > 0 ? `${good} von ${reached} erreichten Zonen mit Reaktion` : "Keine deiner Zonen wurde erreicht"}
          </p>
          <p className="text-xs text-text-muted">{REGIME_TEXT[regime]}</p>
          <div className="space-y-1">
            {zones.map((z, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono text-text-muted">
                  {i + 1} · {formatNum(z.lo)}–{formatNum(z.hi)}
                </span>
                <Pill tone={RESULT_TONE[results[i].kind]}>{ZONE_RESULT_LABELS[results[i].kind]}</Pill>
                {results[i].touchedAt !== null && (
                  <span className="text-text-faint">erreicht nach {(results[i].touchedAt! + 1) * 4} h</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-text-faint">
            Gestrichelt: automatische Vorschläge aus Swing-Hochs und -Tiefs, davon{" "}
            {refResults.filter((r) => r.kind === "react").length} von {refResults.filter((r) => r.kind !== "none").length} erreichten mit
            Reaktion. Ein Vergleich, keine Musterlösung.
          </p>
          {tips.length > 0 && (
            <ul className="list-disc pl-4 text-xs text-text-muted space-y-0.5">
              {tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          {tally.rounds > 0 && (
            <p className="text-[11px] text-text-faint">
              Bisher in dieser Sitzung: {tally.rounds} Ausschnitt{tally.rounds === 1 ? "" : "e"}, {tally.react} von {tally.reached} erreichten Zonen mit
              Reaktion.
            </p>
          )}
        </div>
      )}
    </ToolBox>
  );
}
