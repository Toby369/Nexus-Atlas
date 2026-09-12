import type {
  ConfluenceScoreResult,
  ConfluenceScoreRow,
  ConfluenceScoreTier,
  ConfluenceSignalDetail,
  TrendSignalState,
} from "@/lib/confluenceScoreContext";
import PanelInfo from "@/components/PanelInfo";

// Setup-Score (12.09.2026, umbenannt von "Confluence-Score" am selben Tag --
// siehe docs/research/NEXUS-STRUKTUR-KONZEPT_2026-09-12.md Abschnitt 4) --
// die Setup-Parameter stehen bewusst im Namen, damit die Bindung an genau
// dieses eine, getestete Setup nie mit einer allgemeinen Marktbewertung
// verwechselt wird (siehe Gesamteinschaetzung/Kurznotiz daneben, die noch
// nicht nach demselben Massstab validiert ist). Zeigt den vierfach
// out-of-sample validierten Weight-of-Evidence-Score aus dem
// Confluence-Score-Protokoll (docs/research/CONFLUENCE-SCORE-PROTOCOL_2026-09-11.md +
// CONFLUENCE-SCORE-PHASE3-RESULTS_2026-09-11.md Abschnitt 6c). Zeigt bewusst
// nur den VORAB-Score (4 Leading-Faktoren: Trend-Konfirmation, Fear & Greed,
// Makro-Regime, Orderbuch-Imbalance) -- der Momentum-Faktor ist ein
// Confirming-Signal und erst bekannt, sobald ein laufendes Setup die
// 0,25%-Marge erreicht, also fuer eine "wie sieht's gerade aus"-Kachel ohne
// aktiven Trade nicht verfuegbar (siehe research_confluence_score_live()).
//
// Farbe folgt der STUFE (Hoch/Mittel/Niedrig), nicht der Richtung -- LONG
// und SHORT stehen bereits als Zeilen-Label da, eine richtungsbasierte
// Einfaerbung wuerde faelschlich "Preis steigt/faellt" suggerieren statt
// "dieses Setup ist aktuell gut/schlecht".

const TIER_STYLES: Record<ConfluenceScoreTier, string> = {
  Hoch: "border-up/40 bg-up/10 text-up",
  Mittel: "border-border bg-surface-raised text-text-muted",
  Niedrig: "border-down/40 bg-down/10 text-down",
};

const BREAKEVEN_PCT = 22.2;

const INFO_TEXT = [
  "Was das ist: kombinierter Score aus 5 quasi-unabhaengigen Signal-Faktoren (Weight-of-Evidence, dieselbe Mathematik wie klassische Kredit-Scorecards), dreifach out-of-sample validiert an 4 Jahren BTCUSDT-Historie. Ersetzt keine Einzelsignal-Kacheln, sondern verdichtet sie zu einer Trefferwahrscheinlichkeit fuer euer 15m-Swing-Setup (TP 1,75%/SL 0,5%, 20x Hebel, Break-even-Trefferquote 22,2%).",
  "So liest du das: die Wahrscheinlichkeit ist die historische Trefferquote aehnlicher Setups. \"Hoch\" bedeutet oberstes Drittel aller historischen Setups (~25-28% Trefferquote, ueber Break-even), \"Niedrig\" das unterste Drittel (~14-17%, klar darunter). \"Mittel\" liegt dazwischen.",
  "Wichtig -- nur der Vorab-Score: gezeigt werden die 4 Leading-Faktoren (Trend-Konfirmation ueber 9 kollineare Struktur-/Trend-Signale zusammengefasst, Fear & Greed kontrarisch, Makro-Regime, Orderbuch-Imbalance). Der staerkste Einzelfaktor (Momentum RSI+MACD) ist ein Confirming-Signal und erst bekannt, sobald ein laufendes Setup die 0,25%-Marge erreicht -- fehlt hier deshalb bewusst, statt eine beim Entry noch unbekannte Information vorzutaeuschen.",
  "Grenzen: Dezile (feinere Abstufung als 3 Stufen) wurden bewusst NICHT umgesetzt -- bei aktueller Datenmenge (~7.200 Setups je Richtung) sind viele Dezile statistisch nicht zuverlaessig unterscheidbar (Standardfehler ±3-4 Prozentpunkte). Kein Handelssignal, keine Erfolgsgarantie.",
].join("\n\n");

function FactorLine({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-text-faint">{label}</span>
      <span className={active ? "text-text" : "text-text-faint"}>{active ? "aktiv" : "—"}</span>
    </div>
  );
}

