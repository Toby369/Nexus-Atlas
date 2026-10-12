"use client";

import { useState } from "react";
import { simulateMarketOrder, SIM_START_PRICE, type OrderSide } from "@/lib/grundlagen/orderbook";
import { Segmented, Stat, ToolBox, formatNum, formatSignedPct } from "./ui";

export default function OrderbookSimulator() {
  const [side, setSide] = useState<OrderSide>("buy");
  const [book, setBook] = useState<"normal" | "thin">("normal");
  const [size, setSize] = useState(20);

  const r = simulateMarketOrder(size, side, book === "thin");
  const maxSize = Math.max(...r.levels.map((l) => l.size));
  const rows = side === "buy" ? [...r.levels].reverse() : r.levels;
  const barColor = side === "buy" ? "bg-down" : "bg-up";

  return (
    <ToolBox title="Simulator · Market-Order ins Buch">
      <div className="flex flex-wrap gap-3">
        <Segmented
          label="Richtung"
          value={side}
          onChange={setSide}
          options={[
            { value: "buy", label: "Market-Kauf" },
            { value: "sell", label: "Market-Verkauf" },
          ]}
        />
        <Segmented
          label="Liquidität"
          value={book}
          onChange={setBook}
          options={[
            { value: "normal", label: "Normales Buch" },
            { value: "thin", label: "Dünnes Buch (Wochenende)" },
          ]}
        />
      </div>

      <label htmlFor="ob-size" className="block space-y-1">
        <span className="text-[11px] text-text-faint">
          Ordergrösse: <span className="font-mono text-text">{size} BTC</span>
        </span>
        <input
          id="ob-size"
          type="range"
          min={0}
          max={70}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className="w-full accent-[var(--accent)]"
        />
      </label>

      <div className="space-y-0.5 font-mono text-[11px]">
        {rows.map((l) => (
          <div key={l.price} className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-2">
            <span className="text-text-muted">{formatNum(l.price)}</span>
            <span className="relative h-2.5 rounded-sm bg-surface-raised overflow-hidden">
              <span className={`absolute inset-y-0 left-0 ${barColor} opacity-30`} style={{ width: `${(l.size / maxSize) * 100}%` }} />
              <span className={`absolute inset-y-0 left-0 ${barColor}`} style={{ width: `${(l.filled / maxSize) * 100}%` }} />
            </span>
            <span className="text-right text-text-faint">{formatNum(l.size, 1)}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Startpreis" value={formatNum(SIM_START_PRICE)} />
        <Stat label="Letzter Preis" value={formatNum(r.lastPrice)} />
        <Stat label="Ø Ausführung" value={r.avgFillPrice === null ? "—" : formatNum(r.avgFillPrice)} />
        <Stat
          label="Preisbewegung"
          value={`${formatSignedPct(r.movePct)}${r.exhausted ? " (Buch leer)" : ""}`}
          tone={r.movePct > 0 ? "bullish" : r.movePct < 0 ? "bearish" : undefined}
        />
      </div>
      <p className="text-[11px] text-text-faint">
        Beispielbuch mit erfundenen Mengen. Im dünnen Buch bewegt dieselbe Order den Preis deutlich weiter. Deshalb
        sind Wochenenden und Nachtstunden anfälliger für grosse Ausschläge.
      </p>
    </ToolBox>
  );
}
