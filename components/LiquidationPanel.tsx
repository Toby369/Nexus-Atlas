"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { AnchoredSummary, LiquidationEvent, LiquidationIntelligence } from "@/lib/types";
import PanelInfo from "@/components/PanelInfo";
import { liquidationsInfo } from "@/lib/panelInfo";
import { formatAnchorBadge } from "@/lib/anchor";

const REFRESH_INTERVAL_MS = 60_000;
const LOOKBACK_HOURS = 6;
const EVENT_LIMIT = 300;
const CASCADE_WINDOW_MS = 2 * 60_000;
const CASCADE_MIN_COUNT = 3;

// Parameter fuer get_liquidation_intelligence (Velocity-Buckets + Preis-
// Cluster-Breite) -- bewusst benannte Konstanten statt Magic Numbers.
const VELOCITY_BUCKET_MINUTES = 15;
const PRICE_CLUSTER_BUCKET_USD = 200;
// Ein Preis-Cluster wird nur angezeigt, wenn er mindestens diesen Anteil
// des gesamten erfassten Notional-Werts auf sich vereint (sonst zu wenig
// Konzentration fuer eine aussagekraeftige Aussage).
const CLUSTER_MIN_SHARE = 0.3;

function formatUsd(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

// Cascade-Heuristik: mehrere Liquidationen innerhalb eines kurzen Zeitfensters
// deuten eher auf eine Kettenreaktion hin als vereinzelte Events.
function hasCascade(events: LiquidationEvent[]): boolean {
  const times = events
    .map((e) => new Date(e.event_time_utc).getTime())
    .sort((a, b) => a - b);

  for (let i = 0; i < times.length; i++) {
    let count = 1;
    for (
      let j = i + 1;
      j < times.length && times[j] - times[i] <= CASCADE_WINDOW_MS;
      j++
    ) {
      count++;
    }
    if (count >= CASCADE_MIN_COUNT) return true;
  }
  return false;
}

async function fetchRecentLiquidations(): Promise<{
  data: LiquidationEvent[];
  ok: boolean;
}> {
  const cutoff = new Date(
    Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("liquidation_events")
    .select("*")
    .eq("status", "ok")
    .gte("event_time_utc", cutoff)
    .order("event_time_utc", { ascending: false })
    .limit(EVENT_LIMIT);

  if (error) {
    console.error("Fehler beim Laden der Liquidationen:", error.message);
    return { data: [], ok: false };
  }
  return { data: data ?? [], ok: true };
}

// Phase 1 "Anchored Analytics": laedt den kumulierten Event-Driven-Kontext
// (Long-/Short-Liquidationen seit einem frei waehlbaren Ankerpunkt) --
// unabhaengig vom festen LOOKBACK_HOURS-Fenster oben. Kein eigener
// Lade-Loop bei fehlendem Anker (haeufigster Fall), Aufrufer prueft das.
async function fetchAnchoredSummary(anchorIso: string): Promise<AnchoredSummary | null> {
  const { data, error } = await supabase.rpc("get_anchored_summary", {
    p_anchor: anchorIso,
  });

  if (error) {
    console.error("Fehler beim Laden der Anchored Summary:", error.message);
    return null;
  }
  return data ?? null;
}

async function fetchIntelligence(): Promise<LiquidationIntelligence | null> {
  const cutoff = new Date(
    Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase.rpc("get_liquidation_intelligence", {
    p_since: cutoff,
    p_bucket_minutes: VELOCITY_BUCKET_MINUTES,
    p_price_bucket_usd: PRICE_CLUSTER_BUCKET_USD,
  });

  if (error) {
    console.error("Fehler beim Laden der Liquidations-Intelligence:", error.message);
    return null;
  }
  return data ?? null;
}

// Velocity-Trend: vergleicht den juengsten Bucket mit dem Durchschnitt der
// vorherigen Buckets. Braucht mindestens 2 Buckets, um ueberhaupt einen
// Trend zu bilden -- bei weniger wird bewusst nichts angezeigt statt eine
// Aussage aus einem einzigen Datenpunkt zu erfinden.
function describeVelocityTrend(
  velocity: LiquidationIntelligence["velocity"]
): string | null {
  if (velocity.length < 2) return null;
  const last = velocity[velocity.length - 1];
  const prior = velocity.slice(0, -1);
  const priorAvg =
    prior.reduce((sum, b) => sum + b.notional_usd, 0) / prior.length;
  if (priorAvg <= 0) return null;

  if (last.notional_usd > priorAvg * 2) return "zunehmend";
  if (last.notional_usd < priorAvg * 0.5) return "abnehmend";
  return "stabil";
}

export default function LiquidationPanel({
  initialEvents,
  anchorIso,
  initialAnchoredSummary,
}: {
  initialEvents: LiquidationEvent[];
  // Phase 1 "Anchored Analytics": null, solange kein Event-Anker gesetzt
  // ist (haeufigster Fall) -- server-seitig aufgeloest in app/page.tsx,
  // dasselbe Muster wie "timeframe".
  anchorIso: string | null;
  initialAnchoredSummary: AnchoredSummary | null;
}) {
  const [events, setEvents] = useState(initialEvents);
  const [lastSyncOk, setLastSyncOk] = useState(true);
  const [intelligence, setIntelligence] = useState<LiquidationIntelligence | null>(null);
  const [anchoredSummary, setAnchoredSummary] = useState(initialAnchoredSummary);

  useEffect(() => {
    const load = async () => {
      const [{ data, ok }, intel, anchored] = await Promise.all([
        fetchRecentLiquidations(),
        fetchIntelligence(),
        anchorIso ? fetchAnchoredSummary(anchorIso) : Promise.resolve(null),
      ]);
      setLastSyncOk(ok);
      if (ok) setEvents(data);
      setIntelligence(intel);
      setAnchoredSummary(anchored);
    };
    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [anchorIso]);

  const longNotional = events
    .filter((e) => e.side === "long")
    .reduce((sum, e) => sum + (e.notional_usd ?? 0), 0);
  const shortNotional = events
    .filter((e) => e.side === "short")
    .reduce((sum, e) => sum + (e.notional_usd ?? 0), 0);
  const totalNotional = longNotional + shortNotional;
  const longPct = totalNotional > 0 ? (longNotional / totalNotional) * 100 : 0;
  const cascade = hasCascade(events);

  const velocityTrend = intelligence ? describeVelocityTrend(intelligence.velocity) : null;
  const topCluster =
    intelligence && intelligence.total_notional_usd > 0 && intelligence.price_clusters.length > 0
      ? intelligence.price_clusters[0]
      : null;
  const topClusterShare =
    topCluster && intelligence ? topCluster.notional_usd / intelligence.total_notional_usd : 0;
  const oiSharePct =
    intelligence && intelligence.total_oi_usd
      ? (intelligence.total_notional_usd / intelligence.total_oi_usd) * 100
      : null;

  return (
    <section className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">
          Liquidationen
        </h2>
        <PanelInfo title="Liquidationen" content={liquidationsInfo} />
      </div>

      {!lastSyncOk && events.length > 0 && (
        <p className="text-xs text-down">
          Sync-Problem — zuletzt bekannte Liquidationen werden angezeigt.
        </p>
      )}

      {events.length === 0 ? (
        <p className="text-sm text-text-faint">
          {lastSyncOk
            ? `Keine erfassten Liquidationen in den letzten ${LOOKBACK_HOURS}h.`
            : "Sync-Problem — Liquidationen derzeit nicht verfügbar."}
        </p>
      ) : (
        <>
          <div className="flex items-baseline justify-between">
            <span className="tabular font-mono text-2xl font-semibold text-text">
              {formatUsd(totalNotional)}
            </span>
            <span className="text-xs text-text-faint">
              {events.length} Events · letzte {LOOKBACK_HOURS}h
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-text-muted">
                Long liquidiert · Short liquidiert
              </span>
              <span className="tabular font-mono text-text-faint">
                {formatUsd(longNotional)} · {formatUsd(shortNotional)}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-up/40 overflow-hidden relative">
              <div
                className="h-full bg-down"
                style={{ width: `${longPct}%` }}
              />
            </div>
          </div>

          <p className="text-xs text-text-muted">
            {cascade
              ? "Häufung erkannt — mehrere Liquidationen kurz hintereinander (mögliche Cascade)."
              : "Vereinzelte Liquidationen, keine auffällige Häufung."}
          </p>

          {(velocityTrend || (topCluster && topClusterShare >= CLUSTER_MIN_SHARE) || oiSharePct !== null) && (
            <div className="flex flex-col gap-1 text-xs text-text-faint pt-1 border-t border-border/60">
              {velocityTrend && (
                <span>
                  Liquidationsrate: <span className="text-text-muted">{velocityTrend}</span>
                </span>
              )}
              {topCluster && topClusterShare >= CLUSTER_MIN_SHARE && (
                <span>
                  Häufungspunkt nahe{" "}
                  <span className="tabular font-mono text-text-muted">
                    ${topCluster.price_bucket.toLocaleString("de-CH")}
                  </span>{" "}
                  ({formatUsd(topCluster.notional_usd)}, {Math.round(topClusterShare * 100)}% des Volumens)
                </span>
              )}
              {oiSharePct !== null && (
                <span>
                  Entspricht {oiSharePct < 0.01 ? "<0.01" : oiSharePct.toFixed(2)}% des aktuellen
                  aggregierten Open Interest
                </span>
              )}
            </div>
          )}
        </>
      )}

      {anchorIso && (
        <div className="flex flex-col gap-1 text-xs pt-2 border-t border-border/60">
          <span className="text-text-faint">
            Seit Anker ({formatAnchorBadge(new Date(anchorIso))}):
          </span>
          {anchoredSummary ? (
            <span className="tabular font-mono text-text-muted">
              Long {formatUsd(anchoredSummary.long_liquidation_usd)} · Short{" "}
              {formatUsd(anchoredSummary.short_liquidation_usd)} ·{" "}
              {anchoredSummary.liquidation_event_count} Events
            </span>
          ) : (
            <span className="text-text-faint">Lädt…</span>
          )}
        </div>
      )}

      <p className="text-xs text-text-faint pt-1">
        Stichprobenerfassung (~25s alle 5 Min je Börse, Binance + Bybit) —
        keine lückenlose Erfassung, kein Handelssignal.
      </p>
    </section>
  );
}
