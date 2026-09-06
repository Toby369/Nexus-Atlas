"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { supabase } from "@/lib/supabase";

// Chart-basierte Anker-ZEITRAUM-Auswahl (Nutzer-Wunsch 06.09.2026): "klick
// bei kerze, ziehen bis (wunsch) kerze, das ist dann der gemessene anker
// zeitraum" -- analog zu TradingViews "Fixed Range"-Tool. Bewusst
// Klick-Klick statt echtem Maus-Drag umgesetzt: lightweight-charts nutzt
// mousedown+move selbst fuer Pan/Zoom, ein eigenes Drag-Handling wuerde
// damit kollidieren. Klick-Klick (erste Kerze = Start, zweite = Ende, mit
// visueller Bereichs-Markierung dazwischen) erreicht dasselbe Ergebnis ohne
// diesen Konflikt.
const EXCHANGE = "binance";
const SYMBOL = "BTCUSDT";

const INTERVALS = [
  { id: "1d", label: "1D", seconds: 86_400, limit: 180 },
  { id: "4h", label: "4H", seconds: 14_400, limit: 180 },
  { id: "1h", label: "1H", seconds: 3_600, limit: 200 },
  { id: "15m", label: "15M", seconds: 900, limit: 200 },
] as const;
type IntervalId = (typeof INTERVALS)[number]["id"];

