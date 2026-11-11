"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Karte, Leerzustand } from "@/components/basis";
import type { LageChartData } from "@/lib/lageChartContext";
import {
  LAGE_KEYS,
  LAGE_KEY_LABEL,
  nf,
  sg,
  type LageKind,
  type LagePoint,
} from "@/lib/lageChart";
import { drawLage, whenText, type LageDrawOpts, type LageWall } from "@/lib/lageChartSvg";
import type { ZoneLevel } from "@/lib/zones";
import { zoneHigh, zoneLow } from "@/lib/zones";

// Lage-Chart (Prototyp, 11.11.2026): Preis, Lage-Verlauf, Fluss und
// Positionierung auf EINER Zeitachse. Oben die Lage zum gewaehlten Zeitpunkt
// (standardmaessig die letzte Kerze), darunter der Verlauf. Beruehren oder
// Darueberfahren springt zu diesem Zeitpunkt.

const WINDOWS: Record<"1h" | "4h", number[]> = { "1h": [48, 96, 168], "4h": [30, 42, 60] };
const DEFAULT_WINDOW: Record<"1h" | "4h", number> = { "1h": 96, "4h": 42 };

const GLYPH: Record<LageKind, string> = {
  bull: "M6 1 11 11H1z",
  bear: "M6 11 1 1h10z",
  flat: "",
  warn: "M6 .5 11.5 6 6 11.5.5 6z",
  hot: "M6 .5 11.5 6 6 11.5.5 6z",
};
const KIND_CLASS: Record<LageKind, string> = {
  bull: "fill-up",
  bear: "fill-down",
  flat: "fill-[#5f6a7b]",
  warn: "fill-warn",
  hot: "fill-[#e07bd0]",
};

function Glyph({ kind }: { kind: LageKind }) {
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden className="shrink-0">
      {kind === "flat" ? <circle cx="6" cy="6" r="5" className={KIND_CLASS.flat} /> : <path d={GLYPH[kind]} className={KIND_CLASS[kind]} />}
    </svg>
  );
}

const OVERLAYS: { key: keyof LageDrawOpts; label: string; color: string }[] = [
  { key: "ema20", label: "EMA 20", color: "#6ea4ff" },
  { key: "ema50", label: "EMA 50", color: "#b58cff" },
  { key: "ema200", label: "EMA 200", color: "#8d97a7" },
  { key: "wvwap", label: "VWAP Woche", color: "#3cc5d3" },
  { key: "mvwap", label: "VWAP Monat", color: "#b4d65a" },
  { key: "zones", label: "Zonen", color: "#5f6a7b" },
  { key: "walls", label: "Orderbuch-Wände", color: "#5f6a7b" },
  { key: "struct", label: "BOS / CHoCH", color: "#5f6a7b" },
  { key: "rsi", label: "Momentum (RSI)", color: "#2ec4a6" },
];

const DEFAULT_OPTS: LageDrawOpts = {
  ema20: true,
  ema50: true,
  ema200: false,
  wvwap: true,
  mvwap: true,
  zones: true,
  walls: true,
  struct: true,
  rsi: false,
};