// Nutzer-Wunsch (12.09.2026): "beim tippen sehen weshalb (welches Signal)
// der befund so ist" -- die verdichtete "Trend-Konfirmation (X/9)"-Zeile
// verriet bisher nur die Summe, nicht welche der 9 Struktur-/Trend-Signale
// gerade aktiv sind. Antippen klappt jetzt genau diese 9 Einzelsignale auf
// (research_confluence_score_live() liefert sie jetzt einzeln mit, siehe
// Migration add_trend_signal_breakdown_to_confluence_live) -- dieselbe
// Zahlen-Basis wie zuvor, nur zusaetzlich einzeln sichtbar.
function TrendConfirmationLine({ trendCount, trendSignals }: { trendCount: number; trendSignals: TrendSignalState[] }) {
  const active = trendCount >= 2;
  return (
    <details className="text-[11px]">
      <summary className="flex items-center justify-between cursor-pointer select-none">
        <span className="text-text-faint">Trend-Konfirmation ({trendCount}/9)</span>
        <span className={active ? "text-text" : "text-text-faint"}>{active ? "aktiv" : "—"}</span>
      </summary>
      <div className="mt-1 pl-2 space-y-0.5 border-l border-border/60">
        {trendSignals.map((s) => (
          <div key={s.name} className="flex items-center justify-between">
            <span className="text-text-faint">{s.name}</span>
            <span className={s.active ? "text-text" : "text-text-faint"}>{s.active ? "aktiv" : "—"}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function ScoreRow({ row, label }: { row: ConfluenceScoreRow | null; label: string }) {
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
        <TrendConfirmationLine trendCount={row.trendCount} trendSignals={row.trendSignals} />
        <FactorLine
          label={`Fear & Greed${row.fearGreedClassification ? ` (${row.fearGreedClassification})` : ""}`}
          active={row.fearGreedActive}
        />
        <FactorLine label={`Makro-Regime${row.makroRegime ? ` (${row.makroRegime})` : ""}`} active={row.makroActive} />
        <FactorLine label="Orderbuch-Imbalance" active={row.orderbuchActive} />
      </div>
    </div>
  );
}

// Ebene 2 ("Signale im Detail", siehe docs/research/NEXUS-STRUKTUR-KONZEPT_2026-09-12.md
// Abschnitt 1+2): ueber die Score-Kachel erreichbar statt an anderer Stelle
// verstreut -- zeigt exakt, welche der einzeln getesteten Signale den
// vorregistrierten BH-FDR-Test bestehen (fliessen in den Score ein, direkt
// oder gebuendelt im Trend-Konfirmation-Faktor) und welche nicht (sichtbar,
// aber nicht stimmberechtigt). <details> statt eigenem Client-State/Toggle --
// diese Kachel ist ein Server-Component, kein "use client" noetig.
function SignalDetailList({ signals, direction }: { signals: ConfluenceSignalDetail[]; direction: "LONG" | "SHORT" }) {
  const rows = signals.filter((s) => s.direction === direction);
  if (rows.length === 0) return null;

  return (
    <div className="space-y-1">
      {rows.map((s) => (
        <div key={s.signal} className="flex items-center justify-between gap-2 text-[11px]">
          <span className={s.validated ? "text-text" : "text-text-faint"}>{s.signal}</span>
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="text-text-faint">
              {s.hitRateActive.toFixed(1)}% (n={s.nActive})
            </span>
            <span
              className={`px-1 py-0.5 rounded text-[10px] font-medium ${
                s.validated ? "text-up" : "text-text-faint border border-border"
              }`}
            >
              {s.validated ? "✓ validiert" : "— unbestätigt"}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ConfluenceScoreCard({
  score,
  signalDetail,
}: {
  score: ConfluenceScoreResult;
  signalDetail: ConfluenceSignalDetail[];
}) {
  const validatedCount = signalDetail.filter((s) => s.validated).length;
  const unvalidatedCount = signalDetail.length - validatedCount;

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <span className="flex items-center gap-1.5 flex-wrap">
        <p className="text-sm font-medium text-text">Setup-Score</p>
        <span className="text-[11px] text-text-faint">(15m · TP 1,75% · SL 0,5% · 20x)</span>
        <PanelInfo title="Setup-Score" content={INFO_TEXT} />
      </span>

      <p className="text-[11px] text-text-faint">
        Vorab-Score bei Entry · Break-even ab {BREAKEVEN_PCT}% Trefferquote
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <ScoreRow row={score.long} label="LONG" />
        <ScoreRow row={score.short} label="SHORT" />
      </div>

      {signalDetail.length > 0 && (
        <details className="pt-1 border-t border-border/60">
          <summary className="text-[11px] text-text-faint cursor-pointer select-none">
            Signale im Detail ({validatedCount} validiert, {unvalidatedCount} unbestätigt)
          </summary>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint mb-1">LONG</p>
              <SignalDetailList signals={signalDetail} direction="LONG" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint mb-1">SHORT</p>
              <SignalDetailList signals={signalDetail} direction="SHORT" />
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
