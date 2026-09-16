import type { OrderbookWallSnapshot } from "@/lib/types";
import { StaleBadge } from "@/components/ClientTimestamp";
import PanelInfo from "@/components/PanelInfo";

// Nutzer-Wunsch nach einer "Bookmap"-Ansicht -- echtes Live-L2-Orderbuch
// (tickgenau, Dauer-Websocket) passt nicht zu Nexus' Architektur (Supabase
// Edge Functions haben ein hartes Wall-Clock-Limit von 400s, kein
// Dauerbetrieb moeglich) und nicht zu Tobys tatsaechlichem Handelsstil
// (Stunden-Halteperiode statt Sekunden-Reaktion auf Buchbewegungen). Diese
// Kachel ist der dazu passende, bereits vorhandene Ausschnitt: die groesste
// Einzel-Wand je Seite und Boerse, alle 5 Minuten (orderbook_snapshots,
// collect-orderbook) -- kein Live-Heatmap, aber dieselbe Grundfrage
// ("liegt gerade viel Liquiditaet in der Naehe des Preises").

const INFO_TEXT = [
  "Was das ist: kumulierte Bid-/Ask-Tiefe, gemittelt über alle erfassten Börsen -- je Börse zunächst die Summe ALLER Level innerhalb von ±0.5% um den Mid-Preis, danach der Durchschnitt über Binance/Bybit/OKX. Alle 5 Minuten erfasst -- kein Live-Orderbuch/Bookmap, sondern ein periodischer Schnappschuss.",
  "Höhere Bid-Tiefe als Ask-Tiefe deutet auf mehr passive Kaufbereitschaft nahe dem Preis hin, und umgekehrt -- ein grobes Mass, keine Richtungsprognose.",
  "Einzelne Wände je Börse (per Antippen aufklappbar): die grösste Einzel-Order je Seite und Börse, statt der gemittelten Summe -- zeigt WO genau viel Liquidität konzentriert liegt (potenzieller Widerstand/Unterstützung) und ob sich die Börsen unterscheiden, während die kumulierte Zahl oben nur den Durchschnitt zeigt.",
  "Bekannte Grenzen: sowohl Wände als auch die kumulierte Tiefe können jederzeit zurückgezogen werden (Spoofing) -- ein Stand vor 5 Minuten ist keine Garantie, dass er jetzt noch so aussieht. Erscheint eine Zeile leer (—), fehlten Daten für diesen Erfassungszyklus.",
  "Kein Handelssignal -- eine Momentaufnahme passiver Liquidität, kein Hinweis auf zukünftige Preisbewegung.",
].join("\n\n");

function formatUsd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

const EXCHANGE_LABELS: Record<string, string> = {
  binance: "Binance",
  bybit: "Bybit",
  okx: "OKX",
};

function WallLine({
  label,
  side,
  price,
  usd,
  mid,
}: {
  label: string;
  side: "ask" | "bid";
  price: number | null;
  usd: number | null;
  mid: number | null;
}) {
  if (price === null || usd === null) {
    return (
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-faint">{label}</span>
        <span className="text-text-faint">—</span>
      </div>
    );
  }

  const distancePct = mid ? ((price - mid) / mid) * 100 : null;

  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className={side === "ask" ? "text-down" : "text-up"}>{label}</span>
      <span className="text-text-faint text-right">
        ${price.toLocaleString("de-CH", { maximumFractionDigits: 0 })}
        {distancePct !== null && (
          <span className="ml-1">
            ({distancePct >= 0 ? "+" : ""}
            {distancePct.toFixed(2)}%)
          </span>
        )}
        <span className="text-text font-medium ml-2">{formatUsd(usd)}</span>
      </span>
    </div>
  );
}

function average(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

// EINE kumulierte Zeile ueber ALLE Boersen gemittelt -- Nutzer-Korrektur
// 16.09.2026 ("kumuliert wird automatisch angezeigt, alle börsen wände
// zusammen den durchschnitt"): nicht drei Zeilen (eine je Boerse), sondern
// der Durchschnitt von bid_depth_usd/ask_depth_usd ueber alle Boersen mit
// gueltigem Wert. Dient zugleich als <summary> des <details>-Elements --
// Antippen klappt die Einzelwaende je Boerse auf (siehe ExchangeRow unten).
// bid_depth_usd/ask_depth_usd sind je Boerse die Summe ALLER Level im
// ±0.5%-Band (siehe collect-orderbook), dieselbe Rohbasis wie
// depth_imbalance.
function CumulativeDepthSummary({ walls }: { walls: OrderbookWallSnapshot[] }) {
  const avgBid = average(walls.map((w) => w.bid_depth_usd));
  const avgAsk = average(walls.map((w) => w.ask_depth_usd));
  return (
    <summary className="flex items-center justify-between gap-2 text-xs cursor-pointer select-none">
      <span className="text-text-muted">Kumulierte Tiefe (Ø aller Börsen, ±0.5%)</span>
      {avgBid === null || avgAsk === null ? (
        <span className="text-text-faint">—</span>
      ) : (
        <span className="text-text-faint">
          <span className="text-up">Bid {formatUsd(avgBid)}</span>
          <span className="mx-1.5">·</span>
          <span className="text-down">Ask {formatUsd(avgAsk)}</span>
        </span>
      )}
    </summary>
  );
}

function ExchangeRow({ wall }: { wall: OrderbookWallSnapshot }) {
  return (
    <div className="rounded-md border border-border/60 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-text">{EXCHANGE_LABELS[wall.exchange] ?? wall.exchange}</span>
        {wall.mid_price !== null && (
          <span className="text-text-faint">
            ${wall.mid_price.toLocaleString("de-CH", { maximumFractionDigits: 0 })}
          </span>
        )}
      </div>
      <WallLine label="Ask-Wand" side="ask" price={wall.ask_wall_price} usd={wall.ask_wall_usd} mid={wall.mid_price} />
      <WallLine label="Bid-Wand" side="bid" price={wall.bid_wall_price} usd={wall.bid_wall_usd} mid={wall.mid_price} />
    </div>
  );
}

export default function OrderbookWallCard({ walls }: { walls: OrderbookWallSnapshot[] }) {
  if (walls.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-5">
        <p className="text-sm font-medium text-text mb-2">Orderbuch-Wände</p>
        <p className="text-xs text-text-faint">Keine aktuellen Orderbuch-Daten.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-text">Orderbuch-Wände</p>
          <PanelInfo title="Orderbuch-Wände" content={INFO_TEXT} />
        </span>
        <StaleBadge iso={walls[0].timestamp_utc} />
      </div>

      <details>
        <CumulativeDepthSummary walls={walls} />
        <div className="mt-2 space-y-2 pt-2 border-t border-border/60">
          <p className="text-[11px] text-text-faint">Einzelne Wände je Börse (größte Order pro Seite):</p>
          {walls.map((wall) => (
            <ExchangeRow key={wall.exchange} wall={wall} />
          ))}
        </div>
      </details>
    </div>
  );
}
