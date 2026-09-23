import type { RegimeScoreResult, RegimeScoreRow, RegimeScoreTier, RegimeSignalDetail } from "@/lib/regimeScoreContext";
import PanelInfo from "@/components/PanelInfo";

// Regime-Score (Projektname weiterhin "Gesamteinschätzung-Score-Protokoll",
// siehe docs/research/GESAMTEINSCHAETZUNG-SCORE-PROTOCOL_2026-09-12.md +
// GESAMTEINSCHAETZUNG-SCORE-PHASE1-RESULTS_2026-09-12.md) -- separates,
// eigenständig validiertes Regime-Modell. Bewusst als EIGENE Kachel neben
// dem Setup-Score, niemals vermischt (institutionelle Trennung Regime- vs.
// Trade-Signal-Scoring, siehe NEXUS-STRUKTUR-KONZEPT Abschnitt 5) -- eigene
// Zielgrösse (ATR-skalierte 4h-Bewegung statt Hebel-Setup-Trefferquote),
// eigener BH-FDR-Pool, eigene WOE-Gewichte.
//
// 12.09.2026 -- Kachel-TITEL von "Gesamteinschätzung-Score" auf
// "Regime-Score" verkürzt (Nutzer-Feedback: zu leicht mit der
// MarketStateCard-Überschrift "Gesamteinschätzung" zu verwechseln, obwohl
// beides fachlich unabhängige Dinge sind). Rein kosmetisch -- Dateiname,
// Funktionsnamen (buildRegimeScore, research_regime_score_live) und die
// Protokoll-Dokumente behalten ihren ursprünglichen Namen.
//
// WICHTIG -- anders als der Setup-Score noch NICHT vollständig validiert:
// erst 31 von 50 vorregistrierten Kandidatensignalen getestet. Deshalb
// deutlich als "in Aufbau" gekennzeichnet, analog zum "wird neu validiert"-
// Hinweis bei der Gesamteinschätzung (MarketStateCard).
//
// 13.09.2026 -- vierter Faktor DXY-Bewegung ergänzt (Runde 4, siehe
// PHASE1-RESULTS-Dokument): BH-FDR-signifikant in beide Richtungen,
// Out-of-Sample bestätigt, praktisch unabhängig von den bestehenden 3
// Faktoren (Kollinearitäts-Check). M2-Wachstum trotz BH-FDR-Signifikanz
// bewusst NICHT aufgenommen (Out-of-Sample-Check degeneriert, siehe Doku).
//
// 13.09.2026 -- fünfter Faktor CCI-Extrem ergänzt (Runde 6, Nutzer-Vorschlag
// CCI/ROC): Trend-Fortsetzungs-Hypothese (nicht Mean-Reversion, siehe Doku)
// bestätigt in beide Richtungen, Out-of-Sample bestätigt. Moderate, aber
// transparent dokumentierte Restkorrelation zu Trend-Konsens (r≈0,44-0,45)
// -- bewusst als eigener Faktor statt Bündelung, siehe Kollinearitäts-Check
// im PHASE1-RESULTS-Dokument. ROC-Z-Score (zweiter Runde-6-Kandidat) war
// NICHT signifikant und fließt nicht ein.
//
// 13.09.2026 -- sechster Faktor Fragile Bullish ergänzt (Runde 7,
// Nutzer-Wunsch "Warn-Muster angehen"): 1:1 aus compute-market-state
// rekonstruiert (structure=bullish + cvd=falling), NUR für UP signifikant
// (stärkster p-Wert im ganzen Protokoll) und bestätigt unabhängig den
// bereits am 05.09.2026 gefundenen Befund, dass diese "Warnung" empirisch
// eher eine Fortsetzung ist. Distribution Warning (zweiter Runde-7-
// Kandidat) war NICHT signifikant (n zu klein) und fließt nicht ein.
// Capitulation/Short Squeeze bleiben blockiert (Liquidations-/
// Positionierungs-Historie zu kurz, siehe Datenverfügbarkeits-Audit).

