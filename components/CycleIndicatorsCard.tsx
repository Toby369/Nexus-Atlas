import type { CycleIndicators } from "@/lib/cycleIndicatorsContext";
import PanelInfo from "@/components/PanelInfo";

// Umsetzungsplan Phase 5 (05.09.2026): Pi-Cycle-Top + Log-Preiskanal.
// Server-Component-Render (keine Interaktion noetig) -- die Berechnung
// passiert bereits serverseitig in lib/cycleIndicatorsContext.ts.

const PI_CYCLE_INFO = [
  "Was das ist: vergleicht den 111-Tage- mit dem verdoppelten 350-Tage-gleitenden-Durchschnitt der taeglichen Schlusskurse. Kreuzt der kurze von unten ueber den langen, fiel das historisch (2013, 2017, 2021) auf wenige Tage genau mit grossen BTC-Zyklus-Hochs zusammen.",
  "Reines Muster aus der Vergangenheit, keine Garantie fuer die Zukunft -- kein Handelssignal, kein Kursziel.",
].join("\n\n");

const LOG_CHANNEL_INFO = [
  "Was das ist: eine log-Regression ueber die verfuegbare Kerzenhistorie, aehnlich dem bekannten 'Rainbow Chart'-Konzept.",
  "WICHTIG: der echte Rainbow-Chart braucht eine Regression ueber den VOLLEN Marktzyklus seit 2013 (mehrere vollstaendige Boom-Bust-Zyklen). Nexus hat aktuell nur ~2 Jahre Kerzenhistorie -- das hier ist bestenfalls der AKTUELLE Trendkanal dieser 2 Jahre, kein Ersatz fuer den langfristigen Rainbow-Chart. Die vollstaendige Version ist vorbereitet (btc_price_history_daily/CoinGecko), wartet aber auf einen kostenlosen CoinGecko-API-Key.",
  "Kein Handelssignal -- eine Orientierungshilfe, wo der Preis relativ zum eigenen kurzfristigen Trend steht.",
].join("\n\n");

function formatUsd(value: number): string {
  return `$${value.toLocaleString("de-CH", { maximumFractionDigits: 0 })}`;
}

export default function CycleIndicatorsCard({ data }: { data: CycleIndicators }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-4">
      <div className="space-y-2">
        <span className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-text">Pi-Cycle-Top</p>
          <PanelInfo title="Pi-Cycle-Top" content={PI_CYCLE_INFO} />
        </span>
        {!data.piCycleTop ? (
          <p className="text-xs text-text-faint">
            Nicht genug Historie (mindestens 350 Tage noetig, aktuell {data.daysOfHistory}).
          </p>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <span className="text-text-faint">111-Tage-MA:</span>
              <span className="text-text">{formatUsd(data.piCycleTop.ma111)}</span>
              <span className="text-text-faint">· 2×350-Tage-MA:</span>
              <span className="text-text">{formatUsd(data.piCycleTop.ma350x2)}</span>
            </div>
            <p className={`text-sm font-semibold ${data.piCycleTop.triggered ? "text-down" : "text-text-muted"}`}>
              {data.piCycleTop.ratioPct.toFixed(1)}%
              {data.piCycleTop.triggered
                ? " -- Kreuzung erreicht (historisches Top-Muster)"
                : " -- keine Kreuzung"}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2 pt-3 border-t border-border">
        <span className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-text">Log-Preiskanal</p>
          <PanelInfo title="Log-Preiskanal" content={LOG_CHANNEL_INFO} />
        </span>
        {!data.logPriceChannel ? (
          <p className="text-xs text-text-faint">Nicht genug Historie fuer eine Regression.</p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-text">{data.logPriceChannel.currentBandLabel}</p>
            <div className="space-y-0.5">
              {data.logPriceChannel.bands.map((b) => (
                <div key={b.label} className="flex items-center justify-between text-xs">
                  <span className={b.label === data.logPriceChannel!.currentBandLabel ? "text-text font-medium" : "text-text-faint"}>
                    {b.label}
                  </span>
                  <span className={b.label === data.logPriceChannel!.currentBandLabel ? "text-text font-medium" : "text-text-faint"}>
                    {formatUsd(b.priceAtNow)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
