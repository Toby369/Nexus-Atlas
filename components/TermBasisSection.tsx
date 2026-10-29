"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import PanelInfo from "@/components/PanelInfo";
import TimeSeriesChart from "@/components/TimeSeriesChart";
import { termBasisInfo } from "@/lib/panelInfo";
import { setVisibleInterval } from "@/lib/visibleInterval";
import { summarizeTermBasis, type TermBasisPoint, type TermBasisTone } from "@/lib/termBasis";

// Termin-Basis als Abschnitt der ETF-Kachel: sie erklaert, ob ETF-Flows
// echte Nachfrage oder Basis-Trades sind. Daten aendern sich langsam,
// stuendliche Werte aus collect-term-basis reichen.

const REFRESH_MS = 15 * 60_000;
const LOOKBACK_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

const TONE: Record<TermBasisTone, string> = {
  calm: "text-text",
  watch: "text-accent",
  risk: "text-down",
};

async function fetchTermBasis(): Promise<TermBasisPoint[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY_MS).toISOString();
  const { data, error } = await supabase
    .from("term_basis_snapshots")
    .select("timestamp_utc, basis_annualized_pct")
    .gte("timestamp_utc", since)
    .order("timestamp_utc", { ascending: false })
    .limit(1000);
  if (error) {
    console.error("TermBasisSection: Fehler beim Laden:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    t: Date.parse(r.timestamp_utc as string),
    annualizedPct: Number(r.basis_annualized_pct),
  }));
}

// Ein Punkt pro Tag (der juengste), damit stuendliche Live-Werte und
// taegliche Backfill-Werte im Chart gleich gewichtet sind.
function dailySeries(points: TermBasisPoint[]): { t: string; v: number }[] {
  const byDay = new Map<number, TermBasisPoint>();
  for (const p of points) {
    const day = Math.floor(p.t / DAY_MS);
    const cur = byDay.get(day);
    if (!cur || p.t > cur.t) byDay.set(day, p);
  }
  return [...byDay.values()]
    .sort((a, b) => a.t - b.t)
    .map((p) => ({ t: new Date(p.t).toISOString(), v: p.annualizedPct }));
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" });
}

function signed(value: number, digits = 1, unit = " %"): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}${unit}`;
}

export default function TermBasisSection({ etfNetFlow5dUsdM }: { etfNetFlow5dUsdM: number | null }) {
  const [points, setPoints] = useState<TermBasisPoint[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchTermBasis().then((p) => {
        if (!cancelled) setPoints(p);
      });
    load();
    const stop = setVisibleInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  const summary = points ? summarizeTermBasis(points, etfNetFlow5dUsdM) : null;
  const series = points ? dailySeries(points) : [];

  return (
    <div className="pt-3 border-t border-border/60 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-[0.12em] text-text-faint">Termin-Basis (≈ CME)</span>
          <PanelInfo title="Termin-Basis" content={termBasisInfo} />
        </span>
        {summary && <span className={`text-xs font-medium ${TONE[summary.level.tone]}`}>{summary.level.label}</span>}
      </div>

      {points === null ? (
        <p className="text-xs text-text-faint">Lade Termin-Basis…</p>
      ) : !summary ? (
        <p className="text-xs text-text-faint">Noch keine Termin-Basis-Daten vorhanden.</p>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <span className={`tabular font-mono text-lg font-semibold ${TONE[summary.level.tone]}`}>
              {signed(summary.current)} p.a.
            </span>
            <span className="text-xs text-text-faint">
              7 Tage:{" "}
              <span className="tabular font-mono text-text-muted">
                {summary.change7dPp === null ? "—" : signed(summary.change7dPp, 1, " Pp")}
              </span>
            </span>
          </div>
          <p className="text-xs text-text-muted">{summary.level.hint}</p>
          {summary.possibleUnwind && (
            <p className="text-xs text-accent">
              Basis fällt deutlich, während ETFs netto abfliessen: möglicher Abbau von Basis-Trades. Diese Abflüsse
              sind dann keine bärische Meinung.
            </p>
          )}
          {series.length > 1 && (
            <TimeSeriesChart data={series} color="#c99a5b" formatAxisTime={dayLabel} height={90} />
          )}
        </>
      )}
    </div>
  );
}
