# Backtest der bestehenden Divergenz-Muster (05.09.2026)

Antwort auf den zweiten Teil des Nutzer-Auftrags ("#1-9 backtesten") aus der
Divergenz-Recherche vom selben Tag: testet die in Produktion bereits
aktiven, aber nie gegen echte Preis-Outcomes geprüften Warn-Muster aus
`compute-market-state` (Fragile Bullish, Distribution Warning, Capitulation,
Short Squeeze) sowie drei weitere, aus der Recherche identifizierte Paare
(Structure-vs-Trend-Strength, CVD-vs-Orderbook, Funding-vs-Basis, Engine
Divergence). Gleiche Methodik wie beim Candlestick-Pattern-Backtest:
purged/embargo Evaluation über `backtest_states` (2 Jahre, point-in-time-safe
rekonstruierte Faktoren) plus BH-FDR-Korrektur, ausschliesslich TRAIN- und
VALIDATION-Split (TEST-Set bleibt geschützt, siehe `PHASE-0-RECONCILIATION.md`).

**Nachtrag (spaeter am 05.09.2026):** Distribution Warning liess sich entgegen
der ersten Einschaetzung doch nachholen (Abschnitt 2.3) -- `range_high_20`/
`atr_14` wurden direkt aus der rohen, unveraenderlichen `candles`-Tabelle per
rueckwaertsgerichteten Fenster-Funktionen rekonstruiert, ohne die potenziell
nicht-Point-in-time-sichere `market_features`-Tabelle anzufassen. Capitulation
und Short Squeeze bleiben nicht testbar -- siehe Abschnitt 1 mit den jetzt
konkret ermittelten Fallzahlen.

## 1. Nicht testbar (Datenlage, mit konkreten Zahlen)

| Muster | Grund |
|---|---|
| Capitulation | RSI<30 + cvd=bärisch allein hat volle 2-Jahres-Historie (770 Kandidaten bei 1H), aber die dritte Bedingung (Liquidationsvolumen >3% des OI, `get_liquidation_intelligence`) braucht `liquidation_events`, das erst seit dem 24.08.2026 existiert. Nur **4 Kandidaten** (vor Anwendung des Liquidations-Filters!) fallen ueberhaupt in dieses Fenster -- zu wenig fuer jede Aussage. |
| Short Squeeze | `positioning_signals.explanation` enthaelt "Short-Squeeze" 113 Mal, aber die Tabelle existiert ebenfalls erst seit dem 24.08.2026 -- **alle 113 Faelle liegen vollstaendig im geschuetzten TEST-Zeitraum** (ab 15.05.2026), 0 in TRAIN/VALIDATION. Nicht auswertbar, ohne das Testset anzutasten. |
| Funding-Basis Divergenz | `basis`-Faktor hat in `backtest_states` nur bei 128 von 17'835 1H-Zeilen (0,7%) überhaupt einen Wert (Spot-Preis-Datenlücke) -- 0 Divergenz-Events gefunden, zu wenig Datenbasis für jede Aussage. |
| CVD-Orderbook Divergenz | `orderbook_snapshots` (Basis des `orderbook`-Faktors) existiert erst seit dem 26.08.2026. Alle 57 gefundenen Divergenz-Events liegen dadurch vollständig im geschützten TEST-Zeitraum (ab 15.05.2026) -- 0 Events in TRAIN/VALIDATION, keine Auswertung möglich, ohne das Testset anzutasten. |
| Engine Divergence (Market State vs. Regime Matrix, score-basiert) | Nur 3 echte Richtungs-Divergenzen (Score ≥+3/≤-3 UND Regime `TREND_EXPANSION_*` in Gegenrichtung) in 2 Jahren -- zu selten für jeden Backtest. Zum Vergleich: 69 Fälle, in denen beide Engines übereinstimmen. Diese Seltenheit ist selbst ein Befund: die beiden Engines widersprechen sich in ihrer GERICHTETEN Aussage praktisch nie -- die im Fallbeispiel vom 29.08. beobachtete Diskrepanz lag am (haeufigeren) `NOT_COMPARABLE`-Fall (Market State `MIXED`), nicht an einer echten Richtungs-Divergenz. |

