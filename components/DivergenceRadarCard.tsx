import type {
  DivergenceRadarResult,
  LiquidationCorroboration,
  WallPersistenceRow,
} from "@/lib/divergenceRadarContext";
import type {
  DivergenceStatus,
  SpotPressureVsPriceDivergence,
  SpotPressureVsOrderbookDivergence,
  RsiDivergenceVsTrendResult,
} from "@/lib/divergenceRadar";
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
  "Spot Pressure vs. Orderbuch: vergleicht denselben Taker-Kauf/Verkaufsdruck direkt gegen die Orderbuch-Tiefe (Bid- vs. Ask-Seite, ueber alle Boersen und dasselbe 60-Minuten-Fenster gemittelt) -- unabhaengig davon, wie sich der Preis bereits bewegt hat. Dominiert Taker-BUY, aber das Orderbuch hat per Saldo mehr Tiefe auf der Ask-Seite, gilt das als \"Widerstand voraus\" -- der Kaufdruck trifft auf mehr Verkaufsbereitschaft, als er bisher bewegt hat. Umgekehrt \"Unterstuetzung voraus\" bei dominantem Taker-SELL und mehr Bid-Tiefe. Ergaenzt die Preis-Zeile oben: die beantwortet nur, ob der Preis SCHON gegen den Flow gelaufen ist, diese hier, ob im Buch bereits Widerstand/Unterstuetzung wartet, bevor sich das im Preis zeigt.",
  "On-Chain vs. Preis (SOPR): rein deskriptiv -- ein separater multivariater Backtest dieser Session fand On-Chain-Kennzahlen NICHT hilfreich als eigenstaendigen Preis-Praediktor. Diese Zeile ist eine Beobachtungshilfe, kein geprueftes Signal.",
  "Wand-Persistenz und Liquidations-Korroboration sind reine Beobachtungen (haelt eine Orderbuch-Wand, gab es kuerzlich eine echte Liquidation nahe einem geschaetzten Cluster) -- kein Backtest, keine Trefferquote.",
  "TradingView-Signal vs. Gesamteinschaetzung: die Richtung wird aus dem Namen des Alert-Typs abgeleitet (z. B. \"..._BULLISH\", \"..._BEARISH\", oder bei Liquidity-Sweep/VWAP-Stretch aus der dokumentierten Umkehr-Logik) -- kein Raten, aber auch kein vom Pine-Script selbst mitgeschicktes Feld. Zeigt \"Nicht vergleichbar\", solange kein frisches Signal (24h) vorliegt.",
  "RSI/MACD-Divergenz vs. Trendregime: die klassische Divergenz-Lesart (Preis macht neues Extremum, Oszillator bestaetigt nicht) gilt selbst in der Trading-Literatur nur dann als aussagekraeftig, wenn sie NICHT gegen einen intakten Trend laeuft -- in einem starken Trend kann der Oszillator lange unbestaetigt bleiben, ohne dass die erwartete Umkehr eintritt. \"Gegen intakten Trend\" heisst: eine bullische Divergenz waehrend trend_regime baerisch ist (oder umgekehrt) -- niedrigere Ueberzeugungskraft. \"Ohne Gegentrend\" heisst: kein klarer Trend (Range) oder die Richtung passt bereits -- die Divergenz ist glaubwuerdiger. Nutzt dasselbe frische (24h) TradingView-Signal wie oben, aber ausschliesslich die 4 Divergenz-Signaltypen.",
].join("\n\n");

const STATUS_LABELS: Record<DivergenceStatus, string> = {
  AGREEMENT: "Übereinstimmung",
  DIVERGENCE: "Divergenz",
  NOT_COMPARABLE: "Nicht vergleichbar",
};

