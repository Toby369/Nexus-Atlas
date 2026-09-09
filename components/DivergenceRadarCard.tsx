import type {
  DivergenceRadarResult,
  LiquidationCorroboration,
  WallPersistenceRow,
} from "@/lib/divergenceRadarContext";
import type { DivergenceStatus, SpotPressureVsPriceDivergence } from "@/lib/divergenceRadar";
import PanelInfo from "@/components/PanelInfo";

// Divergenz-Radar (05.09.2026) -- Antwort auf die Recherche "bei welchen
// Paaren koennen Divergenzen entstehen": buendelt die technisch
// umsetzbaren Luecken aus dieser Recherche an einer Stelle, statt sie auf
// sechs verschiedene Kacheln zu verteilen. Reiner Server-Component-Render,
// Berechnung passiert bereits in lib/divergenceRadarContext.ts.

const INFO_TEXT = [
  "Was das ist: vergleicht Paare bereits vorhandener, unabhaengiger Nexus-Kennzahlen direkt gegeneinander -- Uebereinstimmung staerkt eine Aussage, Divergenz ist informativ (siehe \"Engine Divergence\" zwischen Gesamteinschaetzung und Marktphase als aeltestes Beispiel dieses Prinzips).",
  "WICHTIG: jedes Paar hier ist ein plausibles, regelbasiertes Muster -- KEINES davon wurde gegen echte Preis-Outcomes gebacktestet (anders als z. B. die 1H+4H+1D-Struktur-Uebereinstimmung, die als einziges Nexus-Muster eine echte, gemessene Signalstaerke hat). \"Vorhanden\" heisst hier nicht \"belegt wirksam\".",
  "Spot Pressure vs. Preis (Absorption): vergleicht Taker-Kauf/Verkaufsdruck (letzte 60 Min., Binance Spot) direkt gegen die Preisbewegung im selben Fenster. Dominiert Taker-SELL, der Preis steigt aber trotzdem, gilt das als \"Absorption bullisch\" -- die Verkaufsseite wird offenbar von passiven Kaeufern aufgefangen. Umgekehrt \"Absorption bearisch\" bei dominantem Taker-BUY und trotzdem fallendem Preis. Auch hier: plausibles Muster, kein Backtest.",
  "On-Chain vs. Preis (SOPR): rein deskriptiv -- ein separater multivariater Backtest dieser Session fand On-Chain-Kennzahlen NICHT hilfreich als eigenstaendigen Preis-Praediktor. Diese Zeile ist eine Beobachtungshilfe, kein geprueftes Signal.",
  "Wand-Persistenz und Liquidations-Korroboration sind reine Beobachtungen (haelt eine Orderbuch-Wand, gab es kuerzlich eine echte Liquidation nahe einem geschaetzten Cluster) -- kein Backtest, keine Trefferquote.",
  "TradingView-Signal vs. Gesamteinschaetzung: die Richtung wird aus dem Namen des Alert-Typs abgeleitet (z. B. \"..._BULLISH\", \"..._BEARISH\", oder bei Liquidity-Sweep/VWAP-Stretch aus der dokumentierten Umkehr-Logik) -- kein Raten, aber auch kein vom Pine-Script selbst mitgeschicktes Feld. Zeigt \"Nicht vergleichbar\", solange kein frisches Signal (24h) vorliegt.",
].join("\n\n");

const STATUS_LABELS: Record<DivergenceStatus, string> = {
  AGREEMENT: "Übereinstimmung",
  DIVERGENCE: "Divergenz",
  NOT_COMPARABLE: "Nicht vergleichbar",
};

const STATUS_STYLES: Record<DivergenceStatus, string> = {
  AGREEMENT: "border-up/40 bg-up/10 text-up",
  DIVERGENCE: "border-down/40 bg-down/10 text-down",
  NOT_COMPARABLE: "border-border text-text-faint",
};

