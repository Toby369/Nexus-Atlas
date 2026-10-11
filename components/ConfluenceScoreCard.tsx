import type {
  ConfluenceScoreResult,
  ConfluenceScoreRow,
  ConfluenceScoreTier,
  ConfluenceSignalDetail,
  TrendSignalState,
} from "@/lib/confluenceScoreContext";
import PanelInfo from "@/components/PanelInfo";

// Setup-Score (vormals "Confluence-Score", siehe NEXUS-STRUKTUR-KONZEPT
// Abschnitt 4) -- die Setup-Parameter stehen bewusst im Namen, damit die
// Bindung an genau dieses getestete Setup nie mit einer allgemeinen
// Marktbewertung verwechselt wird. Zeigt den out-of-sample validierten
// Weight-of-Evidence-Score aus dem Confluence-Score-Protokoll
// (docs/research/CONFLUENCE-SCORE-PROTOCOL_2026-09-11.md +
// CONFLUENCE-SCORE-PHASE3-RESULTS_2026-09-11.md Abschnitt 6c), und zwar nur
// den VORAB-Score (4 Leading-Faktoren: Trend-Konfirmation, Fear & Greed,
// Makro-Regime, Orderbuch-Imbalance) -- der Momentum-Faktor ist erst bei
// einem laufenden Setup bekannt (siehe research_confluence_score_live()).
//
// Farbe folgt der STUFE (Hoch/Mittel/Niedrig), nicht der Richtung: "Hoch"
// bei SHORT saehe in gruen sonst bullisch aus. Die Richtung traegt das
// Zeilen-Label (LONG/SHORT) im passenden up/down-Ton (siehe ScoreRow).
const TIER_STYLES: Record<ConfluenceScoreTier, string> = {
  Hoch: "border-accent/50 bg-accent/10 text-accent",
  Mittel: "border-border bg-surface-raised text-text-muted",
  Niedrig: "border-border text-text-faint",
};

const BREAKEVEN_PCT = 22.2;

const INFO_TEXT = [
  "Was das ist: kombinierter Score aus 5 quasi-unabhaengigen Signal-Faktoren (Weight-of-Evidence, dieselbe Mathematik wie klassische Kredit-Scorecards), dreifach out-of-sample validiert an 4 Jahren BTCUSDT-Historie. Ersetzt keine Einzelsignal-Kacheln, sondern verdichtet sie zu einer Trefferwahrscheinlichkeit fuer euer 15m-Swing-Setup (TP 1,75%/SL 0,5%, 20x Hebel, Break-even-Trefferquote 22,2%).",
  "So liest du das: die Wahrscheinlichkeit ist die historische Trefferquote aehnlicher Setups. \"Hoch\" bedeutet oberstes Drittel aller historischen Setups (~25-28% Trefferquote, ueber Break-even), \"Niedrig\" das unterste Drittel (~14-17%, klar darunter). \"Mittel\" liegt dazwischen.",
  "Wichtig -- nur der Vorab-Score: gezeigt werden die 4 Leading-Faktoren (Trend-Konfirmation ueber 9 kollineare Struktur-/Trend-Signale zusammengefasst, Fear & Greed kontrarisch, Makro-Regime, Orderbuch-Imbalance). Der staerkste Einzelfaktor (Momentum RSI+MACD) ist ein Confirming-Signal und erst bekannt, sobald ein laufendes Setup die 0,25%-Marge erreicht -- fehlt hier deshalb bewusst, statt eine beim Entry noch unbekannte Information vorzutaeuschen.",
  "Grenzen: Dezile (feinere Abstufung als 3 Stufen) wurden bewusst NICHT umgesetzt -- bei aktueller Datenmenge (~7.200 Setups je Richtung) sind viele Dezile statistisch nicht zuverlaessig unterscheidbar (Standardfehler ±3-4 Prozentpunkte). Kein Handelssignal, keine Erfolgsgarantie.",
].join("\n\n");