**Gemeinsames Muster:** alle vier hier gelisteten Faelle scheitern an derselben
Ursache -- die zugrunde liegende Rohtabelle (`liquidation_events`,
`positioning_signals`, `orderbook_snapshots` fuer den Faktor, bzw. schlicht zu
wenige Score-Extremwerte) existiert erst seit dem 24.-26.08.2026, also nach dem
TRAIN/VALIDATION/TEST-Cutoff (Validation endet 14.05.2026). Das loest sich mit
der Zeit von selbst -- in ein paar Monaten haben diese Tabellen genug
TRAIN/VALIDATION-Historie fuer einen echten Test.

## 2. Testbar -- Ergebnisse

Purged/Embargo-Evaluation über `backtest_states` (1H/4H/1D, Embargo 1/4/3 Tage,
Horizonte wie beim Candlestick-Backtest: 4/12/24h, 16/48/96h, 24/72/168h),
anschliessend `research_bh_fdr_patterns(0.05)` kumulativ über ALLE bisher in
`research_pattern_results_purged` getesteten Zellen (Candlestick-Muster +
diese neuen Divergenz-Muster zusammen).

### 2.1 Fragile Bullish (structure=bullisch, cvd=bärisch) -- ÜBERRASCHENDER BEFUND

Getestet: haelt `direction_expected=BULLISH` (die vom Struktur-Faktor
suggerierte Richtung) einer purged Auswertung stand?

| Interval | Split | Horizont | n | Trefferquote | Baseline | Edge | BH-signifikant |
|---|---|---|---|---|---|---|---|
| 1H | train | 4h | 2560 | 56,6% | 51,4% | +5,2pp | ✅ |
| 1H | validation | 4h | 396 | 58,8% | 48,7% | +10,1pp | ✅ |
| 1H | validation | 12h | 396 | 57,8% | 48,5% | +9,3pp | ✅ |

Alle drei Zellen bestehen die BH-FDR-Korrektur -- inklusive VALIDATION (echte
Out-of-Sample-Bestätigung, nicht nur TRAIN). Bei 24h (1H) und allen 4H/1D-
Horizonten verschwindet der Effekt (nicht signifikant).

