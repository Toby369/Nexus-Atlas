"use client";

import { useState } from "react";
import { useLivePriceData } from "@/components/LivePriceDataProvider";
import PanelInfo from "@/components/PanelInfo";
import { exchangeDivergenceInfo } from "@/lib/panelInfo";
import { formatSignedPct } from "@/lib/livePriceFormat";
import type { OiChangeByExchange } from "@/lib/types";

// Aus der ehemaligen LivePricePanel.tsx herausgeloest (Nutzer-Feedback
// 05.09.2026, siehe LivePriceDataProvider.tsx) -- vormals die interne
// Funktion ExchangeOiDivergenceCard, unveraendert uebernommen, nur als
// eigenstaendige, unabhaengig verschieb-/groessenbare Kachel.
//
// Zeigt OI-Change% je Boerse fuer denselben Zeitraum wie der Rest der Seite
// -- macht sichtbar, welche Boersen tatsaechlich zur "Aggregiert"-Summe im
// OI-Change-Kachel beitragen (Exchange Divergence, "welche Boerse treibt
// eine Bewegung"). Bitunix wird explizit als "UNAVAILABLE" gefuehrt statt
// stillschweigend zu fehlen, da diese Boerse nachweislich keine oeffentliche
// OI-Route hat (siehe collect-btc).
//
// Nutzer-Feedback (01.09.2026): analog zur "Retail"-Zusammenfassung in
// Positionierung -- Standardansicht zeigt den ungewichteten Durchschnitt
// ueber alle Boersen mit tatsaechlichem OI-Change-Wert, antippen klappt die
// Boersen einzeln auf.

const COMPARE_EXCHANGES = ["bybit", "binance", "okx", "bitget", "bitunix", "pionex"];
const EXCHANGE_LABELS: Record<string, string> = {
  bybit: "Bybit",
  binance: "Binance",
  okx: "OKX",
  bitget: "Bitget",
  bitunix: "Bitunix",
  pionex: "Pionex",
};
// Boersen, ueber die sich ein OI-Change-Durchschnitt ueberhaupt sinnvoll
// bilden laesst -- Bitunix bewusst ausgeschlossen (liefert nachweislich
// dauerhaft kein Open Interest, kein fehlender Einzelwert wie bei den
// anderen Boersen).
const OI_AVERAGEABLE_EXCHANGES = COMPARE_EXCHANGES.filter((ex) => ex !== "bitunix");

export default function OiByExchangeCard() {
  const { oiByExchange: entries, selectedTf } = useLivePriceData();
  const tfLabel = selectedTf.label;
  const [expanded, setExpanded] = useState(false);
  const byExchange = new Map(entries.map((e) => [e.exchange, e]));
  const anyIncomplete = entries.some((e) => !e.has_full_history);

  const availableEntries = OI_AVERAGEABLE_EXCHANGES.map((ex) => byExchange.get(ex)).filter(
    (e): e is OiChangeByExchange => !!e && e.oi_change_pct !== null
  );
  const avgOiChangePct =
    availableEntries.length > 0
      ? availableEntries.reduce((sum, e) => sum + (e.oi_change_pct as number), 0) /
        availableEntries.length
      : null;
  const showAverage = availableEntries.length > 1;

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">
          OI je Börse · {tfLabel}
        </h2>
        <PanelInfo title="OI je Börse" content={exchangeDivergenceInfo(tfLabel)} />
      </div>

      {showAverage && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="w-full flex items-center justify-between text-sm mb-2"
        >
          <span className="text-text-muted flex items-center gap-1">
            Ø {availableEntries.length} Börsen
            <span className="text-text-faint text-[10px]">{expanded ? "▾" : "▸"}</span>
          </span>
          <span
            className={`tabular font-mono ${
              avgOiChangePct === null
                ? "text-text-faint"
                : avgOiChangePct >= 0
                ? "text-up"
                : "text-down"
            }`}
          >
            {formatSignedPct(avgOiChangePct)}
          </span>
        </button>
      )}

      {(!showAverage || expanded) && (
        <div className={`space-y-2 ${showAverage ? "pl-3 border-l border-border/60" : ""}`}>
          {COMPARE_EXCHANGES.map((ex) => {
            const data = byExchange.get(ex);
            const isUnavailable = ex === "bitunix";

            return (
              <div key={ex} className="flex items-center justify-between text-sm">
                <span className="text-text-muted w-20 flex-shrink-0">
                  {EXCHANGE_LABELS[ex] ?? ex}
                </span>
                {isUnavailable ? (
                  <span className="tabular font-mono text-xs text-text-faint flex-1 text-right">
                    UNAVAILABLE
                  </span>
                ) : data && data.oi_change_pct !== null ? (
                  <span
                    className={`tabular font-mono flex-1 text-right ${
                      data.oi_change_pct >= 0 ? "text-up" : "text-down"
                    }`}
                  >
                    {formatSignedPct(data.oi_change_pct)}
                    {!data.has_full_history && " *"}
                  </span>
                ) : (
                  <span className="tabular font-mono text-xs text-text-faint flex-1 text-right">
                    —
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-text-faint mt-3">
        Diese Börsen fliessen in &quot;Aggregiert&quot; ein. UNAVAILABLE = Börse
        bietet öffentlich kein Open Interest.
        {anyIncomplete && " * Historie für diesen Zeitraum noch unvollständig."}
      </p>
    </section>
  );
}
