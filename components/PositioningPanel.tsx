"use client";

import PanelInfo from "@/components/PanelInfo";
import {
  positioningRatiosInfo,
  takerFlowInfo,
  positioningAssessmentInfo,
} from "@/lib/panelInfo";
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
        {binance && (
          <RatioBar
            label="Retail (Binance)"
            long={binance.global_long_account_ratio}
            short={binance.global_short_account_ratio}
          />
        )}
        {binance && (
          <RatioBar
            label="Top Trader (Binance, Positionen)"
            long={binance.top_trader_long_position_ratio}
            short={binance.top_trader_short_position_ratio}
          />
        )}
        {bybit && (
          <RatioBar
            label="Retail (Bybit)"
            long={bybit.global_long_account_ratio}
            short={bybit.global_short_account_ratio}
          />
        )}
        {okx && (
          <RatioBar
            label="Retail (OKX)"
            long={okx.global_long_account_ratio}
            short={okx.global_short_account_ratio}
          />
        )}
        {bitget && (
          <RatioBar
            label="Retail (Bitget)"
            long={bitget.global_long_account_ratio}
            short={bitget.global_short_account_ratio}
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
}: {
  label: string;
  long: number | null;
  short: number | null;
}) {
  const longWidth = long !== null ? long * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-text-muted">{label}</span>
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