**Der Befund widerspricht der Namensgebung des Musters:** "Fragile Bullish"
sollte laut `compute-market-state`-Kommentar eine WARNUNG sein ("Struktur
bullisch, aber Orderflow bestätigt nicht -- mögliche Divergenz"). Empirisch
setzt sich die bullische Struktur-Lesart in den ersten 4-12 Stunden (1H-Basis)
aber MIT HÖHERER Trefferquote fort als der unbedingte Basiswert -- die
CVD-Divergenz scheint hier kurzfristig eher Rauschen als ein echtes
Warnsignal zu sein. Der Effekt zerfällt danach vollständig.

### 2.2 Structure-vs-Trend-Strength Divergenz -- bestätigt Hypothese aus METHODIC_DIVERGENCE_2026-08-29.md

Getestet: wenn `structure` und `trend_strength` (ADX-Richtung) sich
widersprechen, gewinnt die STRUKTUR-Lesart (`direction_expected` = Richtung
von `structure`)?

| Interval | Split | Horizont | Richtung | n | Trefferquote | Baseline | Edge | BH-signifikant |
|---|---|---|---|---|---|---|---|---|
| 1H | train | 4h | bullisch | 921 | 61,2% | 51,4% | +9,8pp | ✅ |
| 1H | train | 4h | bärisch | 730 | 57,4% | 48,6% | +8,8pp | ✅ |
| 1H | validation | 4h | bullisch | 183 | 61,2% | 48,7% | +12,5pp | ✅ |
| 4H | train | 16h | bärisch | 185 | 62,7% | 48,1% | +14,6pp | ✅ |
| 4H | train | 16h | bullisch | 284 | 63,4% | 51,9% | +11,5pp | ✅ |

5 von 48 getesteten Zellen signifikant nach BH-Korrektur, wieder konzentriert
auf den kürzesten Horizont je Intervall (1H→4h, 4H→16h) -- bei längeren
Horizonten (12h/24h bzw. 48h/96h) kein Effekt mehr.

**Einordnung:** das ist eine empirische Bestätigung der in
`METHODIC_DIVERGENCE_2026-08-29.md` (Abschnitt 7, offene Frage) aufgeworfenen
Hypothese: wenn die trägere, swing-basierte `structure` der schnelleren,
ADX-basierten `trend_strength` widerspricht, setzt sich `structure` im
kurzfristigen Fenster öfter durch als der unbedingte Basiswert. Erste
empirische Antwort auf die dort offen gelassene Frage.

### 2.3 Distribution Warning (Preis nahe 20-Perioden-Hoch, cvd=bärisch) -- kein signifikanter Effekt

`range_high_20` (rollierendes 20-Perioden-Maximum der Hochs) und `atr_14`
(einfacher gleitender Durchschnitt der True Range, 14 Perioden) direkt aus
`candles` rekonstruiert -- reine rückwärtsgerichtete Fensterfunktionen auf
unveränderlichen historischen OHLC-Daten, kein Bezug zu `market_features`
nötig. **Hinweis zur Genauigkeit:** dies ist eine SMA-basierte ATR-Näherung,
nicht zwingend identisch mit der in `compute-market-state` verwendeten
Berechnung (deren genaue Glättungsmethode aus dem Edge-Function-Code allein
nicht ersichtlich ist) -- für die hier getestete Kernfrage (grober Abstand
zum 20er-Hoch relativ zur Volatilität) ausreichend genau.

| Interval | Split | Horizont | n | Trefferquote | Baseline | Edge |
|---|---|---|---|---|---|---|
| 1H | train | 4h | 223 | 55,2% | 48,6% | +6,6pp |
| 1H | train | 12h | 223 | 55,2% | 47,6% | +7,6pp |
| 1H | validation | 4h/12h/24h | 15 | 60,0% | 51,3-52,1% | +7,9 bis +8,7pp |
| 4H | train | 96h | 49 | 61,2% | 44,7% | +16,5pp |

Durchgängig **richtig gerichtet** (Preis fällt öfter als der Basiswert,
passend zur Warnung) -- anders als bei Fragile Bullish keine Umkehrung.
**Aber:** keine einzige Zelle übersteht die kumulative BH-FDR-Korrektur
(bester Wert: 1H/4H train, p=0,020, gebraucht würde p≤0,003 bei Rang 16).
Bei nur 15 Validierungs-Fällen (1H) ist die Stichprobe zudem sehr klein.
**Fazit:** Richtung stimmt mit der Namensgebung überein, aber der Effekt ist
(noch) nicht stark/robust genug, um die Mehrfachvergleichs-Korrektur zu
bestehen -- weder Bestätigung noch Widerlegung des Musters.

## 2.4 TradingView-Signal vs. Gesamteinschätzung -- nachgeholt, kein Backtest (Live-Feature)

Die ursprünglich zurückgestellte Lücke aus der Divergenz-Recherche wurde
nachgeholt, aber als **Live-Vergleich im Divergenz-Radar**, nicht als
Backtest -- `tradingview_signals` hat nur wenige Tage Historie, zu wenig für
jede statistische Aussage. Die Blockade war lösbar: alle 6 Pine-Skripte
senden bereits einen von 14 festen `signal_type`-Strings, 10 davon explizit
mit `BULLISH`/`BEARISH`/`_BULL`/`_BEAR` im Namen; die restlichen 4
(`LIQUIDITY_SWEEP_HIGH/LOW`, `VWAP_STRETCH_HI/LO`) folgen der im
TradingView-README bereits dokumentierten Umkehr-Logik (Sweep/Überdehnung
nach oben = Reversal-Hinweis nach unten). Kein Raten -- reines Auswerten
einer bereits vorhandenen, im eigenen Pine-Code festgelegten Namenskonvention.
Siehe `lib/tradingViewSignal.ts::inferSignalDirection` +
`lib/divergenceRadar.ts::computeTradingViewVsStateDivergence` +
`docs/tradingview/README.md` (neuer Abschnitt "Divergenz-Radar").

## 3. Wichtige Einschränkungen (Ehrlichkeits-Hinweis)

- **SUPPORTED, nicht PROVEN** (gleiche Sprachregelung wie in den Model-B/C/D-
  Berichten): beide Befunde sind bislang nur gegen TRAIN+VALIDATION getestet,
  nicht gegen das geschützte TEST-Set (Abschnitt 6.2 in `phase6-ist-zustand-audit.md`
  begründet, warum das Testset erst bei einer finalen Kandidaten-Auswahl
  angerührt wird -- diese beiden Muster sind Kandidaten, keine finalen
  Ergebnisse).
- Beide Effekte sind **kurzlebig** (nur am kürzesten getesteten Horizont
  signifikant) -- keine Grundlage für einen mehrstündigen Trade allein
  daraus.
- Die Fragile-Bullish-Umkehr widerspricht der aktuellen Produktions-
  Interpretation (Muster fliesst als `warning_pattern` in `risk_level` ein,
  erhöht also aktuell das angezeigte Risiko). Dieser Bericht ändert
  **nichts** an `compute-market-state` oder der UI-Formulierung -- das wäre
  eine separate, bewusste Entscheidung (Risiko: eine falsch gelesene
  Umkehrung der Warnbedeutung wäre schlimmer als der Status quo). Empfehlung
  siehe Abschnitt 4.
- BH-FDR-Korrektur läuft kumulativ über ALLE bisher in
  `research_pattern_results_purged` gespeicherten Zellen (Candlestick-Muster
  dieser Session eingeschlossen) -- je mehr insgesamt getestet wird, desto
  strenger die Schwelle für neue Kandidaten. Das ist beabsichtigt (siehe
  Candlestick-Backtest-Historie), macht die 8 signifikanten Zellen hier aber
  bemerkenswert robust.

## 4. Empfehlung

1. **Nicht sofort produktiv umsetzen.** Beide Befunde sind Kandidaten für
   eine spätere TEST-Set-Validierung (analog zum Model-A-E-Prozess in
   `PHASE-0-RECONCILIATION.md`), nicht für eine sofortige Änderung an
   `compute-market-state`.
2. Bei einer künftigen Ueberarbeitung der Pattern-Bewertung: "Fragile
   Bullish" ggf. NICHT mehr pauschal als risikoerhöhendes `warning_pattern`
   werten, sondern -- vorbehaltlich TEST-Set-Bestätigung -- ergebnisoffen
   neu benennen.
3. Sobald `orderbook_snapshots`/`positioning_signals`/`liquidation_events`
   genug TRAIN/VALIDATION-Historie haben (in einigen Monaten, sie laufen
   bereits produktiv), CVD-Orderbook-Divergenz, Short Squeeze und
   Capitulation nachholen -- Infrastruktur (`research_pattern_events`,
   gleiche Pipeline) steht bereits, es fehlt nur Kalenderzeit.
4. TradingView-vs-Zustand ist jetzt live im Divergenz-Radar sichtbar
   (Abschnitt 2.4) -- sobald genug frische Alerts vorliegen, könnte ein
   künftiger Durchlauf dieses Backtests sie ebenfalls statistisch prüfen.

## Referenzen

- `research_pattern_events`, `research_pattern_results_purged`,
  `research_evaluate_patterns_purged`, `research_bh_fdr_patterns` (bestehende
  Infrastruktur aus dem Candlestick-Pattern-Backtest, unverändert
  wiederverwendet).
- `METHODIC_DIVERGENCE_2026-08-29.md` -- Ursprung der Structure-vs-Trend-
  Strength-Hypothese.
- `PHASE-0-RECONCILIATION.md` -- Testset-Schutz-Begründung.
