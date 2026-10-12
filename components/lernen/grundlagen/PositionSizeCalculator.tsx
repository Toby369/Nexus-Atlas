"use client";

import { useState } from "react";
import { computePosition } from "@/lib/grundlagen/positionSizing";
import { NumberField, Pill, Stat, ToolBox, formatNum, type Tone } from "./ui";

// Standardwerte: Stop 1,5 % unter Entry, Ziel 3 % darueber (CRV 1:2).
const DEFAULT_PRICE = 60_000;

export default function PositionSizeCalculator({ livePrice }: { livePrice: number | null }) {
  const start = Math.round(livePrice ?? DEFAULT_PRICE);
  const [account, setAccount] = useState(10_000);
  const [riskPct, setRiskPct] = useState(1);
  const [winRate, setWinRate] = useState(45);
  const [entry, setEntry] = useState(start);
  const [stop, setStop] = useState(Math.round(start * 0.985));
  const [target, setTarget] = useState(Math.round(start * 1.03));
  const [leverage, setLeverage] = useState(10);

  const r = computePosition({ account, riskPct, entry, stop, target, winRatePct: winRate, leverage });

  let verdict: { tone: Tone; text: string } | null = null;
  if (r) {
    if (r.rewardRisk === null) {
      verdict = {
        tone: "bearish",
        text: `Das Ziel liegt auf der falschen Seite. Für einen ${r.side === "long" ? "Long" : "Short"} muss es ${
          r.side === "long" ? "über" : "unter"
        } dem Entry liegen.`,
      };
    } else if (r.expectancyR !== null && r.expectancyR > 0) {
      verdict = {
        tone: r.expectancyR > 0.1 ? "bullish" : "watch",
        text: `Mit ${formatNum(winRate)} % Trefferquote gewinnst du im Schnitt ${formatNum(r.expectancyR, 2)} R pro Trade, also ${formatNum(
          r.expectancyR * r.riskAmount
        )} USD bei diesem Risiko.`,
      };
    } else if (r.expectancyR !== null) {
      verdict = {
        tone: "bearish",
        text: `Mit ${formatNum(winRate)} % Trefferquote verlierst du im Schnitt ${formatNum(Math.abs(r.expectancyR), 2)} R pro Trade. Du brauchst mindestens ${formatNum(
          r.breakEvenWinRatePct ?? 0
        )} % Treffer oder ein besseres CRV.`,
      };
    }
  }

  return (
    <ToolBox title="Positionsgrössen-Rechner">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <NumberField id="ps-acc" label="Konto (USD)" value={account} onChange={setAccount} step={500} />
        <NumberField id="ps-risk" label="Risiko pro Trade (%)" value={riskPct} onChange={setRiskPct} step={0.25} />
        <NumberField id="ps-wr" label="Trefferquote (%)" value={winRate} onChange={setWinRate} step={1} />
        <NumberField id="ps-lev" label="Börsen-Hebel (isoliert)" value={leverage} onChange={setLeverage} step={1} />
        <NumberField id="ps-entry" label="Entry" value={entry} onChange={setEntry} step={50} />
        <NumberField id="ps-stop" label="Stop" value={stop} onChange={setStop} step={50} />
        <NumberField id="ps-tp" label="Ziel" value={target} onChange={setTarget} step={50} />
      </div>

      {!r ? (
        <p className="text-xs text-text-faint">Gib Konto, Risiko, Entry und einen Stop ungleich Entry ein.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Max. Verlust" value={`${formatNum(r.riskAmount)} USD`} />
            <Stat label="Stop-Abstand" value={`${formatNum(r.stopDistancePct, 2)} %`} />
            <Stat label="Positionsgrösse" value={`${formatNum(r.sizeBtc, 4)} BTC`} />
            <Stat label="Effektiver Hebel" value={`${formatNum(r.effectiveLeverage, 1)}×`} />
            <Stat label="CRV" value={r.rewardRisk === null ? "—" : `1 : ${formatNum(r.rewardRisk, 2)}`} />
            <Stat
              label="Break-even-Quote"
              value={r.breakEvenWinRatePct === null ? "—" : `${formatNum(r.breakEvenWinRatePct)} %`}
            />
            <Stat
              label="Liquidation ca."
              value={r.liquidationPrice === null ? "keine" : formatNum(r.liquidationPrice)}
              tone={r.liquidationBeforeStop ? "bearish" : r.liquidationTight ? "watch" : undefined}
            />
            <Stat label="Positionswert" value={`${formatNum(r.notional)} USD`} />
          </div>
          {verdict && (
            <div className="rounded-md bg-surface-raised p-3 space-y-1.5" aria-live="polite">
              <div className="flex flex-wrap gap-1.5">
                <Pill tone={r.side === "long" ? "bullish" : "bearish"}>{r.side === "long" ? "Long" : "Short"}</Pill>
                {r.expectancyR !== null && (
                  <Pill tone={verdict.tone}>
                    Erwartungswert {r.expectancyR >= 0 ? "+" : ""}
                    {formatNum(r.expectancyR, 2)} R
                  </Pill>
                )}
              </div>
              <p className="text-xs text-text-muted">{verdict.text}</p>
              {r.liquidationBeforeStop && r.liquidationPrice !== null && (
                <p className="text-xs text-down font-medium">
                  Achtung: Bei {formatNum(leverage)}× Hebel wirst du bei ca. {formatNum(r.liquidationPrice)} liquidiert,
                  bevor dein Stop bei {formatNum(stop)} greift. Senke den Börsen-Hebel.
                </p>
              )}
              {r.liquidationTight && (
                <p className="text-xs text-accent">
                  Die Liquidation liegt sehr nahe am Stop. Rutscht der Stop in einer Kaskade durch, wirst du trotzdem
                  liquidiert.
                </p>
              )}
            </div>
          )}
        </>
      )}
      <p className="text-[11px] text-text-faint">
        Der Börsen-Hebel ändert nur die hinterlegte Margin, nicht dein Risiko. Das Risiko bestimmen Positionsgrösse und
        Stop, solange der Stop vor der Liquidation liegt. Gebühren und Slippage sind nicht eingerechnet; der
        Liquidationspreis ist eine Näherung (0,5 % Wartungsmarge).
      </p>
    </ToolBox>
  );
}