// 13.09.2026 -- Tier-Badge bewusst NICHT mehr in up/down (grün/rot) gefärbt:
// "Hoch" beim DOWN-Score (hohe Konfidenz für eine bärische Bewegung) sah
// dadurch grün aus wie ein bullisches Signal. Konfidenz-Stufe ist eine von
// der Richtung unabhängige Achse -- jetzt neutrale accent-Skala. Die
// Richtung selbst steht bereits im Zeilen-Label (UP/DOWN), das den
// passenden up/down-Ton trägt (siehe ScoreRow).
const TIER_STYLES: Record<RegimeScoreTier, string> = {
  Hoch: "border-accent/50 bg-accent/10 text-accent",
  Mittel: "border-border bg-surface-raised text-text-muted",
  Niedrig: "border-border text-text-faint",
};

const INFO_TEXT = [
  "Was das ist: ein von Setup-Score UNABHÄNGIGES Regime-Modell -- schätzt, ob BTC in den nächsten 4 Stunden um mindestens 1×ATR(14) nach oben (UP) oder unten (DOWN) ausschlägt, statt eines konkreten Hebel-Setups. Eigene Zielgrösse, eigene Statistik-Korrektur, eigene Gewichte -- niemals mit dem Setup-Score vermischt. Heisst bewusst \"Regime-Score\" statt \"Gesamteinschätzung-Score\", um es klar von der \"Gesamteinschätzung\" oben (MarketStateCard) zu unterscheiden -- beides sind unabhängige Kacheln.",
  "Status -- in Aufbau: bisher wurden 34 von 52 vorregistrierten Kandidatensignalen getestet (20 davon statistisch bestätigt, 6 unabhängige Faktoren fliessen in den Score unten ein). Der hier gezeigte Score kombiniert die bislang bestätigten Faktoren per Weight-of-Evidence und wurde out-of-sample geprüft -- ist aber noch nicht abgeschlossen validiert wie der Setup-Score.",
  "So liest du das: UP-Score = Trend-Konsens (wie viele von 6 Trend-Signalen zeigen aufwärts) + Orderflow-Stärke (CVD-Z-Score) + Bollinger-Überverkauft-Signal + Dollar-Index (DXY) fällt + CCI-Trendausbruch aufwärts + \"Fragile Bullish\"-Muster (Struktur bullisch, Orderflow fallend -- empirisch trotzdem eher Fortsetzung als Warnung). DOWN-Score = Trend-Konsens (abwärts) + Orderflow-Stärke + Momentum-Faktor + Dollar-Index (DXY) steigt + CCI-Trendausbruch abwärts. \"Hoch\" bedeutet oberstes Drittel aller historischen 4h-Fenster (~39-41% Trefferquote, Basisrate ~33%), \"Niedrig\" das unterste Drittel.",
  "Kein Handelssignal, keine Erfolgsgarantie -- und ausdrücklich kein Ersatz für den Setup-Score.",
].join("\n\n");

