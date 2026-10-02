"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
} from "recharts";

const BUY_COLOR = "#4fae7c";
const SELL_COLOR = "#d9695f";

export interface SpotVolumeBucket {
  priceBucket: number;
  buyVolume: number;
  sellVolume: number;
}

interface ChartRow {
  price: string;
  buy: number;
  sellNeg: number; // negativ, damit der Balken links vom Nullpunkt waechst
  sellAbs: number; // fuer den Tooltip (positiver Anzeigewert)
}

function formatPrice(value: number): string {
  return `$${value.toLocaleString("de-CH", { maximumFractionDigits: 0 })}`;
}

function formatBtc(value: number): string {
  return value.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Preis-Volumen-Profil (horizontal, divergierend): je Preis-Bucket ein
// gruener Balken nach rechts (Kaufvolumen) und ein roter Balken nach links
// (Verkaufsvolumen), gespiegelt an der Nulllinie -- dieselbe Lesart wie ein
// klassisches "Volume Profile" an einer vertikalen Preisachse, nur mit
// echtem Taker-Buy/Sell-Split statt reinem Gesamtvolumen je Preis.
export default function SpotVolumeProfileChart({
  buckets,
  height = 220,
}: {
  buckets: SpotVolumeBucket[];
  height?: number;
}) {
  if (buckets.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-xs text-text-faint">
        Noch keine Spot-Volumen-Daten fuer diesen Zeitraum erfasst.
      </div>
    );
  }

  // Absteigend, damit der hoechste Preis in der Liste oben im Chart steht
  // (YAxis category rendert von oben nach unten in Datenreihenfolge).
  const sorted = [...buckets].sort((a, b) => b.priceBucket - a.priceBucket);
  const rows: ChartRow[] = sorted.map((b) => ({
    price: formatPrice(b.priceBucket),
    buy: b.buyVolume,
    sellNeg: -b.sellVolume,
    sellAbs: b.sellVolume,
  }));

  const rowHeight = 22;
  const chartHeight = Math.max(height, rows.length * rowHeight);

  return (
    <div>
      <div className="flex items-center gap-4 mb-2">
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: BUY_COLOR }} aria-hidden />
          Kaufvolumen
        </span>
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: SELL_COLOR }} aria-hidden />
          Verkaufsvolumen
        </span>
      </div>
      <div style={{ height: chartHeight }} className="-ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
            barCategoryGap={2}
          >
            <XAxis
              type="number"
              tickFormatter={(v) => formatBtc(Math.abs(Number(v)))}
              tick={{ fill: "#565c63", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="price"
              width={76}
              tick={{ fill: "#565c63", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine x={0} stroke="#262b31" />
            <Tooltip
              formatter={(value, name) => [
                `${formatBtc(Math.abs(Number(value ?? 0)))} BTC`,
                name === "buy" ? "Kaufvolumen" : "Verkaufsvolumen",
              ]}
              labelFormatter={(label) => label}
              contentStyle={{ fontSize: 12 }}
            />
            <Bar dataKey="sellNeg" name="sell" fill={SELL_COLOR} isAnimationActive={false} />
            <Bar dataKey="buy" name="buy" fill={BUY_COLOR} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
