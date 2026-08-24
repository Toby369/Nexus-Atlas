"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

interface Point {
  t: string; // ISO timestamp
  v: number;
}

export default function TimeSeriesChart({
  data,
  color,
  formatValue,
  formatTooltipTime,
  height = 90,
}: {
  data: Point[];
  color: string;
  formatValue: (v: number) => string;
  formatTooltipTime?: (t: string) => string;
  height?: number;
}) {
  if (data.length < 2) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-xs text-text-faint"
      >
        Noch nicht genug Datenpunkte
      </div>
    );
  }

  const gradientId = `grad-${color.replace("#", "")}`;

  return (
    <div style={{ height }} className="-ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="t" hide />
          <YAxis domain={["auto", "auto"]} hide />
          <Tooltip
            contentStyle={{
              background: "#1a1e23",
              border: "1px solid #262b31",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(t) =>
              formatTooltipTime ? formatTooltipTime(String(t)) : String(t)
            }
            formatter={(value) => [formatValue(Number(value)), ""]}
            labelStyle={{ color: "#8b9198" }}
            itemStyle={{ color: "#e8e6e1" }}
          />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