// Nutzer-Wunsch 14.09.2026 ("kurze und strukturierte Beschreibung hinter
// jedem Signal, bei Antippen"): Kurzbeschreibung je Einzelsignal aus der
// "Signale im Detail"-Liste, aufklappbar per Antippen (siehe
// SignalDetailList unten). Texte sind 1:1 aus der tatsaechlichen SQL-
// Berechnung abgeleitet (research_regime_extend_activation() bis _round7(),
// siehe docs/research/GESAMTEINSCHAETZUNG-SCORE-PROTOCOL_2026-09-12.md +
// PHASE1-RESULTS-Dokument), NICHT geraten -- beschreiben nur, WAS das
// Signal misst, nicht ob es validiert ist (das zeigt bereits das
// "validiert"/"unbestätigt"-Badge daneben). Ein Teil der Signale ist pro
// Richtung invertiert (z.B. "Struktur 1h": bullisch fuer UP, baerisch fuer
// DOWN) -- dafuer die {up, down}-Form, der Rest gilt fuer beide Richtungen
// gleich (z.B. "CPR-Breite eng": dieselbe Bedingung, kein Gegenteil).
const SIGNAL_DESCRIPTIONS: Record<string, string | { up?: string; down?: string }> = {
  "Bollinger %b (Mean-Reversion)": {
    up: "Preis nahe/unter dem unteren Bollinger-Band (%b ≤ 0,2, überverkauft) – Mean-Reversion-Hypothese: Erholung nach oben.",
    down: "Preis nahe/über dem oberen Bollinger-Band (%b ≥ 0,8, überkauft) – Mean-Reversion-Hypothese: Rücksetzer nach unten.",
  },
  "CCI-Extrem (Fortsetzung)": {
    up: "CCI(20) auf 1h ≥ +100 (extremer Trendausbruch nach oben) – Hypothese: Trend setzt sich fort, keine Mean-Reversion.",
    down: "CCI(20) auf 1h ≤ −100 (extremer Trendausbruch nach unten) – Hypothese: Trend setzt sich fort, keine Mean-Reversion.",
  },
  "CPI-Anstieg": "US-Verbraucherpreisindex (CPI) im Vormonat gestiegen – Hypothese: höhere Inflation belastet Risikoassets.",
  "CPR-Breite eng": "Central Pivot Range (aus Vortages-Hoch/Tief/Schluss) ungewöhnlich eng (unterstes Drittel der letzten 20 Tage) – Hypothese: kündigt einen Trendtag an, in beide Richtungen möglich.",
  "CPR-Position (Preis < Bottom)": "Aktueller Preis liegt unter dem Bottom der Central Pivot Range (aus Vortages-H/L/C) – Hypothese: Ausbruch nach unten setzt sich fort.",
  "CPR-Position (Preis > Top)": "Aktueller Preis liegt über dem Top der Central Pivot Range (aus Vortages-H/L/C) – Hypothese: Ausbruch nach oben setzt sich fort.",
  "CVD-Richtung": {
    up: "Cumulative Volume Delta (Orderflow) auf 15m-Basis steigend – mehr aggressive Käufe als Verkäufe.",
    down: "Cumulative Volume Delta (Orderflow) auf 15m-Basis fallend – mehr aggressive Verkäufe als Käufe.",
  },
  "CVD-Z-Score": {
    up: "CVD auf 1h, standardisiert zur eigenen Historie (Z-Score) ≥ +1,0 – ungewöhnlich starker Kaufdruck im Orderflow.",
    down: "CVD auf 1h, standardisiert zur eigenen Historie (Z-Score) ≤ −1,0 – ungewöhnlich starker Verkaufsdruck im Orderflow.",
  },
  "Distanz-SMA50-Z (Mean-Reversion)": {
    up: "Preis auf 1h weit unter dem gleitenden 50er-Durchschnitt (Z-Score ≤ −1,5) – Mean-Reversion-Hypothese: Rückkehr nach oben.",
    down: "Preis auf 1h weit über dem gleitenden 50er-Durchschnitt (Z-Score ≥ +1,5) – Mean-Reversion-Hypothese: Rückkehr nach unten.",
  },
  "Distribution Warning": "20er-Perioden-Hoch liegt weniger als 0,5×ATR14 über dem Preis UND Orderflow (CVD) fällt gleichzeitig – Muster, das Verteilung nahe den Hochs andeuten soll.",
  "DXY-Bewegung": {
    up: "US-Dollar-Index (DXY) fällt an diesem Tag um mehr als 0,3 % – Dollar-Schwäche gilt als tendenziell günstig für BTC.",
    down: "US-Dollar-Index (DXY) steigt an diesem Tag um mehr als 0,3 % – Dollar-Stärke gilt als tendenziell belastend für BTC.",
  },
  "Fear & Greed": {
    up: "Crypto Fear & Greed Index zeigt „Extreme Fear\" – kontrarisch gelesen als mögliches Kaufsignal.",
    down: "Crypto Fear & Greed Index zeigt „Extreme Greed\" – kontrarisch gelesen als mögliches Verkaufssignal.",
  },
  "Fragile Bullish": "1h-Marktstruktur bullisch, Orderflow (CVD) aber gleichzeitig fallend – trotz des Namens empirisch eher eine Fortsetzung als eine Warnung.",
  "Funding-Z-Score": {
    up: "Funding-Rate, standardisiert zur eigenen Historie, ungewöhnlich stark negativ (Z ≤ −1,5, „Crowded Shorts\") – Hypothese: Short-Squeeze-Potenzial nach oben.",
    down: "Funding-Rate, standardisiert zur eigenen Historie, ungewöhnlich stark positiv (Z ≥ +1,5, „Crowded Longs\") – Hypothese: Risiko einer Abwärtsbewegung.",
  },
  "Gold-Bewegung": {
    up: "Gold steigt an diesem Tag um mehr als 0,5 % – Hypothese: Ko-Bewegung mit BTC, gleiche statt entgegengesetzte Richtung.",
    down: "Gold fällt an diesem Tag um mehr als 0,5 % – Hypothese: Ko-Bewegung mit BTC, gleiche statt entgegengesetzte Richtung.",
  },
  "M2-Wachstum": "US-Geldmenge M2 im Vormonat gegenüber dem Vormonat gewachsen – Liquiditäts-Hypothese: mehr Liquidität begünstigt Risikoassets.",
  "Makro-Regime": {
    up: "Makro-Risikoregime aus VIX, S&P 500, Nasdaq, Dollar-Index und Fed-Nettoliquidität zeigt „Risk-On\" – gilt als günstig für BTC.",
    down: "Makro-Risikoregime aus VIX, S&P 500, Nasdaq, Dollar-Index und Fed-Nettoliquidität zeigt „Risk-Off\" – gilt als belastend für BTC.",
  },
  "Momentum-Faktor (RSI+MACD)": {
    up: "RSI(14) über 50 UND MACD-Histogramm gleichzeitig positiv (15m) – beide Momentum-Indikatoren zeigen gemeinsam aufwärts.",
    down: "RSI(14) unter 50 UND MACD-Histogramm gleichzeitig negativ (15m) – beide Momentum-Indikatoren zeigen gemeinsam abwärts.",
  },
  "MTF-Alignment": {
    up: "Marktstruktur auf 1h, 4h UND 1d gleichzeitig bullisch (striktes 3-Zeitrahmen-Match) – starker Trend-Konsens über mehrere Zeitebenen.",
    down: "Marktstruktur auf 1h, 4h UND 1d gleichzeitig bärisch (striktes 3-Zeitrahmen-Match) – starker Trend-Konsens über mehrere Zeitebenen.",
  },
  "Nasdaq-Bewegung": {
    up: "Nasdaq steigt an diesem Tag um mehr als 0,5 % – Risk-On-Kopplung: Tech-Aktien-Stärke gilt als tendenziell günstig für BTC.",
    down: "Nasdaq fällt an diesem Tag um mehr als 0,5 % – Risk-On-Kopplung: Tech-Aktien-Schwäche gilt als tendenziell belastend für BTC.",
  },
  "Net-Liquidity steigt": "Fed-Bilanz minus TGA minus Reverse-Repo (Nettoliquidität) steigt um mehr als 0,5 % gegenüber dem Vortag – mehr Liquidität begünstigt Risikoassets.",
  "Net-Taker-Flow-Ratio": {
    up: "Netto-Taker-Flow-Ratio (aggressive Käufe minus Verkäufe im Verhältnis zum Volumen) positiv – mehr aggressive Käufer als Verkäufer.",
    down: "Netto-Taker-Flow-Ratio (aggressive Käufe minus Verkäufe im Verhältnis zum Volumen) negativ – mehr aggressive Verkäufer als Käufer.",
  },
  "OI-Quadrant (Buildup)": {
    up: "Open Interest UND Preis steigen gleichzeitig (Long-Aufbau, einer von vier OI/Preis-Quadranten) – neue Long-Positionen werden aufgebaut.",
    down: "Open Interest steigt bei fallendem Preis (Short-Aufbau, einer von vier OI/Preis-Quadranten) – neue Short-Positionen werden aufgebaut.",
  },
  "Orderbuch-Imbalance": {
    up: "Orderbuch-Tiefe auf Binance deutlich kauflastig (Depth-Imbalance > 0,08) – mehr passive Liquidität auf der Kaufseite.",
    down: "Orderbuch-Tiefe auf Binance deutlich verkaufslastig (Depth-Imbalance < −0,08) – mehr passive Liquidität auf der Verkaufsseite.",
  },
  "PCE-Anstieg": "US-PCE-Preisindex (von der Fed bevorzugtes Inflationsmass) im Vormonat gestiegen – Hypothese: höhere Inflation belastet Risikoassets.",
  "Regressionssteigung": {
    up: "Steigung der linearen Regressionsgeraden durch die jüngsten 1h-Schlusskurse positiv – rechnerischer Aufwärtstrend.",
    down: "Steigung der linearen Regressionsgeraden durch die jüngsten 1h-Schlusskurse negativ – rechnerischer Abwärtstrend.",
  },
  "ROC-Z-Score": {
    up: "14h-Kursveränderung (Rate of Change), standardisiert zur eigenen Streuung, ≥ +1 Standardabweichung – überdurchschnittliches Aufwärts-Momentum.",
    down: "14h-Kursveränderung (Rate of Change), standardisiert zur eigenen Streuung, ≤ −1 Standardabweichung – überdurchschnittliches Abwärts-Momentum.",
  },
  "S&P-500-Bewegung": {
    up: "S&P 500 steigt an diesem Tag um mehr als 0,5 % – Risk-On-Kopplung: Aktienmarkt-Stärke gilt als tendenziell günstig für BTC.",
    down: "S&P 500 fällt an diesem Tag um mehr als 0,5 % – Risk-On-Kopplung: Aktienmarkt-Schwäche gilt als tendenziell belastend für BTC.",
  },
  "Struktur 15m": {
    up: "Marktstruktur auf 15-Minuten-Basis bullisch (höhere Hochs/Tiefs) – aus der fraktalen Swing-Erkennung (BOS/CHoCH).",
    down: "Marktstruktur auf 15-Minuten-Basis bärisch (tiefere Hochs/Tiefs) – aus der fraktalen Swing-Erkennung (BOS/CHoCH).",
  },
  "Struktur 1d": {
    up: "Marktstruktur auf Tagesbasis bullisch (höhere Hochs/Tiefs) – aus der fraktalen Swing-Erkennung (BOS/CHoCH).",
    down: "Marktstruktur auf Tagesbasis bärisch (tiefere Hochs/Tiefs) – aus der fraktalen Swing-Erkennung (BOS/CHoCH).",
  },
  "Struktur 1h": {
    up: "Marktstruktur auf 1-Stunden-Basis bullisch (höhere Hochs/Tiefs) – aus der fraktalen Swing-Erkennung (BOS/CHoCH).",
    down: "Marktstruktur auf 1-Stunden-Basis bärisch (tiefere Hochs/Tiefs) – aus der fraktalen Swing-Erkennung (BOS/CHoCH).",
  },
  "Struktur 4h": {
    up: "Marktstruktur auf 4-Stunden-Basis bullisch (höhere Hochs/Tiefs) – aus der fraktalen Swing-Erkennung (BOS/CHoCH).",
    down: "Marktstruktur auf 4-Stunden-Basis bärisch (tiefere Hochs/Tiefs) – aus der fraktalen Swing-Erkennung (BOS/CHoCH).",
  },
  "Trend-Regime (EMA50/200)": {
    up: "Gleitender 50er-Durchschnitt liegt über dem 200er (EMA50 > EMA200, 15m-Basis) – klassische „Golden Cross\"-Trendstruktur.",
    down: "Gleitender 50er-Durchschnitt liegt unter dem 200er (EMA50 < EMA200, 15m-Basis) – klassische „Death Cross\"-Trendstruktur.",
  },
  "Trendstaerke (ADX+DI)": {
    up: "ADX(14) ≥ 20 (Trend vorhanden) UND +DI > −DI (15m) – Trendstärke-Indikator zeigt einen aufwärts gerichteten Trend.",
    down: "ADX(14) ≥ 20 (Trend vorhanden) UND −DI > +DI (15m) – Trendstärke-Indikator zeigt einen abwärts gerichteten Trend.",
  },
  "USD/JPY fällt": "USD/JPY fällt an diesem Tag um mehr als 0,3 % (Yen wird stärker) – Yen-Carry-Trade-Hypothese: kann Risikoassets belasten.",
  "VIX erhöht": "VIX (Volatilitätsindex) steht über 25 – erhöhte Markt-Angst, gilt als Risk-Off-Signal, das Risikoassets belasten kann.",
  "VWAP-Position": {
    up: "Preis liegt über dem rollierenden VWAP (volumengewichteter Durchschnittspreis, 15m) – gilt als bullisches Signal.",
    down: "Preis liegt unter dem rollierenden VWAP (volumengewichteter Durchschnittspreis, 15m) – gilt als bärisches Signal.",
  },
};