// Kurzbeschreibung je Einzelsignal (aufklappbar per Antippen, siehe
// SignalDetailList), analog zu RegimeScoreCard.tsx. 13 der 15 Signale teilen
// die Basis mit dem Regime-Score (Texte uebernommen, LONG/SHORT statt
// UP/DOWN). Zwei Signale sind eingefroren (CONFLUENCE-SCORE-PHASE3-RESULTS,
// "2 von 15 Signalen eingefroren"): "Positionierung (Divergence-Engine-
// Score)" und "Divergenz-Radar: Onchain vs Preis" wurden ueber eine nicht
// mehr sicher rekonstruierbare Ad-hoc-Formel klassifiziert -- bewusst als
// deskriptiv gekennzeichnet statt eine praezise Schwelle vorzutaeuschen.
const SIGNAL_DESCRIPTIONS: Record<string, string | { long?: string; short?: string }> = {
  "CVD-Richtung": {
    long: "Cumulative Volume Delta (Orderflow) auf 15m-Basis steigend – mehr aggressive Käufe als Verkäufe.",
    short: "Cumulative Volume Delta (Orderflow) auf 15m-Basis fallend – mehr aggressive Verkäufe als Käufe.",
  },
  "Divergenz-Radar: Onchain vs Preis": "Vergleicht SOPR (realisierte Gewinne/Verluste bewegter Coins) mit der Preisnähe zum 30-Tage-Hoch/-Tief – Warnmuster bei Preis nahe Hoch, aber SOPR<1 (Verlustrealisierung trotz Höhe) oder Preis nahe Tief, aber SOPR≥1 (keine Kapitulation trotz Tiefe). Seit Phase 3 (11.09.2026) eingefroren: die exakte historische Klassifikationsformel liess sich nachträglich nicht mehr sicher rekonstruieren, rein deskriptiv, bislang nicht BH-FDR-signifikant.",
  "Fear & Greed": {
    long: "Crypto Fear & Greed Index zeigt „Extreme Fear\" – kontrarisch gelesen als mögliches Kaufsignal.",
    short: "Crypto Fear & Greed Index zeigt „Extreme Greed\" – kontrarisch gelesen als mögliches Verkaufssignal.",
  },
  "Makro-Regime": {
    long: "Makro-Risikoregime aus VIX, S&P 500, Nasdaq, Dollar-Index und Fed-Nettoliquidität zeigt „Risk-On\" – gilt als günstig für BTC.",
    short: "Makro-Risikoregime aus VIX, S&P 500, Nasdaq, Dollar-Index und Fed-Nettoliquidität zeigt „Risk-Off\" – gilt als belastend für BTC.",
  },
  "Momentum-Faktor (RSI+MACD)": {
    long: "RSI(14) über 50 UND MACD-Histogramm gleichzeitig positiv (15m) – beide Momentum-Indikatoren zeigen gemeinsam aufwärts.",
    short: "RSI(14) unter 50 UND MACD-Histogramm gleichzeitig negativ (15m) – beide Momentum-Indikatoren zeigen gemeinsam abwärts.",
  },
  "MTF-Alignment": {
    long: "Marktstruktur auf 1h, 4h UND 1d gleichzeitig bullisch (striktes 3-Zeitrahmen-Match) – starker Trend-Konsens über mehrere Zeitebenen.",
    short: "Marktstruktur auf 1h, 4h UND 1d gleichzeitig bärisch (striktes 3-Zeitrahmen-Match) – starker Trend-Konsens über mehrere Zeitebenen.",
  },
  "Orderbuch-Imbalance": {
    long: "Orderbuch-Tiefe auf Binance deutlich kauflastig (Depth-Imbalance > 0,08) – mehr passive Liquidität auf der Kaufseite.",
    short: "Orderbuch-Tiefe auf Binance deutlich verkaufslastig (Depth-Imbalance < −0,08) – mehr passive Liquidität auf der Verkaufsseite.",
  },
  "Positionierung (Divergence-Engine-Score)": "Kombinierter Score aus Positionierungsdaten (Long/Short-Ratio, Funding, Liquidationen). Seit Phase 3 (11.09.2026) eingefroren: die exakte historische Klassifikationsformel liess sich nachträglich nicht mehr sicher rekonstruieren, ohnehin ein sehr selten aktives Signal (~0,7% der Setups) und nicht BH-FDR-signifikant.",
  "Struktur 15m": {
    long: "Marktstruktur auf 15-Minuten-Basis bullisch (höhere Hochs/Tiefs) – aus der fraktalen Swing-Erkennung (BOS/CHoCH).",
    short: "Marktstruktur auf 15-Minuten-Basis bärisch (tiefere Hochs/Tiefs) – aus der fraktalen Swing-Erkennung (BOS/CHoCH).",
  },
  "Struktur 1d": {
    long: "Marktstruktur auf Tagesbasis bullisch (höhere Hochs/Tiefs) – aus der fraktalen Swing-Erkennung (BOS/CHoCH).",
    short: "Marktstruktur auf Tagesbasis bärisch (tiefere Hochs/Tiefs) – aus der fraktalen Swing-Erkennung (BOS/CHoCH).",
  },
  "Struktur 1h": {
    long: "Marktstruktur auf 1-Stunden-Basis bullisch (höhere Hochs/Tiefs) – aus der fraktalen Swing-Erkennung (BOS/CHoCH).",
    short: "Marktstruktur auf 1-Stunden-Basis bärisch (tiefere Hochs/Tiefs) – aus der fraktalen Swing-Erkennung (BOS/CHoCH).",
  },
  "Struktur 4h": {
    long: "Marktstruktur auf 4-Stunden-Basis bullisch (höhere Hochs/Tiefs) – aus der fraktalen Swing-Erkennung (BOS/CHoCH).",
    short: "Marktstruktur auf 4-Stunden-Basis bärisch (tiefere Hochs/Tiefs) – aus der fraktalen Swing-Erkennung (BOS/CHoCH).",
  },
  "Trend-Regime (EMA50/200)": {
    long: "Gleitender 50er-Durchschnitt liegt über dem 200er (EMA50 > EMA200, 15m-Basis) – klassische „Golden Cross\"-Trendstruktur.",
    short: "Gleitender 50er-Durchschnitt liegt unter dem 200er (EMA50 < EMA200, 15m-Basis) – klassische „Death Cross\"-Trendstruktur.",
  },
  "Trendstaerke (ADX+DI)": {
    long: "ADX(14) ≥ 20 (Trend vorhanden) UND +DI > −DI (15m) – Trendstärke-Indikator zeigt einen aufwärts gerichteten Trend.",
    short: "ADX(14) ≥ 20 (Trend vorhanden) UND −DI > +DI (15m) – Trendstärke-Indikator zeigt einen abwärts gerichteten Trend.",
  },
  "VWAP-Position": {
    long: "Preis liegt über dem rollierenden VWAP (volumengewichteter Durchschnittspreis, 15m) – gilt als bullisches Signal.",
    short: "Preis liegt unter dem rollierenden VWAP (volumengewichteter Durchschnittspreis, 15m) – gilt als bärisches Signal.",
  },
};

