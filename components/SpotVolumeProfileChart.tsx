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
  sell: number;
  total: number; // fuer den Tooltip (Gesamtvolumen dieser Preisstufe)
}

function formatPrice(value: number): string {
  return `$${value.toLocaleString("de-CH", { maximumFractionDigits: 0 })}`;
}

function formatBtc(value: number): string {
  return value.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Preis-Volumen-Profil (horizontal, gestapelt): je Preis-Bucket EIN Balken,
// dessen Laenge das Gesamtvolumen zeigt und der intern nach Kauf-/
// Verkaufsanteil gruen/rot eingefaerbt ist -- bewusst NICHT gespiegelt
// (Nutzer-Feedback 04.10.2026: die vorherige Links/Rechts-Spiegelung an
// einer Nulllinie liess sich nicht auf Anhieb lesen, weil das
// Gesamtvolumen je Preisstufe erst durch gedankliches Addieren von rot und
// gruen sichtbar wurde). So ist die Balkenlaenge direkt zwischen allen
// Preisstufen vergleichbar, das Farbverhaeltnis zeigt trotzdem, wer
// dominiert hat.
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
    sell: b.sellVolume,
    total: b.buyVolume + b.sellVolume,
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
              tickFormatter={(v) => formatBtc(Number(v))}
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
                `${formatBtc(Number(value ?? 0))} BTC`,
                name === "buy" ? "Kaufvolumen" : "Verkaufsvolumen",
              ]}
              labelFormatter={(label, payload) => {
                const total = payload?.[0]?.payload?.total as number | undefined;
                return total !== undefined ? `${label} · Gesamt ${formatBtc(total)} BTC` : label;
              }}
              contentStyle={{ fontSize: 12 }}
            />
            <Bar dataKey="buy" name="buy" stackId="volume" fill={BUY_COLOR} isAnimationActive={false} />
            <Bar dataKey="sell" name="sell" stackId="volume" fill={SELL_COLOR} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
