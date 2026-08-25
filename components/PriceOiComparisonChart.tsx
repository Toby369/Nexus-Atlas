"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import type { MarketSeriesPoint } from "@/lib/types";

const PRICE_COLOR = "#c99a5b";
const OI_COLOR = "#4fae7c";

interface NormalizedPoint {
  t: string;
  price: number | null;
  oi: number | null;
}

// Normalisiert beide Serien relativ zum jeweils ersten verfuegbaren Punkt im
// Fenster (= 0%), damit Preis (grosse absolute Werte) und OI (andere
// Groessenordnung) auf einer gemeinsamen Achse sinnvoll vergleichbar sind.
// Jede Serie wird unabhaengig normalisiert, falls eine der beiden am
// allerersten Datenpunkt zufaellig null ist.
function normalize(data: MarketSeriesPoint[]): NormalizedPoint[] {
  const basePrice = data.find((d) => d.last_price !== null)?.last_price ?? null;
  const baseOi = data.find((d) => d.open_interest !== null)?.open_interest ?? null;

  return data.map((d) => ({
    t: d.timestamp_utc,
    price:
      basePrice !== null && d.last_price !== null
        ? ((d.last_price - basePrice) / basePrice) * 100
        : null,
    oi:
      baseOi !== null && d.open_interest !== null
        ? ((d.open_interest - baseOi) / baseOi) * 100
        : null,
  }));
}

function formatPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function clockOrDate(iso: string) {
  const d = new Date(iso);
  const now = Date.now();
  const isOld = now - d.getTime() > 36 * 60 * 60 * 1000;
  return isOld
    ? d.toLocaleDateString("de-CH", { day: "2-digit", month: "short" })
    : d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}

export default function PriceOiComparisonChart({
  data,
  height = 180,
}: {
  data: MarketSeriesPoint[];
  height?: number;
}) {
  if (data.length < 2) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-xs text-text-faint"
      >
        Noch nicht genug Datenpunkte fuer diesen Zeitraum.
      </div>
    );
  }

  const points = normalize(data);

  return (
    <div>
      <div className="flex items-center gap-4 mb-2">
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: PRICE_COLOR }}
            aria-hidden
          />
          BTC Preis
        </span>
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: OI_COLOR }}
            aria-hidden
          />
          Open Interest
        </span>
      </div>
      <div style={{ height }} className="-ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="t" hide />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={(v) => `${v}%`}
              width={44}
              tick={{ fill: "#565c63", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "#1a1e23",
                border: "1px solid #262b31",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(t) => clockOrDate(String(t))}
              formatter={(value, name) => [
                formatPct(Number(value)),
                name === "price" ? "BTC Preis" : "Open Interest",
              ]}
              labelStyle={{ color: "#8b9198" }}
              itemStyle={{ color: "#e8e6e1" }}
            />
            <Line
              type="monotone"
              dataKey="price"
              stroke={PRICE_COLOR}
              strokeWidth={1.75}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="oi"
              stroke={OI_COLOR}
              strokeWidth={1.75}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
