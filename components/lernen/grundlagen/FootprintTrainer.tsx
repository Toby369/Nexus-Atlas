"use client";

import { useState } from "react";
import {
  FOOTPRINT_SCENARIOS,
  PATTERN_LABELS,
  candleDelta,
  candleVolume,
  diagonalImbalances,
  pocPrice,
  type FootprintPattern,
} from "@/lib/grundlagen/footprint";
import { Pill, Stat, ToolBox, formatNum } from "./ui";

const PATTERNS = Object.keys(PATTERN_LABELS) as FootprintPattern[];

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatNum(value)}`;
}

export default function FootprintTrainer() {
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<FootprintPattern | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });
  const [showHelp, setShowHelp] = useState(true);

  const scenario = FOOTPRINT_SCENARIOS[index];
  const { candle } = scenario;
  const delta = candleDelta(candle);
  const poc = pocPrice(candle);
  const imbalances = diagonalImbalances(candle);
  const maxSide = Math.max(...candle.levels.flatMap((l) => [l.bid, l.ask]), 1);
  const bodyHigh = Math.max(candle.open, candle.close);
  const bodyLow = Math.min(candle.open, candle.close);
  const bullish = candle.close >= candle.open;
  const correct = choice === scenario.answer;

  function answer(p: FootprintPattern) {
    if (choice) return;
    setChoice(p);
    setScore((s) => ({ right: s.right + (p === scenario.answer ? 1 : 0), total: s.total + 1 }));
  }

  function next() {
    setChoice(null);
    setIndex((i) => (i + 1) % FOOTPRINT_SCENARIOS.length);
  }

  return (
    <ToolBox title="Footprint-Trainer · welches Muster?">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[11px] text-text-faint">
          Kerze {index + 1}/{FOOTPRINT_SCENARIOS.length} · richtig {score.right}/{score.total}
        </span>
        <label className="flex items-center gap-1.5 text-[11px] text-text-faint cursor-pointer">
          <input type="checkbox" checked={showHelp} onChange={(e) => setShowHelp(e.target.checked)} />
          Hilfen (Ungleichgewichte, POC)
        </label>
      </div>
      <p className="text-xs text-text">{scenario.context}</p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[20rem] text-xs font-mono tabular" aria-label="Footprint-Kerze">
          <thead>
            <tr className="text-[10px] text-text-faint font-sans">
              <th className="text-left font-normal pb-1">Preis</th>
              <th className="font-normal pb-1 w-6" aria-label="Kerze" />
              <th className="text-right font-normal pb-1">Bid (Verkäufe)</th>
              <th className="text-left font-normal pb-1 pl-2">Ask (Käufe)</th>
            </tr>
          </thead>
          <tbody>
            {candle.levels.map((l, i) => {
              const inBody = l.price <= bodyHigh && l.price >= bodyLow;
              const isPoc = showHelp && l.price === poc;
              const imb = showHelp ? imbalances[i] : null;
              return (
                <tr key={l.price} className={isPoc ? "outline outline-1 outline-accent/60" : ""}>
                  <td className="py-0.5 pr-2 text-text-muted">{formatNum(l.price)}</td>
                  <td className="py-0.5">
                    <div className="flex justify-center h-4">
                      <div
                        className={`${inBody ? "w-2.5" : "w-0.5"} h-full ${bullish ? "bg-up/70" : "bg-down/70"}`}
                        aria-hidden
                      />
                    </div>
                  </td>
                  <td className="py-0.5">
                    <div className="relative flex justify-end">
                      <div
                        className="absolute right-0 top-0 h-full bg-down/15 rounded-l"
                        style={{ width: `${(l.bid / maxSide) * 100}%` }}
                        aria-hidden
                      />
                      <span className={`relative pr-1 ${imb === "sell" ? "text-down font-semibold" : "text-text-muted"}`}>
                        {formatNum(l.bid)}
                      </span>
                    </div>
                  </td>
                  <td className="py-0.5 pl-2 border-l border-border">
                    <div className="relative">
                      <div
                        className="absolute left-0 top-0 h-full bg-up/15 rounded-r"
                        style={{ width: `${(l.ask / maxSide) * 100}%` }}
                        aria-hidden
                      />
                      <span className={`relative pl-1 ${imb === "buy" ? "text-up font-semibold" : "text-text-muted"}`}>
                        {formatNum(l.ask)}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Delta" value={signed(delta)} tone={delta >= 0 ? "bullish" : "bearish"} />
        <Stat label="Volumen" value={formatNum(candleVolume(candle))} />
        <Stat label="Open → Close" value={`${formatNum(candle.open)} → ${formatNum(candle.close)}`} />
      </div>
      {showHelp && (
        <p className="text-[11px] text-text-faint">
          Fett grün/rot: diagonales Ungleichgewicht (mindestens 3×). Umrandet: POC. Dicker Balken: Kerzenkörper,
          dünner: Docht.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Antwort wählen">
        {PATTERNS.map((p) => {
          const picked = choice === p;
          const isAnswer = choice !== null && p === scenario.answer;
          return (
            <button
              key={p}
              type="button"
              onClick={() => answer(p)}
              disabled={choice !== null}
              className={`px-2.5 py-1 text-xs rounded-md border ${
                isAnswer
                  ? "border-up/50 bg-up/10 text-up"
                  : picked
                  ? "border-down/50 bg-down/10 text-down"
                  : "border-border text-text-muted hover:text-text disabled:opacity-50"
              }`}
            >
              {PATTERN_LABELS[p]}
            </button>
          );
        })}
      </div>

      {choice && (
        <div className="rounded-md bg-surface-raised p-3 space-y-2" aria-live="polite">
          <Pill tone={correct ? "bullish" : "bearish"}>
            {correct ? "Richtig" : `Nicht ganz: ${PATTERN_LABELS[scenario.answer]}`}
          </Pill>
          <p className="text-xs text-text-muted">{scenario.explanation}</p>
          <p className="text-xs text-text-muted">
            <span className="font-medium text-text">Was du daraus machst:</span> {scenario.action}
          </p>
          <button
            type="button"
            onClick={next}
            className="text-[11px] px-2 py-0.5 rounded border border-accent/40 text-accent"
          >
            Nächste Kerze
          </button>
        </div>
      )}
    </ToolBox>
  );
}
