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
  "Was das ist: zwei über alle erfassten Börsen gemittelte Kennzahlen. Kumulierte Tiefe: je Börse die Summe ALLER Level innerhalb von ±0.5% um den Mid-Preis, danach gemittelt über Binance/Bybit/OKX. Kumulierte Wand: die grösste Einzel-Order je Seite und Börse, ebenfalls gemittelt (Preis, Abstand zum Mid-Preis und Grösse). Alle 5 Minuten erfasst -- kein Live-Orderbuch/Bookmap, sondern ein periodischer Schnappschuss.",
  "Höhere Bid-Tiefe als Ask-Tiefe deutet auf mehr passive Kaufbereitschaft nahe dem Preis hin, und umgekehrt -- ein grobes Mass, keine Richtungsprognose.",
  "Die 'Kumulierte Wand' ist ein rechnerischer Durchschnitt, keine echte Einzel-Order -- sie existiert an keiner Börse tatsächlich so. Zeigt nur grob, wie gross und wie nah am Preis die auffälligsten Level typischerweise liegen.",
  "Einzelne Wände je Börse (per Antippen aufklappbar): dieselben Werte unaufbereitet je Börse -- zeigt, WO genau viel Liquidität konzentriert liegt (potenzieller Widerstand/Unterstützung) und ob sich die Börsen unterscheiden, statt sie im Durchschnitt zu verstecken.",
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

// ZWEI kumulierte Kennzahlen ueber ALLE Boersen gemittelt -- Nutzer-Wunsch
// 16.09.2026 ("kumuliert ... alle börsen zusammen den durchschnitt", dann
// "und jetzt noch die kumulierte wand"): Tiefe (Summe aller Level) UND Wand
// (groesste Einzel-Order) je gemittelt ueber Binance/Bybit/OKX statt einer
// Zeile je Boerse. Zusammen die <summary> des <details>-Elements -- Antippen
// (auf beide Zeilen) klappt die Einzelwaende je Boerse auf (ExchangeRow
// unten, dieselben Rohwerte ungemittelt). bid_depth_usd/ask_depth_usd sind
// je Boerse die Summe ALLER Level im ±0.5%-Band (siehe collect-orderbook),
// dieselbe Rohbasis wie depth_imbalance. Die gemittelte Wand (Preis+Groesse)
// ist ein rechnerischer Kennwert, keine an irgendeiner Boerse tatsaechlich
// existierende Einzel-Order -- siehe INFO_TEXT.
function CumulativeSummary({ walls }: { walls: OrderbookWallSnapshot[] }) {
  const avgBidDepth = average(walls.map((w) => w.bid_depth_usd));
  const avgAskDepth = average(walls.map((w) => w.ask_depth_usd));
  const avgMid = average(walls.map((w) => w.mid_price));
  const avgAskWallPrice = average(walls.map((w) => w.ask_wall_price));
  const avgAskWallUsd = average(walls.map((w) => w.ask_wall_usd));
  const avgBidWallPrice = average(walls.map((w) => w.bid_wall_price));
  const avgBidWallUsd = average(walls.map((w) => w.bid_wall_usd));

  return (
    <summary className="cursor-pointer select-none space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-text-muted">Kumulierte Tiefe (Ø aller Börsen, ±0.5%)</span>
        {avgBidDepth === null || avgAskDepth === null ? (
          <span className="text-text-faint">—</span>
        ) : (
          <span className="text-text-faint">
            <span className="text-up">Bid {formatUsd(avgBidDepth)}</span>
            <span className="mx-1.5">·</span>
            <span className="text-down">Ask {formatUsd(avgAskDepth)}</span>
          </span>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-[11px] text-text-faint">Kumulierte Wand (Ø aller Börsen)</p>
        <WallLine label="Ask-Wand" side="ask" price={avgAskWallPrice} usd={avgAskWallUsd} mid={avgMid} />
        <WallLine label="Bid-Wand" side="bid" price={avgBidWallPrice} usd={avgBidWallUsd} mid={avgMid} />
      </div>
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
        <CumulativeSummary walls={walls} />
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