function getSignalDescription(signal: string, direction: "UP" | "DOWN"): string | null {
  const entry = SIGNAL_DESCRIPTIONS[signal];
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  return (direction === "UP" ? entry.up : entry.down) ?? entry.up ?? entry.down ?? null;
}

function FactorLine({ label, active }: { label: string; active: boolean | null }) {
  if (active === null) return null;
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-text-faint">{label}</span>
      <span className={active ? "text-text" : "text-text-faint"}>{active ? "aktiv" : "—"}</span>
    </div>
  );
}

function ScoreRow({ row, label, tone }: { row: RegimeScoreRow | null; label: string; tone: "up" | "down" }) {
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
        <FactorLine label={`Trend-Konsens (${row.trendKonsens}/6)`} active={row.trendKonsens >= 3} />
        <FactorLine label="Orderflow-Stärke (CVD-Z)" active={row.cvdZActive} />
        <FactorLine label="Momentum-Faktor" active={row.momentumActive} />
        <FactorLine label="Bollinger überverkauft" active={row.bollingerPctbActive} />
        <FactorLine label="Dollar-Index (DXY)" active={row.dxyActive} />
        <FactorLine label="CCI-Trendausbruch" active={row.cciActive} />
        <FactorLine label="Fragile Bullish" active={row.fragileBullishActive} />
      </div>
    </div>
  );
}