function getSignalDescription(signal: string, direction: "LONG" | "SHORT"): string | null {
  const entry = SIGNAL_DESCRIPTIONS[signal];
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  return (direction === "LONG" ? entry.long : entry.short) ?? entry.long ?? entry.short ?? null;
}

function FactorLine({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-text-faint">{label}</span>
      <span className={active ? "text-text" : "text-text-faint"}>{active ? "aktiv" : "—"}</span>
    </div>
  );
}

// Antippen der "Trend-Konfirmation (X/9)"-Zeile zeigt, welche der 9
// Struktur-/Trend-Signale gerade aktiv sind (research_confluence_score_live()
// liefert sie einzeln mit) -- dieselbe Zahlenbasis, nur aufgeschluesselt.
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

// Kachel als <details>, standardmaessig zu: im <summary> Titel + Mini-Badge
// je Richtung, der vollstaendige Inhalt im aufklappbaren Teil -- bleibt
// ein Server-Component ohne Client-State.
function ScoreBadge({ row, label, tone }: { row: ConfluenceScoreRow | null; label: string; tone: "up" | "down" }) {
  const toneClass = tone === "up" ? "text-up border-up/40 bg-up/10" : "text-down border-down/40 bg-down/10";
  return (
    <span className={`px-1.5 py-0.5 text-[10px] rounded-md border font-semibold whitespace-nowrap ${toneClass}`}>
      {label} {row ? `${row.tier} · ${row.probability.toFixed(1)}%` : "–"}
    </span>
  );
}

function ScoreRow({ row, label, tone }: { row: ConfluenceScoreRow | null; label: string; tone: "up" | "down" }) {
  const toneClass = tone === "up" ? "text-up" : "text-down";

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
        <p className={`text-xs font-medium ${toneClass}`}>{label}</p>
        <span className={`px-2 py-0.5 text-[11px] rounded-md border font-semibold ${TIER_STYLES[row.tier]}`}>
          {row.tier} · {row.probability.toFixed(1)}%
        </span>
      </div>
      <div className="space-y-1 pt-1 border-t border-border/60">
        <TrendConfirmationLine trendCount={row.trendCount} trendSignals={row.trendSignals} />
        <FactorLine
          label={`Fear & Greed${
            row.fearGreedValue !== null
              ? ` (${row.fearGreedValue}${row.fearGreedClassification ? ` · ${row.fearGreedClassification}` : ""})`
              : row.fearGreedClassification
                ? ` (${row.fearGreedClassification})`
                : ""
          }`}
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
      {rows.map((s) => {
        const description = getSignalDescription(s.signal, direction);
        return (
          <details key={s.signal} className="text-[11px]">
            <summary className="flex items-center justify-between gap-2 cursor-pointer select-none">
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
            </summary>
            {description && <p className="mt-1 pl-2 border-l border-border/60 text-text-faint">{description}</p>}
          </details>
        );
      })}
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
    <details className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <summary className="flex items-center justify-between gap-2 cursor-pointer select-none">
        <p className="text-sm font-medium text-text">Setup-Score</p>
        <span className="flex items-center gap-1.5 shrink-0">
          <ScoreBadge row={score.long} label="LONG" tone="up" />
          <ScoreBadge row={score.short} label="SHORT" tone="down" />
        </span>
      </summary>

      <div className="pt-3 space-y-3">
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-text-faint">(15m · TP 1,75% · SL 0,5% · 20x)</span>
          <PanelInfo title="Setup-Score" content={INFO_TEXT} />
        </span>

        <p className="text-[11px] text-text-faint">
          Vorab-Score bei Entry · Break-even ab {BREAKEVEN_PCT}% Trefferquote
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
          <ScoreRow row={score.long} label="LONG" tone="up" />
          <ScoreRow row={score.short} label="SHORT" tone="down" />
        </div>

        {signalDetail.length > 0 && (
          <details className="pt-1 border-t border-border/60">
            <summary className="text-[11px] text-text-faint cursor-pointer select-none">
              Signale im Detail ({validatedCount} validiert, {unvalidatedCount} unbestätigt)
            </summary>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
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
    </details>
  );
}