function Segment<T extends string | number>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { value: T; text: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] uppercase tracking-[0.12em] text-text-faint mr-1">{label}</span>
      {items.map((it) => (
        <button
          key={String(it.value)}
          type="button"
          aria-pressed={value === it.value}
          onClick={() => onChange(it.value)}
          className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
            value === it.value
              ? "border-accent/40 bg-accent/15 text-accent"
              : "border-border text-text-muted hover:text-text"
          }`}
        >
          {it.text}
        </button>
      ))}
    </div>
  );
}

export default function LageChartCard({
  data,
  zones,
  walls,
}: {
  data: LageChartData | null;
  zones: ZoneLevel[];
  walls: LageWall[];
}) {
  const [tf, setTf] = useState<"1h" | "4h">("1h");
  const [win, setWin] = useState<number>(DEFAULT_WINDOW["1h"]);
  const [opts, setOpts] = useState<LageDrawOpts>(DEFAULT_OPTS);
  const [sel, setSel] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  const series = data?.series[tf];
  const points = series?.points;
  const n = points ? Math.min(win, points.length) : 0;

  const drawn = useMemo(() => {
    if (!series || !points || points.length < 2 || width < 200) return null;
    return drawLage({
      points,
      n,
      width,
      hours: series.hours,
      opts,
      zones: zones.map((z) => ({ low: zoneLow(z), high: zoneHigh(z), label: z.label ?? null })),
      walls,
      events: data?.events ?? [],
    });
  }, [series, points, n, width, opts, zones, walls, data?.events]);

  if (!data || !series || !points || points.length < 2) {
    return (
      <Karte>
        <Leerzustand
          titel="Lage-Chart ohne Daten"
          text="Kerzen oder Features konnten nicht geladen werden. Beim nächsten Neuladen wird es erneut versucht."
        />
      </Karte>
    );
  }

  const idx = sel ?? points.length - 1;
  const p: LagePoint = points[Math.min(idx, points.length - 1)];

  const pick = (clientX: number, rect: DOMRect) => {
    if (!drawn) return;
    const x = (clientX - rect.left) * (drawn.geom.W / rect.width);
    const j = Math.floor((x - drawn.geom.mL) / drawn.geom.st);
    setSel(drawn.geom.i0 + Math.max(0, Math.min(drawn.geom.n - 1, j)));
  };

  const switchTf = (next: "1h" | "4h") => {
    setTf(next);
    setWin(DEFAULT_WINDOW[next]);
    setSel(null);
  };

  const readout: [string, string][] = [
    ["O", nf(p.open)],
    ["H", nf(p.high)],
    ["L", nf(p.low)],
    ["C", nf(p.close)],
  ];
  if (opts.ema20 && p.ema20 !== null) readout.push(["EMA20", nf(p.ema20)]);
  if (opts.ema50 && p.ema50 !== null) readout.push(["EMA50", nf(p.ema50)]);
  if (opts.ema200 && p.ema200 !== null) readout.push(["EMA200", nf(p.ema200)]);
  if (opts.wvwap && p.wvwap !== null) readout.push(["VWAP W", nf(p.wvwap)]);
  if (opts.mvwap && p.mvwap !== null) readout.push(["VWAP M", nf(p.mvwap)]);
  if (p.cvdDelta !== null) readout.push(["CVD Δ", `${sg(p.cvdDelta)} BTC`]);
  if (p.oiDeltaPct !== null) readout.push(["OI Δ", `${sg(p.oiDeltaPct, 2)} %`]);
  if (p.funding !== null) readout.push(["Funding", `${nf(p.funding, 3)} %`]);
  if (p.basisPct !== null) readout.push(["Basis", `${nf(p.basisPct, 2)} %`]);
  if (opts.rsi && p.rsi !== null) readout.push(["RSI", nf(p.rsi, 0)]);

  const hours = series.hours;

  return (
    <Karte
      info={{
        titel: "Lage-Chart",
        text: [
          "Was das ist: Preis, Lage, Fluss und Positionierung auf einer gemeinsamen Zeitachse. Oben die Lage zum gewählten Zeitpunkt (Standard: letzte Kerze), darunter der Verlauf derselben Bereiche.",
          "Fahre mit der Maus über den Chart oder tippe auf eine Kerze: Kacheln und Werte springen zu diesem Zeitpunkt. «Zurück zu jetzt» setzt es zurück.",
          "Lage-Verlauf: Trend (EMA 20/50 + ADX), Fluss (CVD über 6 Kerzen), Funding (Schwellen 0.025 % / 0.045 %), Risiko (Schwankung und Termine). Die Schwellen sind Startwerte und noch nicht mit der Marktphase abgeglichen.",
          "VWAP Woche startet jeden Montag 00:00 UTC, VWAP Monat am 1. des Monats 00:00 UTC (wie in der Datenbank-Funktion get_anchored_vwap_summary). Funding gibt es nur für die letzten ~7 Tage, Basis nur dort, wo market_features sie liefert.",
          "Kein Handelssignal, eine Übersicht über den aktuellen Stand.",
        ].join("\n\n"),
      }}
    >
      <div className="space-y-4 lage-chart">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Segment
            label="Zeitrahmen"
            items={[
              { value: "1h", text: "1h" },
              { value: "4h", text: "4h" },
            ]}
            value={tf}
            onChange={switchTf}
          />
          <Segment
            label="Kerzen"
            items={WINDOWS[tf].map((v) => ({ value: v, text: String(v) }))}
            value={win}
            onChange={(v) => {
              setWin(v);
              setSel(null);
            }}
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Einblenden">
          {OVERLAYS.map((ov) => (
            <button
              key={ov.key}
              type="button"
              aria-pressed={opts[ov.key]}
              onClick={() => setOpts((o) => ({ ...o, [ov.key]: !o[ov.key] }))}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border transition-colors ${
                opts[ov.key] ? "border-text-muted text-text" : "border-border text-text-faint hover:text-text-muted"
              }`}
            >
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full border"
                style={opts[ov.key] ? { backgroundColor: ov.color, borderColor: ov.color } : { borderColor: "var(--text-faint)" }}
              />
              {ov.label}
            </button>
          ))}
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="text-xs font-medium text-text">
              {sel === null ? "Lage jetzt" : "Lage am"}{" "}
              <span className="font-mono text-text-muted">{sel === null ? `· ${whenText(p.t)}` : whenText(p.t)}</span>
            </h3>
            {sel !== null && (
              <button
                type="button"
                onClick={() => setSel(null)}
                className="px-2.5 py-1 text-xs rounded-md border border-border text-text-muted hover:text-text"
              >
                Zurück zu jetzt
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {LAGE_KEYS.map((k) => {
              const s = p.states[k];
              const since = p.since[k];
              const hrs = since.candles * hours;
              return (
                <div key={k} className="rounded-feld border border-border bg-surface-raised p-3 space-y-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">{LAGE_KEY_LABEL[k]}</p>
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-text">
                    <Glyph kind={s.kind} />
                    <span>{s.label}</span>
                  </p>
                  <p className="text-xs text-text-muted break-words">{s.why}</p>
                  <p className="text-[11px] text-text-faint border-t border-border pt-1.5 mt-1.5">
                    seit {hrs} h{since.prev ? ` · davor ${since.prev}` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 pb-2 font-mono text-xs min-h-[2.75rem] content-start">
            <span className="font-sans font-semibold text-text">{whenText(p.t)}</span>
            {readout.map(([k, v]) => (
              <span key={k} className="whitespace-nowrap">
                <span className="text-text-faint">{k} </span>
                <span className="text-text">{v}</span>
              </span>
            ))}
          </div>
          <div
            ref={wrapRef}
            className="relative w-full select-none cursor-crosshair"
            style={{ touchAction: "pan-y" }}
            onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerMove={(e) => {
              if (e.pointerType === "mouse" || e.buttons) pick(e.clientX, e.currentTarget.getBoundingClientRect());
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") setSel(null);
            }}
          >
            {drawn && (
              <>
                <svg
                  width={drawn.geom.W}
                  height={drawn.height}
                  viewBox={`0 0 ${drawn.geom.W} ${drawn.height}`}
                  className="block w-full"
                  role="img"
                  aria-label="Preis, Lage-Verlauf, CVD, Offenes Interesse, Funding und Basis auf einer Zeitachse"
                  dangerouslySetInnerHTML={{ __html: drawn.svg }}
                />
                {sel !== null && sel >= drawn.geom.i0 && (
                  <svg
                    width={drawn.geom.W}
                    height={drawn.height}
                    viewBox={`0 0 ${drawn.geom.W} ${drawn.height}`}
                    className="absolute inset-0 w-full pointer-events-none"
                    aria-hidden
                  >
                    {(() => {
                      const x = drawn.geom.mL + (sel - drawn.geom.i0 + 0.5) * drawn.geom.st;
                      return (
                        <>
                          <rect
                            x={x - drawn.geom.st / 2}
                            y={8}
                            width={drawn.geom.st}
                            height={drawn.height - 32}
                            fill="var(--text)"
                            fillOpacity={0.1}
                          />
                          <line x1={x} x2={x} y1={8} y2={drawn.height - 24} stroke="var(--text-muted)" strokeDasharray="3 3" />
                        </>
                      );
                    })()}
                  </svg>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-text-muted border-t border-border pt-3">
          {(
            [
              ["bull", "Bullisch / Käufer"],
              ["bear", "Bärisch / Verkäufer"],
              ["flat", "Neutral / Range"],
              ["warn", "Vorsicht"],
              ["hot", "Extrem"],
            ] as [LageKind, string][]
          ).map(([k, t]) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <Glyph kind={k} />
              {t}
            </span>
          ))}
        </div>
      </div>
    </Karte>
  );
}
