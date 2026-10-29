"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLivePriceData } from "@/components/LivePriceDataProvider";
import StepCard from "@/components/StepCard";
import { zonesInfo } from "@/lib/panelInfo";
import { nearestLiquidationTargets, nearestZones, type LiquidationTarget, type ZoneRow } from "@/lib/zones";
import { isSyncStale, AUTARK_SYNC_STALE_MINUTES, type AutarkSyncStatus, type OwnZone } from "@/lib/ownZones";
import { STOP_LOSS_PCT } from "@/lib/veto";
import { computeTpSuggestions, type TpSuggestion } from "@/lib/tpStandard";

// Zonen-Kachel (Schritt 2 im Dashboard, Toby 22.10.2026): naechste
// Verkaeufer-Zone ueber und Kaeufer-Zone unter dem Live-Kurs, mit Abstand,
// Chance-Risiko (SL 0,5 % Kurs) und TP-Standard. Die 4H-Koerperfrage
// beantwortet der Regelcheck (lib/ruleCheck.ts).
// 27.10.2026: eigene Zonen haben Vorrang (Nexus-Keylevels nur Abgleich), dazu
// je Seite die naechste Liquidations-Zone als Ziel (Regelwerk Punkt 7).
// 29.10.2026: Zonen kommen aus AutarkTrade (Bereich + Name, Sync alle 5 Min);
// dann keine Handeingabe mehr, dafuer "Stand HH:MM" und eine Warnung, wenn
// der Sync laenger als 30 Min schweigt.

const fmt = (n: number) => n.toLocaleString("de-CH", { maximumFractionDigits: 0 });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
const STALE_CHECK_MS = 60_000;

function verdictText(s: TpSuggestion | undefined): string {
  if (!s || s.distancePct === null) return "";
  if (!s.standard) return "kein Trade (unter 1 %)";
  return `Standard ${s.standard.id} (TP ${s.standard.marginPct} %)${s.againstDaily ? " · ⚠ gegen 1D" : ""}`;
}

function ZoneBox({ zone, suggestion }: { zone: ZoneRow; suggestion?: TpSuggestion }) {
  const sell = zone.role === "Verkäufer-Zone";
  const sign = sell ? "+" : "−";
  return (
    <div
      className={`grid grid-cols-[1fr_auto] gap-x-3 rounded-md border px-3 py-2 text-xs ${
        sell ? "border-down/40 bg-down/10" : "border-up/40 bg-up/10"
      }`}
    >
      <span className={`font-semibold ${sell ? "text-down" : "text-up"}`}>
        {zone.role}
        {zone.label && <span className="font-normal text-text-muted"> · {zone.label}</span>}
      </span>
      <span className="font-mono tabular text-text">
        {zone.low === zone.high ? fmt(zone.price) : `${fmt(zone.low)}–${fmt(zone.high)}`}
      </span>
      <span className="col-span-2 text-text-muted">
        {sign}
        {zone.distancePct.toFixed(1)} %
        {suggestion && (
          <>
            {" · CRV "}
            {(zone.distancePct / STOP_LOSS_PCT).toFixed(1)}
            {" · "}
            <span className={suggestion.standard ? "text-text" : "text-down"}>{verdictText(suggestion)}</span>
          </>
        )}
      </span>
    </div>
  );
}

function fmtUsdM(usd: number): string {
  return usd >= 1e9 ? `${(usd / 1e9).toFixed(1)} Mrd. $` : `${Math.round(usd / 1e6)} Mio. $`;
}

function LiqLine({ dir, target }: { dir: "↑" | "↓"; target: LiquidationTarget | null }) {
  if (!target) return null;
  return (
    <p className="text-xs text-text-muted">
      <span className="text-accent">Liquidations-Ziel {dir}</span>{" "}
      <span className="font-mono tabular text-text">
        {fmt(target.low)}–{fmt(target.high)}
      </span>{" "}
      · {dir === "↑" ? "+" : "−"}
      {target.distancePct.toFixed(1)} % · {fmtUsdM(target.massUsd)}
    </p>
  );
}

