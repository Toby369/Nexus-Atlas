"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, ReferenceLine } from "recharts";
import type { CvdComparisonPoint } from "@/lib/spotPerpFlow";

// Verlauf Spot-CVD gegen Perp-CVD (je kumuliert, in % des eigenen Volumens)
// plus Divergenz (Spot minus Perp) -- Herleitung siehe
// lib/spotPerpFlow.ts::buildCvdComparison.

const SPOT_COLOR = "#4fae7c";
const PERP_COLOR = "#a3a9b0";
const DIVERGENCE_COLOR = "#c99a5b";

function clockOrDate(ms: number) {
  const d = new Date(ms);
  const isOld = Date.now() - ms > 36 * 60 * 60 * 1000;
  return isOld
    ? d.toLocaleDateString("de-CH", { day: "2-digit", month: "short" })
    : d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}

function fmt(v: number) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)} %`;
}

export default function CvdComparisonChart({
  points,
  height = 140,
}: {
  points: CvdComparisonPoint[];
  height?: number;
}) {
  if (points.length < 2) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-xs text-text-faint">
        Noch nicht genug Daten für einen Verlauf in diesem Zeitraum.
      </div>
    );
  }
  const last = points[points.length - 1];
  const legend = [
    { label: "Spot-CVD", color: SPOT_COLOR, value: last.spot },
    { label: "Perp-CVD", color: PERP_COLOR, value: last.perp },
    { label: "Divergenz", color: DIVERGENCE_COLOR, value: last.divergence },
  ];

  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-1.5 text-[11px] text-text-muted">
        {legend.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-0.5 rounded" style={{ backgroundColor: l.color }} aria-hidden />
            {l.label}
            <span className="tabular font-mono text-text">{fmt(l.value)}</span>
          </span>
        ))}
      </div>
      <div style={{ height }} className="-ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t) => clockOrDate(Number(t))}
              tick={{ fill: "#565c63", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={(v) => `${v}%`}
              width={44}
              tick={{ fill: "#565c63", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine y={0} stroke="#262b31" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="spot" stroke={SPOT_COLOR} strokeWidth={1.75} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="perp" stroke={PERP_COLOR} strokeWidth={1.75} dot={false} isAnimationActive={false} />
            <Line
              type="monotone"
              dataKey="divergence"
              stroke={DIVERGENCE_COLOR}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