// 13.09.2026 -- bewusst NICHT mehr up/down (gruen/rot): AGREEMENT/DIVERGENCE
// sagt nur, ob zwei Kennzahlen sich einig sind, nicht ob diese Einigkeit
// bullisch oder baerisch ist (eine Uebereinstimmung zweier baerischer
// Signale sah bisher trotzdem gruen aus). Nexus-weite Konvention
// gruen=bullisch/rot=baerisch/grau=keine Daten gilt nur fuer Zeilen mit
// echter Richtung (siehe SPOT_VS_PRICE_STYLES/SPOT_VS_ORDERBOOK_STYLES
// unten). Hier: grau = unauffaellig/Konsens, accent (gold) = Divergenz,
// also der eigentlich bemerkenswerte Zustand.
const STATUS_STYLES: Record<DivergenceStatus, string> = {
  AGREEMENT: "border-border text-text-muted",
  DIVERGENCE: "border-accent/40 bg-accent/10 text-accent",
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

const SPOT_VS_ORDERBOOK_LABELS: Record<SpotPressureVsOrderbookDivergence, string> = {
  RESISTANCE_AHEAD: "Widerstand voraus (Taker-Buy dominiert, Orderbuch lehnt zur Ask-Seite)",
  SUPPORT_AHEAD: "Unterstützung voraus (Taker-Sell dominiert, Orderbuch lehnt zur Bid-Seite)",
  AGREEMENT: "Übereinstimmung (Orderbuch folgt der Taker-Richtung)",
  NOT_COMPARABLE: "Nicht vergleichbar",
};

const SPOT_VS_ORDERBOOK_STYLES: Record<SpotPressureVsOrderbookDivergence, string> = {
  RESISTANCE_AHEAD: "border-down/40 bg-down/10 text-down",
  SUPPORT_AHEAD: "border-up/40 bg-up/10 text-up",
  AGREEMENT: "border-border text-text-muted",
  NOT_COMPARABLE: "border-border text-text-faint",
};

function SpotPressureVsOrderbookRow({ status }: { status: SpotPressureVsOrderbookDivergence }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-text-muted">Spot Pressure vs. Orderbuch</span>
      <span
        className={`px-2 py-0.5 text-[11px] rounded-md border font-medium ${SPOT_VS_ORDERBOOK_STYLES[status]}`}
      >
        {SPOT_VS_ORDERBOOK_LABELS[status]}
      </span>
    </div>
  );
}

const RSI_DIVERGENCE_LABELS: Record<RsiDivergenceVsTrendResult, string> = {
  GEGEN_INTAKTEN_TREND: "Gegen intakten Trend (geringere Überzeugungskraft)",
  OHNE_GEGENTREND: "Ohne Gegentrend (kein klarer Trend oder Richtung passt)",
  NOT_COMPARABLE: "Nicht vergleichbar",
};

// Gleicher Grund wie bei STATUS_STYLES: "gegen intakten Trend" heisst
// geringere Ueberzeugungskraft, nicht baerisch -- die Divergenz selbst kann
// bullisch oder baerisch sein.
const RSI_DIVERGENCE_STYLES: Record<RsiDivergenceVsTrendResult, string> = {
  GEGEN_INTAKTEN_TREND: "border-accent/40 bg-accent/10 text-accent",
  OHNE_GEGENTREND: "border-border text-text-muted",
  NOT_COMPARABLE: "border-border text-text-faint",
};

function RsiDivergenceVsTrendRow({ status }: { status: RsiDivergenceVsTrendResult }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-text-muted">RSI/MACD-Divergenz vs. Trendregime</span>
      <span
        className={`px-2 py-0.5 text-[11px] rounded-md border font-medium ${RSI_DIVERGENCE_STYLES[status]}`}
      >
        {RSI_DIVERGENCE_LABELS[status]}
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
        <SpotPressureVsOrderbookRow status={radar.spotPressureVsOrderbook} />
        <PairRow label="Log-Preiskanal vs. Momentum" status={radar.cycleVsMomentum} />
        <PairRow label="Handelslage-KI vs. Gesamteinschätzung" status={radar.handelslageVsState} />
        <PairRow label="TradingView-Signal vs. Gesamteinschätzung" status={radar.tradingViewVsState} />
        <RsiDivergenceVsTrendRow status={radar.rsiDivergenceVsTrend} />
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