function OwnZonesEditor({
  ownZones,
  nexusLevels,
  price,
  autark,
  sync,
  stale,
}: {
  ownZones: OwnZone[];
  nexusLevels: { price: number }[];
  price: number | null;
  autark: boolean;
  sync: AutarkSyncStatus | null;
  stale: boolean;
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nexus = nearestZones(nexusLevels, price, 1);

  async function send(method: "POST" | "DELETE", payload: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/own-zones", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? `HTTP ${res.status}`);
      setInput("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Eingabe wie im Chart: "82'250", "82 250" oder "82250".
  const parsed = Number(input.replace(/['’\s]/g, "").replace(",", "."));

  return (
    <div className="space-y-2 border-t border-border/60 pt-2">
      {autark ? (
        <>
          <p className="text-[11px] uppercase tracking-[0.12em] text-text-faint">
            Zonen aus AutarkTrade{sync?.lastSyncAt ? ` · Stand ${fmtTime(sync.lastSyncAt)}` : ""}
          </p>
          {stale && (
            <p className="text-xs text-warn">
              Seit über {AUTARK_SYNC_STALE_MINUTES} Minuten kein Abgleich mit AutarkTrade: Zonen evtl. veraltet. Läuft
              AutarkTrade auf dem VPS?
            </p>
          )}
        </>
      ) : (
        <p className="text-[11px] uppercase tracking-[0.12em] text-text-faint">Deine Zonen aus dem Chart</p>
      )}
      {autark ? null : ownZones.length === 0 ? (
        <p className="text-xs text-text-muted">Noch keine eingetragen: Nexus rechnet mit den eigenen Keylevels.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {ownZones.map((z) => (
            <span key={z.id} className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs">
              <span className="font-mono tabular text-text">{fmt(z.price)}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => send("DELETE", { id: z.id })}
                aria-label={`Zone ${fmt(z.price)} löschen`}
                className="px-1 text-text-faint hover:text-down"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {!autark && (
        <>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (Number.isFinite(parsed) && parsed > 0) send("POST", { price: parsed });
          }}
        >
          <input
            inputMode="decimal"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="z. B. 82'250"
            className="w-32 rounded border border-border bg-surface-raised px-2 py-1 text-xs font-mono text-text"
          />
          <button
            type="submit"
            disabled={busy || !(Number.isFinite(parsed) && parsed > 0)}
            className="rounded border border-accent/40 px-3 py-1 text-xs text-accent disabled:opacity-40"
          >
            Hinzufügen
          </button>
        </form>
        {error && <p className="text-xs text-down">{error}</p>}
        </>
      )}
      {ownZones.length > 0 && (nexus.above[0] || nexus.below[0]) && (
        <p className="text-[11px] text-text-faint">
          Nexus-Abgleich:{" "}
          {[nexus.above[0] && `↑ ${fmt(nexus.above[0].price)}`, nexus.below[0] && `↓ ${fmt(nexus.below[0].price)}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

export default function ZonesCard({
  keyLevels,
  ownZones,
  nexusLevels,
  liquidationZones,
  dailyTrend,
  autarkSync,
}: {
  /** Aktive Levels: eigene Zonen, falls vorhanden, sonst Nexus-Keylevels. */
  keyLevels: { price: number; low?: number | null; high?: number | null; label?: string | null }[];
  ownZones: OwnZone[];
  autarkSync: AutarkSyncStatus | null;
  nexusLevels: { price: number }[];
  liquidationZones: { side: "long" | "short"; priceLow: number; priceHigh: number; massUsd: number }[];
  dailyTrend: "bullish" | "bearish" | null;
}) {
  const { latest } = useLivePriceData();
  const price = latest?.last_price ?? null;
  const { above, below } = nearestZones(keyLevels, price);
  const [longS, shortS] = computeTpSuggestions(keyLevels, price, dailyTrend);
  const liq = nearestLiquidationTargets(liquidationZones, price);
  const autark = ownZones.some((z) => z.source === "autark");
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!autark) return;
    const check = () => setStale(isSyncStale(autarkSync?.lastSyncAt ?? null, Date.now()));
    check();
    const interval = setInterval(check, STALE_CHECK_MS);
    return () => clearInterval(interval);
  }, [autark, autarkSync?.lastSyncAt]);
  const baseLine =
    price === null
      ? "Kein Live-Kurs"
      : [above[0] && `↑ ${fmt(above[0].price)} +${above[0].distancePct.toFixed(1)} %`, below[0] && `↓ ${fmt(below[0].price)} −${below[0].distancePct.toFixed(1)} %`]
          .filter(Boolean)
          .join(" · ") || "Keine Zonen in der Nähe";
  const line = autark && stale ? `${baseLine} · ⚠ Zonen veraltet` : baseLine;

  return (
    <StepCard step={2} title="Zonen" line={line} tone={autark && stale ? "warn" : "neutral"} info={zonesInfo} usageId="zones">
      <p className="text-[11px] text-text-faint">
        {autark ? "Zonen aus AutarkTrade" : ownZones.length > 0 ? "Deine Zonen" : "Nexus-Keylevels"} · SL 0,5 %
      </p>
      <LiqLine dir="↑" target={liq.above} />
      {price === null || (above.length === 0 && below.length === 0) ? (
        <p className="text-xs text-text-faint">Keine Zonen oder kein Live-Kurs verfügbar.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {[...above].reverse().map((z, i) => (
            <ZoneBox key={`a${z.price}`} zone={z} suggestion={i === above.length - 1 ? longS : undefined} />
          ))}
          <div className="flex items-center gap-2 text-[11px] text-accent">
            <span className="h-px flex-1 bg-accent/50" />
            <span className="font-mono tabular">Kurs {fmt(price)}</span>
            <span className="h-px flex-1 bg-accent/50" />
          </div>
          {below.map((z, i) => (
            <ZoneBox key={`b${z.price}`} zone={z} suggestion={i === 0 ? shortS : undefined} />
          ))}
        </div>
      )}
      <LiqLine dir="↓" target={liq.below} />
      <OwnZonesEditor
        ownZones={ownZones}
        nexusLevels={nexusLevels}
        price={price}
        autark={autark}
        sync={autarkSync}
        stale={stale}
      />
    </StepCard>
  );
}
