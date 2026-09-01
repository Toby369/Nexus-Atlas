"use client";

import { useState, type ReactNode } from "react";
import PanelInfo from "@/components/PanelInfo";
import {
  positioningRatiosInfo,
  takerFlowInfo,
  positioningAssessmentInfo,
} from "@/lib/panelInfo";
import type { PositioningSnapshot } from "@/lib/types";
import { RelativeTime } from "@/components/ClientTimestamp";
import { useDashboardPoll } from "@/components/DashboardPollProvider";

function pct(value: number | null) {
  return value !== null ? `${(value * 100).toFixed(1)}%` : "—";
}

export default function PositioningPanel() {
  // Datenquelle: DashboardPollProvider (Phase 2, Punkt 3) statt eigenem
  // 30s-Poll -- siehe dortiger Kommentar zur Buendelung mit
  // MarketContextCard/SpotPressurePanel.
  const { bundle, lastSyncOk } = useDashboardPoll();
  const binance = bundle.positioning_binance;
  const bybit = bundle.positioning_bybit;
  const okx = bundle.positioning_okx;
  const bitget = bundle.positioning_bitget;
  const signal = bundle.positioning_signal;
  const [retailExpanded, setRetailExpanded] = useState(false);

  // Nutzer-Feedback (01.09.2026): "Retail, Wert aller angezeigten Boersen
  // Durchschnitt anzeigen, wenn antippen, kommt Anzeige wie aktuell" --
  // ungewichteter Mittelwert ueber alle Boersen mit tatsaechlich
  // vorhandener Retail-Ratio (kein erfundener Wert fuer fehlende Boersen).
  // Bei nur einer verfuegbaren Boerse ist "Mittelwert" bedeutungslos, dann
  // wird direkt deren Wert unter ihrem eigenen Namen gezeigt (kein Ø-Label,
  // kein leerer Aufklapp-Pfeil ohne Inhalt).
  const retailExchanges: { label: string; snapshot: PositioningSnapshot | null }[] = [
    { label: "Binance", snapshot: binance },
    { label: "Bybit", snapshot: bybit },
    { label: "OKX", snapshot: okx },
    { label: "Bitget", snapshot: bitget },
  ];
  const retailEntries = retailExchanges
    .map(({ label, snapshot }) => ({
      label,
      long: snapshot?.global_long_account_ratio ?? null,
      short: snapshot?.global_short_account_ratio ?? null,
    }))
    .filter(
      (e): e is { label: string; long: number; short: number } =>
        e.long !== null && e.short !== null
    );
  const retailAvgLong =
    retailEntries.length > 0
      ? retailEntries.reduce((sum, e) => sum + e.long, 0) / retailEntries.length
      : null;
  const retailAvgShort =
    retailEntries.length > 0
      ? retailEntries.reduce((sum, e) => sum + e.short, 0) / retailEntries.length
      : null;

  if (!binance && !bybit && !okx && !bitget) {
    return (
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">
          Positionierung
        </h2>
        <p className="text-sm text-text-faint mt-3">
          Noch keine Positioning-Daten vorhanden.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">
          Positionierung
        </h2>
        <PanelInfo title="Positionierung" content={positioningRatiosInfo} />
      </div>

      {!lastSyncOk && (
        <p className="text-xs text-down">
          Sync-Problem — zuletzt bekannte Positioning-Daten werden angezeigt.
        </p>
      )}

      <div className="space-y-3">
        {retailEntries.length === 1 && (
          <RatioBar
            label={`Retail (${retailEntries[0].label})`}
            long={retailEntries[0].long}
            short={retailEntries[0].short}
          />
        )}
        {retailEntries.length > 1 && (
          <div>
            <button
              type="button"
              onClick={() => setRetailExpanded((e) => !e)}
              aria-expanded={retailExpanded}
              className="w-full text-left"
            >
              <RatioBar
                label={`Retail (Ø ${retailEntries.length} Börsen)`}
                long={retailAvgLong}
                short={retailAvgShort}
                adornment={
                  <span className="text-text-faint text-[10px]">
                    {retailExpanded ? "▾" : "▸"}
                  </span>
                }
              />
            </button>
            {retailExpanded && (
              <div className="mt-2 pl-3 border-l border-border/60 space-y-2">
                {retailEntries.map((e) => (
                  <RatioBar
                    key={e.label}
                    label={`Retail (${e.label})`}
                    long={e.long}
                    short={e.short}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        {binance && (
          <RatioBar
            label="Top Trader (Binance, Positionen)"
            long={binance.top_trader_long_position_ratio}
            short={binance.top_trader_short_position_ratio}
          />
        )}
      </div>

      {binance?.taker_buy_sell_ratio != null && (
        <div className="flex items-center justify-between text-xs pt-1">
          <span className="flex items-center gap-1.5 text-text-muted">
            Taker-Flow (Binance)
            <PanelInfo title="Taker-Flow" content={takerFlowInfo} />
          </span>
          <span className="tabular font-mono text-text-faint">
            {binance.taker_buy_sell_ratio.toFixed(2)}× Buy/Sell
          </span>
        </div>
      )}

      {signal && (
        <div className="pt-3 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <p className="text-xs uppercase tracking-[0.15em] text-text-muted">
                Einschätzung
              </p>
              <PanelInfo title="Einschätzung" content={positioningAssessmentInfo} />
            </div>
            <RelativeTime iso={signal.timestamp_utc} className="text-xs text-text-faint" />
          </div>
          <p className="text-sm text-text leading-relaxed">
            {signal.explanation}
          </p>
          <p className="text-xs text-text-faint mt-2">
            Confidence:{" "}
            {signal.confidence !== null ? Math.round(signal.confidence) : "—"}
            /100 · Zeitrahmen: {signal.timeframe ?? "—"}
          </p>
        </div>
      )}
    </section>
  );
}

function RatioBar({
  label,
  long,
  short,
  adornment,
}: {
  label: string;
  long: number | null;
  short: number | null;
  adornment?: ReactNode;
}) {
  const longWidth = long !== null ? long * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-text-muted flex items-center gap-1">
          {label}
          {adornment}
        </span>
        <span className="tabular font-mono text-text-faint">
          {pct(long)} long · {pct(short)} short
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-down/40 overflow-hidden relative">
        <div className="h-full bg-up" style={{ width: `${longWidth}%` }} />
      </div>
    </div>
  );
}
