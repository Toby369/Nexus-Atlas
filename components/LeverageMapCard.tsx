import type { LeverageMapResult } from "@/lib/leverageMap";
import PanelInfo from "@/components/PanelInfo";

// Umsetzungsplan Phase 4 (05.09.2026): Liquidations-/Hebelkarte, Konzept +
// Modell aus shared/leverageMap.js im Crypto-Trading-Journal. Reiner
// Server-Component-Render (kein "use client" noetig, keine Interaktion) --
// die Berechnung passiert bereits serverseitig in lib/leverageMapContext.ts
// beim Seitenaufruf.

const INFO_TEXT = [
  "Was das ist: ein MODELL, keine Messung -- schaetzt aus der Open-Interest-Historie der letzten 48h, wo gehebelte Positionen liquidiert wuerden. Steigt das offene Interesse, wurden dort Positionen eroeffnet; die Kerze sagt zu welchem Preis, das Taker-Volumen (angenaehert) in welche Richtung.",
  "Long-Cluster (unterhalb des Preises): hier wuerden LONG-Positionen liquidiert -- erzwungene Verkaeufe. Short-Cluster (oberhalb): hier wuerden SHORT-Positionen liquidiert -- erzwungene Kaeufe.",
  "Bekannte Grenzen: ΔOI ist ein Saldo (Umschlag innerhalb einer Stunde bleibt unsichtbar), jeder Kontrakt hat zwei Seiten (das Modell unterstellt je Periode nur eine gehebelte Seite), der Einstiegspreis innerhalb einer Kerze ist unbekannt, die tatsaechliche Hebelverteilung ist unbekannt (10x/25x/50x/100x sind ein Was-waere-wenn), Cross Margin/Nachschuss sind nicht abgebildet.",
  "Kein Handelssignal -- eine Orientierungshilfe fuer wo sich Liquidations-Kaskaden HAEUFEN KOENNTEN, keine Vorhersage eines konkreten Preisziels.",
].join("\n\n");

function formatUsd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function ClusterRow({ price, mid, massUsd, tiers }: { price: number; mid: number; massUsd: number; tiers: number[] }) {
  const distancePct = ((price - mid) / mid) * 100;
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-text">
        ${price.toLocaleString("de-CH", { maximumFractionDigits: 0 })}
        <span className="text-text-faint ml-1">
          ({distancePct >= 0 ? "+" : ""}
          {distancePct.toFixed(1)}%)
        </span>
      </span>
      <span className="text-text-faint">{tiers.map((t) => `${t}x`).join(", ")}</span>
      <span className="font-medium text-text">{formatUsd(massUsd)}</span>
    </div>
  );
}

export default function LeverageMapCard({ map }: { map: LeverageMapResult | null }) {
  if (!map || map.clusters.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-5">
        <p className="text-sm font-medium text-text mb-2">Liquidations-/Hebelkarte</p>
        <p className="text-xs text-text-faint">
          Nicht genug OI-Historie fuer die letzten 48h -- keine Karte berechenbar.
        </p>
      </div>
    );
  }

  const longClusters = map.clusters.filter((c) => c.side === "long").sort((a, b) => b.price - a.price);
  const shortClusters = map.clusters.filter((c) => c.side === "short").sort((a, b) => a.price - b.price);

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-text">Liquidations-/Hebelkarte</p>
          <PanelInfo title="Liquidations-/Hebelkarte" content={INFO_TEXT} />
        </span>
        <span className="text-xs text-text-faint">
          Modell · ${map.mid.toLocaleString("de-CH", { maximumFractionDigits: 0 })}
        </span>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs uppercase tracking-[0.12em] text-text-faint">
          Short-Liquidationen oberhalb
        </p>
        {shortClusters.length === 0 ? (
          <p className="text-xs text-text-faint">Keine relevanten Cluster erkannt.</p>
        ) : (
          shortClusters.map((c, i) => (
            <ClusterRow key={i} price={c.price} mid={map.mid} massUsd={c.massCoins * map.mid} tiers={c.tiers} />
          ))
        )}
      </div>

      <div className="space-y-1.5 pt-2 border-t border-border">
        <p className="text-xs uppercase tracking-[0.12em] text-text-faint">
          Long-Liquidationen unterhalb
        </p>
        {longClusters.length === 0 ? (
          <p className="text-xs text-text-faint">Keine relevanten Cluster erkannt.</p>
        ) : (
          longClusters.map((c, i) => (
            <ClusterRow key={i} price={c.price} mid={map.mid} massUsd={c.massCoins * map.mid} tiers={c.tiers} />
          ))
        )}
      </div>

      {map.droppedTiers.length > 0 && (
        <p className="text-xs text-text-faint pt-1">
          Verworfene Hebelstufen (bei aktueller Wartungsmarge nicht haltbar):{" "}
          {map.droppedTiers.map((t) => `${t}x`).join(", ")}
        </p>
      )}
    </div>
  );
}