// Ebene 2 ("Signale im Detail", Nutzer-Wunsch 14.09.2026: "regime score
// signals im detail, wie bei setup score") -- exakt dieselbe Darstellung wie
// SignalDetailList in ConfluenceScoreCard.tsx, nur fuer UP/DOWN statt
// LONG/SHORT und gespeist aus research_regime_bh_fdr() statt
// research_confluence_bh_fdr() (siehe buildRegimeSignalDetail() in
// regimeScoreContext.ts).
function SignalDetailList({ signals, direction }: { signals: RegimeSignalDetail[]; direction: "UP" | "DOWN" }) {
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

export default function RegimeScoreCard({
  score,
  signalDetail,
}: {
  score: RegimeScoreResult;
  signalDetail: RegimeSignalDetail[];
}) {
  const validatedCount = signalDetail.filter((s) => s.validated).length;
  const unvalidatedCount = signalDetail.length - validatedCount;

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <span className="flex items-center gap-1.5 flex-wrap">
        <p className="text-sm font-medium text-text">Regime-Score</p>
        <span className="text-[10px] text-text-faint border border-border rounded px-1">
          in Aufbau · 34/52 Signale getestet
        </span>
        <PanelInfo title="Regime-Score" content={INFO_TEXT} />
      </span>

      <p className="text-[11px] text-text-faint">
        4h-Horizont · ±1×ATR(14) · unabhängig vom Setup-Score
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
        <ScoreRow row={score.up} label="UP" tone="up" />
        <ScoreRow row={score.down} label="DOWN" tone="down" />
      </div>

      {signalDetail.length > 0 && (
        <details className="pt-1 border-t border-border/60">
          <summary className="text-[11px] text-text-faint cursor-pointer select-none">
            Signale im Detail ({validatedCount} validiert, {unvalidatedCount} unbestätigt)
          </summary>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint mb-1">UP</p>
              <SignalDetailList signals={signalDetail} direction="UP" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint mb-1">DOWN</p>
              <SignalDetailList signals={signalDetail} direction="DOWN" />
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
