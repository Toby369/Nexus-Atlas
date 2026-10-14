import type { VolatilitySnapshot } from "@/lib/volatilityContext";
import type { Assessment, ExpectedRange, SkewDirection, VolTone } from "@/lib/volatility";
import PanelInfo from "@/components/PanelInfo";

// Volatilitaets-Lage: Server-Component-Render, Daten aus
// lib/volatilityContext.ts (Deribit direkt + eigene 1h-Kerzen).

const INFO = [
  "Ersatz für die Gamma-Lage aus Orderflow-Setups (GEX): Für BTC gibt es keine verlässliche, frei verfügbare Gamma-Messung. Diese Kachel beantwortet dieselbe Frage indirekt: Wird gerade viel oder wenig Bewegung erwartet, und passt das zur tatsächlichen Bewegung?",
  "DVOL: Volatilitätsindex von Deribit, die vom Optionsmarkt erwartete Schwankung der nächsten 30 Tage (annualisiert, %). DVOL ÷ √365 ≈ typische Tagesbewegung (1 Sigma, also an etwa 2 von 3 Tagen kleiner). Das Perzentil vergleicht mit den Tagesschlüssen des letzten Jahres.",
  "Implizit vs. realisiert: 30-Tage-ATM-IV (Optionen am Geld, aus den beiden Verfällen um 30 Tage auf genau 30 Tage interpoliert, Methode wie beim VIX) minus tatsächliche Schwankung der letzten 30 Tage aus den Binance-1h-Kerzen. Deutlich positiv = Optionen teuer, der Markt erwartet mehr Bewegung als zuletzt. Negativ = der Kurs bewegt sich mehr als eingepreist.",
  "Skew: Volatilität eines Puts 10 % unter minus eines Calls 10 % über dem Forward, gleicher Verfall. Positiv = Absicherung nach unten gefragt, negativ = Spekulation nach oben.",
  "Erwartete Spanne: Bereich, in dem der Kurs laut Optionspreisen (DVOL) nach 1, 7 bzw. 30 Tagen mit rund 68 % Wahrscheinlichkeit liegt (1 Sigma). In etwa jedem dritten Fall landet er ausserhalb. Breite wächst mit der Wurzel der Zeit. Der Strich markiert den aktuellen Kurs.",
  "Pfeil: Stimmung im Optionsmarkt aus dem Skew. Grün ↑ = Calls teurer (Markt setzt eher auf steigende Kurse), rot ↓ = Puts teurer (Markt sichert sich gegen fallende Kurse ab), grau → = ausgeglichen. Das zeigt, wohin das Geld im Optionsmarkt gerade fliesst – keine Kursprognose. Starke Angst (sehr teure Puts) fällt historisch oft mit Tiefs zusammen, also auch als Gegenindikator lesbar.",
  "Alle Einordnungen sind gängige Faustregeln, nicht im Backtest geprüft. Kein Handelssignal.",
].join("\n\n");

const TONE_STYLES: Record<VolTone, string> = {
  calm: "border-border text-text-muted",
  watch: "border-accent/40 bg-accent/10 text-accent",
  risk: "border-down/40 bg-down/10 text-down",
};

function fmt(value: number | null, digits = 1, suffix = ""): string {
  if (value === null) return "–";
  return `${value.toLocaleString("de-CH", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
}

function signed(value: number | null, digits = 1): string {
  if (value === null) return "–";
  return `${value >= 0 ? "+" : ""}${fmt(value, digits)}`;
}

const ARROWS: Record<SkewDirection, { symbol: string; className: string; label: string }> = {
  up: { symbol: "↑", className: "text-up", label: "Optionsmarkt eher bullisch" },
  down: { symbol: "↓", className: "text-down", label: "Optionsmarkt eher bärisch" },
  flat: { symbol: "→", className: "text-text-faint", label: "Optionsmarkt ausgeglichen" },
};

function DirectionArrow({ direction, size = "text-base" }: { direction: SkewDirection; size?: string }) {
  const arrow = ARROWS[direction];
  return (
    <span className={`${arrow.className} ${size} font-semibold leading-none`} title={arrow.label} aria-label={arrow.label}>
      {arrow.symbol}
    </span>
  );
}

function usd(value: number): string {
  return `$${value.toLocaleString("de-CH", { maximumFractionDigits: 0 })}`;
}

// Horizontale Spannen-Balken auf einer gemeinsamen Skala (der breitesten
// Spanne), damit die Zeithorizonte direkt vergleichbar sind.
function ExpectedRanges({ ranges, price }: { ranges: ExpectedRange[]; price: number }) {
  const widest = ranges.reduce((a, b) => (b.high - b.low > a.high - a.low ? b : a));
  const pad = (widest.high - widest.low) * 0.04;
  const min = widest.low - pad;
  const span = widest.high + pad - min;
  const pos = (v: number) => ((v - min) / span) * 100;
  const label = (d: number) => (d === 1 ? "1 Tag" : `${d} Tage`);
  return (
    <div className="space-y-2">
      {ranges.map((r) => (
        <div
          key={r.days}
          className="space-y-1"
          title={`${label(r.days)}: ${usd(r.low)} – ${usd(r.high)} (± ${fmt(r.movePct, 1)} %), rund 68 % Wahrscheinlichkeit`}
        >
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-text-faint">{label(r.days)}</span>
            <span className="text-right">
              <span className="text-text font-medium">
                {usd(r.low)} – {usd(r.high)}
              </span>
              <span className="text-text-faint"> · ± {fmt(r.movePct, 1)} %</span>
            </span>
          </div>
          <div className="relative h-2 rounded-full bg-border/40">
            <div
              className="absolute inset-y-0 rounded-full bg-accent/50"
              style={{ left: `${pos(r.low)}%`, width: `${pos(r.high) - pos(r.low)}%` }}
            />
            <div
              className="absolute -inset-y-0.5 w-0.5 rounded-full bg-text ring-2 ring-surface"
              style={{ left: `calc(${pos(price)}% - 1px)` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Badge({ assessment }: { assessment: Assessment | null }) {
  if (!assessment) return null;
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] leading-tight ${TONE_STYLES[assessment.tone]}`}>
      {assessment.label}
    </span>
  );
}

