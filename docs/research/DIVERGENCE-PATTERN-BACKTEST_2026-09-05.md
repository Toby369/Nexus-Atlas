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

## 1. Nicht testbar (Datenlage)

| Muster | Grund |
|---|---|
| Distribution Warning | Braucht `range_high_20`/`atr_14` aus `market_features` -- diese Rohspalten sind NICHT Teil der point-in-time-sicheren `backtest_states.factors`-Basis (nur `structure_trend`/`bos`/`choch`). Ein Join gegen die rohe `market_features`-Tabelle würde das etablierte Leakage-Schutzkonzept dieser Tabelle umgehen -- bewusst nicht gemacht. |
| Capitulation | Braucht die Live-RPC `get_liquidation_intelligence` (Liquidationsvolumen relativ zu OI) -- nicht in `backtest_states` rekonstruiert. |
| Short Squeeze | Hängt an `positioning_signals.explanation` (Freitext), nicht am gespeicherten `positioning`-Faktorwert selbst -- nicht rekonstruierbar. |
| Funding-Basis Divergenz | `basis`-Faktor hat in `backtest_states` nur bei 128 von 17'835 1H-Zeilen (0,7%) überhaupt einen Wert (Spot-Preis-Datenlücke) -- 0 Divergenz-Events gefunden, zu wenig Datenbasis für jede Aussage. |
| CVD-Orderbook Divergenz | `orderbook_snapshots` (Basis des `orderbook`-Faktors) existiert erst seit dem 26.08.2026. Alle 57 gefundenen Divergenz-Events liegen dadurch vollständig im geschützten TEST-Zeitraum (ab 15.05.2026) -- 0 Events in TRAIN/VALIDATION, keine Auswertung möglich, ohne das Testset anzutasten. |
| Engine Divergence (Market State vs. Regime Matrix, score-basiert) | Nur 3 echte Richtungs-Divergenzen (Score ≥+3/≤-3 UND Regime `TREND_EXPANSION_*` in Gegenrichtung) in 2 Jahren -- zu selten für jeden Backtest. Zum Vergleich: 69 Fälle, in denen beide Engines übereinstimmen. Diese Seltenheit ist selbst ein Befund: die beiden Engines widersprechen sich in ihrer GERICHTETEN Aussage praktisch nie -- die im Fallbeispiel vom 29.08. beobachtete Diskrepanz lag am (haeufigeren) `NOT_COMPARABLE`-Fall (Market State `MIXED`), nicht an einer echten Richtungs-Divergenz. |

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
3. Sobald `orderbook_snapshots` genug TRAIN/VALIDATION-Historie hat (in
   einigen Monaten), CVD-Orderbook-Divergenz nachholen -- Infrastruktur
   (`research_pattern_events`, gleiche Pipeline) steht bereits.
4. Distribution Warning/Capitulation liessen sich nachholen, wenn
   `range_high_20`/`atr_14`/RSI zusätzlich point-in-time-sicher in
   `backtest_states` aufgenommen würden -- aktuell ausserhalb des Umfangs
   dieser Auswertung.

## Referenzen

- `research_pattern_events`, `research_pattern_results_purged`,
  `research_evaluate_patterns_purged`, `research_bh_fdr_patterns` (bestehende
  Infrastruktur aus dem Candlestick-Pattern-Backtest, unverändert
  wiederverwendet).
- `METHODIC_DIVERGENCE_2026-08-29.md` -- Ursprung der Structure-vs-Trend-
  Strength-Hypothese.
- `PHASE-0-RECONCILIATION.md` -- Testset-Schutz-Begründung.