function StatusBadge({ status }: { status: DivergenceStatus }) {
  return (
    <span className={`px-2 py-0.5 text-[11px] rounded-md border font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function PairRow({ label, status }: { label: string; status: DivergenceStatus }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-text-muted">{label}</span>
      <StatusBadge status={status} />
    </div>
  );
}

const ONCHAIN_LABELS: Record<DivergenceRadarResult["onchainVsPrice"], string | null> = {
  PRICE_HIGH_SOPR_LOSS: "Preis nahe 30T-Hoch, SOPR < 1 (Verluste realisiert)",
  PRICE_LOW_SOPR_PROFIT: "Preis nahe 30T-Tief, SOPR ≥ 1 (kein Kapitulations-Verkauf)",
  NOT_COMPARABLE: null,
};

const SPOT_VS_PRICE_LABELS: Record<SpotPressureVsPriceDivergence, string> = {
  ABSORPTION_BULLISH: "Absorption bullisch (Taker-Sell dominiert, Preis steigt)",
  ABSORPTION_BEARISH: "Absorption bearisch (Taker-Buy dominiert, Preis fällt)",
  AGREEMENT: "Übereinstimmung (Taker-Richtung folgt dem Preis)",
  NOT_COMPARABLE: "Nicht vergleichbar",
};

const SPOT_VS_PRICE_STYLES: Record<SpotPressureVsPriceDivergence, string> = {
  ABSORPTION_BULLISH: "border-up/40 bg-up/10 text-up",
  ABSORPTION_BEARISH: "border-down/40 bg-down/10 text-down",
  AGREEMENT: "border-border text-text-muted",
  NOT_COMPARABLE: "border-border text-text-faint",
};

function SpotPressureVsPriceRow({ status }: { status: SpotPressureVsPriceDivergence }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-text-muted">Spot Pressure vs. Preis</span>
      <span
        className={`px-2 py-0.5 text-[11px] rounded-md border font-medium ${SPOT_VS_PRICE_STYLES[status]}`}
      >
        {SPOT_VS_PRICE_LABELS[status]}
      </span>
    </div>
  );
}

const WALL_LABELS: Record<WallPersistenceRow["bidWallPersistence"], string> = {
  NEU: "neu",
  GEHALTEN: "hält",
  VERSCHWUNDEN: "verschwunden",
  KEINE_DATEN: "—",
};

const EXCHANGE_LABELS: Record<string, string> = { binance: "Binance", bybit: "Bybit", okx: "OKX" };

function WallPersistenceLine({ row }: { row: WallPersistenceRow }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-faint">{EXCHANGE_LABELS[row.exchange] ?? row.exchange}</span>
      <span className="text-text-muted">
        Bid {WALL_LABELS[row.bidWallPersistence]} · Ask {WALL_LABELS[row.askWallPersistence]}
      </span>
    </div>
  );
}

function CorroborationLine({ item }: { item: LiquidationCorroboration }) {
  return (
    <div className="text-xs text-text-muted">
      {item.side === "long" ? "Long" : "Short"}-Cluster $
      {item.clusterPrice.toLocaleString("de-CH", { maximumFractionDigits: 0 })}: reale Liquidation bei $
      {item.liquidationPrice.toLocaleString("de-CH", { maximumFractionDigits: 0 })}
    </div>
  );
}

export default function DivergenceRadarCard({ radar }: { radar: DivergenceRadarResult }) {
  const onchainLabel = ONCHAIN_LABELS[radar.onchainVsPrice];

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <span className="flex items-center gap-1.5">
        <p className="text-sm font-medium text-text">Divergenz-Radar</p>
        <PanelInfo title="Divergenz-Radar" content={INFO_TEXT} />
      </span>

      <div className="space-y-1.5">
        <PairRow label="Options-Skew vs. Sentiment" status={radar.optionsVsSentiment} />
        <PairRow label="Spot-Flow vs. Futures-Orderflow (CVD)" status={radar.spotVsFutures} />
        <SpotPressureVsPriceRow status={radar.spotPressureVsPrice} />
        <PairRow label="Log-Preiskanal vs. Momentum" status={radar.cycleVsMomentum} />
        <PairRow label="Handelslage-KI vs. Gesamteinschätzung" status={radar.handelslageVsState} />
        <PairRow label="TradingView-Signal vs. Gesamteinschätzung" status={radar.tradingViewVsState} />
      </div>

      <div className="pt-2 border-t border-border space-y-1">
        <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">On-Chain vs. Preis</p>
        {onchainLabel ? (
          <p className="text-xs text-text-muted">{onchainLabel}</p>
        ) : (
          <p className="text-xs text-text-faint">Keine auffällige Divergenz.</p>
        )}
      </div>

      {radar.wallPersistence.length > 0 && (
        <div className="pt-2 border-t border-border space-y-1">
          <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Orderbuch-Wand-Persistenz</p>
          {radar.wallPersistence.map((row) => (
            <WallPersistenceLine key={row.exchange} row={row} />
          ))}
        </div>
      )}

      {radar.liquidationCorroborations.length > 0 && (
        <div className="pt-2 border-t border-border space-y-1">
          <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">
            Liquidations-Modell bestätigt (letzte 6h)
          </p>
          {radar.liquidationCorroborations.map((item, i) => (
            <CorroborationLine key={i} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