function Row({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-text-faint">{label}</span>
      <span className="text-right">
        <span className="text-text font-medium">{value}</span>
        {detail && <span className="text-text-faint"> · {detail}</span>}
      </span>
    </div>
  );
}

export default function VolatilityCard({ data }: { data: VolatilitySnapshot }) {
  const o = data.options30d;
  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-4">
      <span className="flex items-center gap-1.5">
        <p className="text-sm font-medium text-text">Volatilitäts-Lage</p>
        <PanelInfo title="Volatilitäts-Lage" content={INFO} />
        {data.skewAssessment && <DirectionArrow direction={data.skewAssessment.direction} size="text-lg" />}
      </span>

      {!data.deribitAvailable && (
        <p className="text-xs text-text-faint">
          Deribit gerade nicht erreichbar – DVOL, implizite Volatilität und Skew fehlen. Realisierte Volatilität unten
          aus den eigenen Kerzen.
        </p>
      )}

      {data.dvol !== null && (
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-2xl font-semibold text-text">{fmt(data.dvol)}</span>
            <span className="text-xs text-text-faint">DVOL · 7 Tage {signed(data.dvolChange7d)}</span>
          </div>
          <Row
            label="Einordnung 1 Jahr"
            value={data.dvolPercentile1y !== null ? `${fmt(data.dvolPercentile1y, 0)}. Perzentil` : "–"}
          />
          <Badge assessment={data.dvolAssessment} />
        </div>
      )}

      {data.expectedRanges.length > 0 && data.price !== null && (
        <div className="space-y-1.5 pt-3 border-t border-border">
          <p className="text-xs font-medium text-text">
            Erwartete Spanne <span className="text-text-faint font-normal">(68 %, aus DVOL)</span>
          </p>
          <ExpectedRanges ranges={data.expectedRanges} price={data.price} />
        </div>
      )}

      <div className="space-y-1.5 pt-3 border-t border-border">
        <p className="text-xs font-medium text-text">Implizit vs. realisiert</p>
        <Row
          label={o?.interpolated ? "ATM-IV 30 Tage" : o ? `ATM-IV ${o.expiries[0]} (${fmt(o.daysToExpiry, 0)} Tage)` : "ATM-IV 30 Tage"}
          value={fmt(o?.atmIv ?? null, 1, " %")}
        />
        <Row label="Realisiert 30 Tage" value={fmt(data.realizedVol30d, 1, " %")} detail={`7 Tage ${fmt(data.realizedVol7d, 1, " %")}`} />
        <Row label="Differenz" value={`${signed(data.ivRvSpread)} Pkt.`} />
        <Badge assessment={data.ivRvAssessment} />
      </div>

      {o && (
        <div className="space-y-1.5 pt-3 border-t border-border">
          <p className="text-xs font-medium text-text">Skew (Put −10 % vs. Call +10 %)</p>
          <Row
            label={o.interpolated ? `30 Tage (${o.expiries.join(" / ")})` : `Verfall ${o.expiries[0]}`}
            value={o.skew !== null ? `${signed(o.skew)} Pkt.` : "–"}
          />
          <div className="flex items-center gap-2">
            {data.skewAssessment && <DirectionArrow direction={data.skewAssessment.direction} />}
            <Badge assessment={data.skewAssessment} />
          </div>
        </div>
      )}

      <p className="text-[11px] text-text-faint">
        Quelle: Deribit (DVOL, Optionen), Binance-1h-Kerzen. Stand{" "}
        {new Date(data.fetchedAt).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" })}.
      </p>
    </div>
  );
}
