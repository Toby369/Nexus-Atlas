import type { RegimeScoreResult, RegimeScoreRow, RegimeScoreTier } from "@/lib/regimeScoreContext";
import PanelInfo from "@/components/PanelInfo";

// Gesamteinschätzung-Score (12.09.2026) -- separates, eigenständig
// validiertes Regime-Modell, siehe docs/research/
// GESAMTEINSCHAETZUNG-SCORE-PROTOCOL_2026-09-12.md +
// GESAMTEINSCHAETZUNG-SCORE-PHASE1-RESULTS_2026-09-12.md. Bewusst als
// EIGENE Kachel neben dem Setup-Score, niemals vermischt (institutionelle
// Trennung Regime- vs. Trade-Signal-Scoring, siehe NEXUS-STRUKTUR-KONZEPT
// Abschnitt 5) -- eigene Zielgrösse (ATR-skalierte 4h-Bewegung statt
// Hebel-Setup-Trefferquote), eigener BH-FDR-Pool, eigene WOE-Gewichte.
//
// WICHTIG -- anders als der Setup-Score noch NICHT vollständig validiert:
// erst 20 von 39 vorregistrierten Kandidatensignalen getestet. Deshalb
// deutlich als "in Aufbau" gekennzeichnet, analog zum "wird neu validiert"-
// Hinweis bei der Gesamteinschätzung (MarketStateCard).

const TIER_STYLES: Record<RegimeScoreTier, string> = {
  Hoch: "border-up/40 bg-up/10 text-up",
  Mittel: "border-border bg-surface-raised text-text-muted",
  Niedrig: "border-down/40 bg-down/10 text-down",
};

const INFO_TEXT = [
  "Was das ist: ein von Setup-Score UNABHÄNGIGES Regime-Modell -- schätzt, ob BTC in den nächsten 4 Stunden um mindestens 1×ATR(14) nach oben (UP) oder unten (DOWN) ausschlägt, statt eines konkreten Hebel-Setups. Eigene Zielgrösse, eigene Statistik-Korrektur, eigene Gewichte -- niemals mit dem Setup-Score vermischt.",
  "Status -- in Aufbau: bisher wurden 20 von 39 vorregistrierten Kandidatensignalen getestet (14 davon statistisch bestätigt). Der hier gezeigte Score kombiniert die bislang bestätigten Faktoren per Weight-of-Evidence und wurde out-of-sample geprüft -- ist aber noch nicht abgeschlossen validiert wie der Setup-Score.",
  "So liest du das: UP-Score = Trend-Konsens (wie viele von 6 Trend-Signalen zeigen aufwärts) + Orderflow-Stärke (CVD-Z-Score) + Bollinger-Überverkauft-Signal. DOWN-Score = Trend-Konsens (abwärts) + Orderflow-Stärke + Momentum-Faktor. \"Hoch\" bedeutet oberstes Drittel aller historischen 4h-Fenster (~40-47% Trefferquote, Basisrate ~33%), \"Niedrig\" das unterste Drittel.",
  "Kein Handelssignal, keine Erfolgsgarantie -- und ausdrücklich kein Ersatz für den Setup-Score.",
].join("\n\n");

function FactorLine({ label, active }: { label: string; active: boolean | null }) {
  if (active === null) return null;
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-text-faint">{label}</span>
      <span className={active ? "text-text" : "text-text-faint"}>{active ? "aktiv" : "—"}</span>
    </div>
  );
}

function ScoreRow({ row, label }: { row: RegimeScoreRow | null; label: string }) {
  if (!row) {
    return (
      <div className="rounded-lg border border-border bg-surface-raised p-3">
        <p className="text-xs font-medium text-text-muted mb-1">{label}</p>
        <p className="text-xs text-text-faint">Daten unvollständig.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-text">{label}</p>
        <span className={`px-2 py-0.5 text-[11px] rounded-md border font-semibold ${TIER_STYLES[row.tier]}`}>
          {row.tier} · {row.probability.toFixed(1)}%
        </span>
      </div>
      <div className="space-y-1 pt-1 border-t border-border/60">
        <FactorLine label={`Trend-Konsens (${row.trendKonsens}/6)`} active={row.trendKonsens >= 3} />
        <FactorLine label="Orderflow-Stärke (CVD-Z)" active={row.cvdZActive} />
        <FactorLine label="Momentum-Faktor" active={row.momentumActive} />
        <FactorLine label="Bollinger überverkauft" active={row.bollingerPctbActive} />
      </div>
    </div>
  );
}

export default function RegimeScoreCard({ score }: { score: RegimeScoreResult }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <span className="flex items-center gap-1.5 flex-wrap">
        <p className="text-sm font-medium text-text">Gesamteinschätzung-Score</p>
        <span className="text-[10px] text-text-faint border border-border rounded px-1">
          in Aufbau · 20/39 Signale getestet
        </span>
        <PanelInfo title="Gesamteinschätzung-Score" content={INFO_TEXT} />
      </span>

      <p className="text-[11px] text-text-faint">
        4h-Horizont · ±1×ATR(14) · unabhängig vom Setup-Score
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <ScoreRow row={score.up} label="UP" />
        <ScoreRow row={score.down} label="DOWN" />
      </div>
    </div>
  );
}