interface CandleBar {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface OverlayRect {
  left: number;
  width: number;
}

async function fetchCandles(interval: IntervalId, limit: number): Promise<CandleBar[]> {
  const { data, error } = await supabase
    .from("candles")
    .select("open_time, open, high, low, close")
    .eq("exchange", EXCHANGE)
    .eq("symbol", SYMBOL)
    .eq("interval", interval)
    .order("open_time", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data
    .slice()
    .reverse()
    .map((c) => ({
      time: Math.floor(new Date(c.open_time).getTime() / 1000) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
}

function formatBarLabel(t: UTCTimestamp): string {
  const iso = new Date(t * 1000).toISOString();
  const [datePart, timePart] = iso.split("T");
  return `${datePart} ${timePart.slice(0, 5)}`;
}

export default function AnchorChartPicker({
  onRangeSelected,
}: {
  onRangeSelected: (startIso: string, endIso: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const [timeframe, setTimeframe] = useState<IntervalId>("1h");
  const [loading, setLoading] = useState(true);
  // Checkbox "Anker-Auswahl aktiv" (Nutzer-Wunsch 06.09.2026): ohne aktivierte
  // Auswahl reagiert der Chart auf Klicks nicht -- man kann frei zoomen/
  // schauen, ohne versehentlich einen neuen Anker-Zeitraum zu starten.
  const [selectionActive, setSelectionActive] = useState(false);
  const [pickStart, setPickStart] = useState<UTCTimestamp | null>(null);
  const [pickEnd, setPickEnd] = useState<UTCTimestamp | null>(null);
  const [hoverTime, setHoverTime] = useState<UTCTimestamp | null>(null);
  const [overlay, setOverlay] = useState<OverlayRect | null>(null);

  // Klick-/Crosshair-Handler lesen den zuletzt gewaehlten Start/Ende sowie
  // den Auswahl-aktiv-Status ueber Refs statt ueber die React-State-
  // Closure -- die Chart-Instanz samt Event-Subscriptions wird nur einmal
  // beim Mount erzeugt (siehe Effekt unten), die Handler muessen aber
  // trotzdem immer den AKTUELLEN Stand sehen. Die Refs werden bewusst nur
  // in einem eigenen Effekt synchronisiert (nie waehrend des Renders
  // selbst).
  const selectionActiveRef = useRef(false);
  const pickStartRef = useRef<UTCTimestamp | null>(null);
  const pickEndRef = useRef<UTCTimestamp | null>(null);
  useEffect(() => {
    selectionActiveRef.current = selectionActive;
  }, [selectionActive]);
  useEffect(() => {
    pickStartRef.current = pickStart;
  }, [pickStart]);
  useEffect(() => {
    pickEndRef.current = pickEnd;
  }, [pickEnd]);

  // Chart einmalig erzeugen.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#9ca3af" },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.08)" },
        horzLines: { color: "rgba(148,163,184,0.08)" },
      },
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderVisible: false },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const handleClick = (param: MouseEventParams<Time>) => {
      if (!selectionActiveRef.current || !param.time) return;
      const t = param.time as UTCTimestamp;
      if (pickStartRef.current === null) {
        setPickStart(t);
        setPickEnd(null);
      } else if (pickEndRef.current === null) {
        const start = pickStartRef.current;
        if (t === start) return;
        const [s, e] = t > start ? [start, t] : [t, start];
        setPickStart(s);
        setPickEnd(e);
      } else {
        setPickStart(t);
        setPickEnd(null);
      }
    };
    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      if (
        !selectionActiveRef.current ||
        pickStartRef.current === null ||
        pickEndRef.current !== null
      )
        return;
      setHoverTime(param.time ? (param.time as UTCTimestamp) : null);
    };

    chart.subscribeClick(handleClick);
    chart.subscribeCrosshairMove(handleCrosshairMove);

    return () => {
      chart.unsubscribeClick(handleClick);
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Daten neu laden, wenn das Intervall wechselt -- Auswahl wird dabei
  // zurueckgesetzt (Kerzenzeiten eines anderen Intervalls sind nicht
  // vergleichbar mit denen des vorherigen). Alle States werden bewusst
  // innerhalb der inneren "load"-Funktion gesetzt statt direkt im
  // Effekt-Koerper, um kaskadierende Synchron-Renders zu vermeiden.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setPickStart(null);
      setPickEnd(null);
      setHoverTime(null);
      const cfg = INTERVALS.find((i) => i.id === timeframe)!;
      const bars = await fetchCandles(timeframe, cfg.limit);
      if (cancelled) return;
      seriesRef.current?.setData(bars);
      chartRef.current?.timeScale().fitContent();
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [timeframe]);

  // Pixel-Position der Bereichsmarkierung: bewusst in einem eigenen Effekt
  // berechnet (nicht direkt beim Rendern aus chartRef gelesen) -- ein
  // Ref-Zugriff waehrend des Renders selbst ist mit React nicht sicher.
  useEffect(() => {
    const chart = chartRef.current;
    const rangeEnd = pickEnd ?? hoverTime;
    if (!chart || pickStart === null || rangeEnd === null) {
      setOverlay(null);
      return;
    }
    const update = () => {
      const s = chart.timeScale().timeToCoordinate(pickStart);
      const e = chart.timeScale().timeToCoordinate(rangeEnd);
      if (s === null || e === null) {
        setOverlay(null);
        return;
      }
      setOverlay({ left: Math.min(s, e), width: Math.abs(e - s) });
    };
    update();
    chart.timeScale().subscribeVisibleTimeRangeChange(update);
    return () => chart.timeScale().unsubscribeVisibleTimeRangeChange(update);
  }, [pickStart, pickEnd, hoverTime]);

  function reset() {
    setPickStart(null);
    setPickEnd(null);
    setHoverTime(null);
  }

  function confirm() {
    if (pickStart === null || pickEnd === null) return;
    const cfg = INTERVALS.find((i) => i.id === timeframe)!;
    const startIso = new Date(pickStart * 1000).toISOString();
    const endIso = new Date((pickEnd + cfg.seconds) * 1000).toISOString();
    onRangeSelected(startIso, endIso);
    reset();
  }

  return (
    <div className="rounded-md border border-border bg-surface-raised p-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          {INTERVALS.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => setTimeframe(i.id)}
              className={`px-2 py-1 text-xs rounded-md border ${
                timeframe === i.id
                  ? "border-accent/40 bg-accent/15 text-accent"
                  : "border-border text-text-faint hover:text-text-muted"
              }`}
            >
              {i.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-text-faint">
          <input
            type="checkbox"
            checked={selectionActive}
            onChange={(e) => setSelectionActive(e.target.checked)}
          />
          Anker-Auswahl aktiv
        </label>
      </div>

      {selectionActive && (
        <p className="text-[11px] text-text-faint">
          Kerze anklicken (Start), dann Ziel-Kerze anklicken (Ende)
        </p>
      )}

      <div ref={containerRef} className="relative h-[240px] w-full">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-text-faint">
            Lade Kerzen…
          </div>
        )}
        {overlay && (
          // z-index noetig: lightweight-charts haengt sein Canvas
          // imperativ (ausserhalb von React) in denselben Container --
          // ohne z-index landet diese Markierung optisch dahinter.
          <div
            className="absolute top-0 bottom-0 z-10 bg-accent/15 border-x border-accent/40 pointer-events-none"
            style={{ left: overlay.left, width: overlay.width }}
          />
        )}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-[11px] text-text-faint">
          {pickStart === null
            ? "Kein Startpunkt gewählt"
            : pickEnd === null
              ? `Start: ${formatBarLabel(pickStart)} UTC — Ende wählen`
              : `${formatBarLabel(pickStart)} → ${formatBarLabel(pickEnd)} UTC`}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={pickStart === null}
            className="px-2.5 py-1 text-xs rounded-md border border-border text-text-faint disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Zurücksetzen
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={pickStart === null || pickEnd === null}
            className="px-2.5 py-1 text-xs rounded-md border border-accent/40 bg-accent/15 text-accent disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Anker übernehmen
          </button>
        </div>
      </div>
    </div>
  );
}
