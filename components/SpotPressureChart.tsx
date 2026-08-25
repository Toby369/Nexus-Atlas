"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  ReferenceLine,
} from "recharts";
import type { SpotPressurePoint } from "@/lib/types";

const BUY_COLOR = "#4fae7c";
const SELL_COLOR = "#d9695f";

interface NetFlowPoint {
  t: string;
  net: number | null;
}

// Netto-Taker-Flow je Kerze (Kauf minus Verkauf, in BTC) -- ein Balken pro
// Kerze, gruen wenn in der Kerze mehr aggressiv gekauft als verkauft wurde,
// rot umgekehrt. Kein einzelner Skalarwert wird interpretiert, die Serie
// zeigt den Verlauf ueber das gewaehlte Fenster.
function toNetFlow(data: SpotPressurePoint[]): NetFlowPoint[] {
  return data.map((d) => ({
    t: d.timestamp_utc,
    net:
      d.taker_buy_vol !== null && d.taker_sell_vol !== null
        ? d.taker_buy_vol - d.taker_sell_vol
        : null,
  }));
}

function formatBtc(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} BTC`;
}

function clockOrDate(iso: string) {
  const d = new Date(iso);
  const now = Date.now();
  const isOld = now - d.getTime() > 36 * 60 * 60 * 1000;
  return isOld
    ? d.toLocaleDateString("de-CH", { day: "2-digit", month: "short" })
    : d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}

export default function SpotPressureChart({
  data,
  height = 140,
}: {
  data: SpotPressurePoint[];
  height?: number;
}) {
  if (data.length < 2) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-xs text-text-faint"
      >
        Noch nicht genug Kerzen fuer diesen Zeitraum.
      </div>
    );
  }

  const points = toNetFlow(data);

  return (
    <div>
      <div className="flex items-center gap-4 mb-2">
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: BUY_COLOR }}
            aria-hidden
          />
          Kaufdruck
        </span>
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: SELL_COLOR }}
            aria-hidden
          />
          Verkaufsdruck
        </span>
      </div>
      <div style={{ height }} className="-ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="t" hide />
            <YAxis
              tickFormatter={(v) => `${v}`}
              width={40}
              tick={{ fill: "#565c63", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine y={0} stroke="#262b31" />
            <Tooltip
              contentStyle={{
                background: "#1a1e23",
                border: "1px solid #262b31",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(t) => clockOrDate(String(t))}
              formatter={(value) => [formatBtc(Number(value)), "Netto-Taker-Flow"]}
              labelStyle={{ color: "#8b9198" }}
              itemStyle={{ color: "#e8e6e1" }}
            />
            <Bar dataKey="net" isAnimationActive={false}>
              {points.map((p, i) => (
                <Cell
                  key={i}
                  fill={p.net !== null && p.net < 0 ? SELL_COLOR : BUY_COLOR}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
