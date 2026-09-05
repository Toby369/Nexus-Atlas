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
  "Was das ist: die groesste einzelne Order (\"Wand\") je Seite und Boerse im sichtbaren Orderbuch, alle 5 Minuten erfasst -- kein Live-Orderbuch/Bookmap, sondern ein periodischer Schnappschuss.",
  "Ask-Wand (oberhalb des Preises) markiert potenziellen Widerstand -- viel Verkaufsvolumen muesste erst abgearbeitet werden, damit der Preis durchlaeuft. Bid-Wand (unterhalb) markiert potenzielle Unterstuetzung, analog fuer Kaeufe.",
  "Bekannte Grenzen: Wände koennen jederzeit zurueckgezogen werden (Spoofing) -- eine Wand vor 5 Minuten ist keine Garantie, dass sie jetzt noch da ist. Erscheint eine Zeile leer (—), lag kein Level deutlich ueber dem Median der erfassten Tiefe.",
  "Kein Handelssignal -- eine Momentaufnahme passiver Liquiditaet, kein Hinweis auf zukuenftige Preisbewegung.",
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

      <div className="space-y-2">
        {walls.map((wall) => (
          <ExchangeRow key={wall.exchange} wall={wall} />
        ))}
      </div>
    </div>
  );
}
