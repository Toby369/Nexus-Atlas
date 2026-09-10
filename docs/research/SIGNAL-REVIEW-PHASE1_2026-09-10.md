# Periodischer KI-Rückblick — Phase 1: Schema + Detection/Backfill (10.09.2026)

Umsetzung von Phase 1 des am 09.09.2026 vom Nutzer freigegebenen Plans
("ja du kannst beginnen, selbstständig"): ein periodischer, transparenter
Rückblick, der vergangene Signale/Muster mit dem tatsächlichen späteren
Preisverlauf vergleicht. Diese Phase liefert ausschliesslich die
Dateninfrastruktur (Schema, Erkennung, Backfill, Outcome-Befüllung) für die
zwei saubersten Signal-Gruppen mit bereits ausreichender Live-Historie —
**kein UI, keine Statistik-Pipeline, keine KI-Kachel** (das sind die
Phasen 2–4 aus dem Plan).

## 1. Umfang dieser Phase

| Gruppe | Quelle | Signale | Historie |
|---|---|---|---|
| TradingView-Alerts | `tradingview_signals` | 15 signal_type-Werte (alle 6 Pine-Skripte) | seit 03.09.2026 |
| Warn-Muster | `market_states.patterns` | Fragile Bullish, Distribution Warning, Short Squeeze, Capitulation | seit 26.08.2026 |
| Risk-Faktoren | `market_states.risk_factors` | funding_crowding, basis_crowding, elevated_volatility, low_mtf_alignment, warning_pattern | seit 26.08.2026 |

Zurückgestellt auf spätere Phasen (siehe Plan vom 09.09.2026): Kern-Engines
(14-Faktoren/5-Säulen/Marktkontext-Bias), Divergenz-Radar, KI-Kacheln —
alle brauchen zusätzlich eine strukturierte "vorhergesagte Richtung", die
aktuell noch nicht gespeichert wird bzw. eigene methodische Fragen aufwerfen.

## 2. Schema

Neue Tabelle `signal_outcomes` (RLS aktiv, "Public read access" wie alle
anderen Marktdaten-Tabellen): ein Datensatz pro **(gefeuertes Signal ×
fester Horizont)**, analog zu `research_pattern_results_purged`, aber für
laufende Live-Beobachtung statt einmaligem Train/Val/Test-Backtest — kein
Split/Purge/Embargo nötig (jede Zeile wird ohnehin erst nach Ablauf ihres
eigenen Horizonts befüllt, es gibt keine "Zukunft", die durchsickern könnte).

Horizonte fix auf **4/12/24 Stunden** (Uhrzeit-basiert, nicht kerzenbasiert)
für alle drei Gruppen — dieselbe Skala wie beim bereits validierten
Warn-Muster-Backtest vom 05.09.2026
(`DIVERGENCE-PATTERN-BACKTEST_2026-09-05.md`), damit alle Live-Signal-
Gruppen dieses Systems später vergleichbar bleiben.

`direction_expected` ist bewusst **NULLABLE**: nicht jedes Signal hat eine
inhärente Richtung.

## 3. Direction-Mapping (mit Begründung)

**TradingView-Alerts**: 1:1-SQL-Replik von
`lib/tradingViewSignal.ts::inferSignalDirection` (`tv_infer_signal_direction()`,
per pgTAP-Golden-Test gegen dieselben Fälle wie
`lib/tradingViewSignal.test.ts` abgeglichen). Bewusste Duplizierung, gleiches
Prinzip wie `lib/webhookTradingView.ts` vs. die Edge Function.

**Warn-Muster** — NICHT die "Warnbedeutung" des Namens, sondern die
methodisch begründete Testrichtung:
- *Fragile Bullish* → `bullish` (testet die Struktur-suggerierte Richtung,
  exakt wie im Backtest vom 05.09., Abschnitt 2.1)
- *Distribution Warning* → `bearish` (testet die Warnung selbst, exakt wie
  im selben Bericht, Abschnitt 2.3)
- *Capitulation* → `bullish` (klassische Kontrarian-Bodenlesart, noch nicht
  empirisch getestet — erste Live-Erfassung)
- *Short Squeeze* → `bullish` (Squeeze treibt Preis definitionsgemäss nach
  oben, noch nicht empirisch getestet)

**Risk-Faktoren** — die meisten sind reine Risiko-/Magnitude-Flags ohne
Richtung (`compute-market-state`: "Risk ist bewusst von Confidence/Richtung
getrennt"):
- `warning_pattern`, `low_mtf_alignment`, `elevated_volatility` →
  `direction_expected = NULL` (nur Magnitude-Test/`return_pct` sinnvoll,
  kein erfundener Treffertest)
- `funding_crowding`/`basis_crowding` → Richtung aus dem exakt gleichen
  Vorzeichen abgeleitet, das `compute-market-state` selbst schon kontrarian
  wertet (positive Funding/Basis = Long-Crowding-Risiko = bearisch, und
  umgekehrt) — keine neu erfundene Kalibrierung.

## 4. Erkennung: nur Zustandswechsel, nicht jede Zeile

`compute-market-state` läuft alle 15 Minuten gegen dieselbe 1H-Kerze — ein
Muster/Risk-Faktor bleibt daher typischerweise über mehrere Zeilen aktiv.
Detection zählt per `LAG()`-Fenster-Funktion nur den **ersten** Bar einer
zusammenhaengenden Aktiv-Phase (gleiches Prinzip wie `highSwept`/
`bosUpFired` in den TradingView-Pine-Skripten) — sonst würde derselbe Fund
massiv überzählt. pgTAP-Test 13 verifiziert das (Instanzen ≪ aktive Zeilen).

## 5. Bug gefunden + behoben: Unique-Constraint zu grob

Die ursprüngliche Unique-Constraint `(source_table, source_id,
horizon_hours)` ignorierte `signal_type` — zwei verschiedene Signale aus
**derselben** `market_states`-Zeile (z. B. das Muster "Fragile Bullish" UND
der generische Risk-Faktor "warning_pattern") kollidierten über
`ON CONFLICT DO NOTHING`, der zweite wurde fälschlich als "bereits
vorhanden" übersprungen. Ergebnis: alle 21 `warning_pattern`-Transitionen
gingen beim ersten Lauf verloren. Migration `fix_signal_outcomes_unique_constraint`
korrigiert das auf `(source_table, source_id, signal_type, horizon_hours)`;
pgTAP-Test 12 ist ein direkter Regressionstest dafür. Nach dem Fix erneut
backfillt: 414 Zeilen total (255 TradingView, 75 Warn-Muster, 84
Risk-Faktoren).

## 6. Befüllung + Cron

`fill_signal_outcomes()` befüllt `outcome_price`/`outcome_at`/`return_pct`/
`hit` erst, wenn `fired_at + horizon_hours <= now()` — punkt-in-Zeit-sicher,
nutzt ausschliesslich die erste bereits abgeschlossene 1H-Kerze
(Binance BTCUSDT, dieselbe Quelle wie `SYMBOL`/`INTERVAL` in
`compute-market-state`) ab dem Zielzeitpunkt. Zwei neue pg_cron-Jobs, beide
alle 15 Minuten (`detect-signal-outcomes-every-15-min`,
`fill-signal-outcomes-every-15-min`, letzterer um 5 Min versetzt).

## 7. Tests

`run_signal_outcomes_tests()` (pgTAP, 21 Assertions): Direction-Mapping-
Golden-Cases, Detection-Idempotenz, der Unique-Constraint-Regressionstest,
Anti-Spam-Transitionserkennung, `fill_signal_outcomes()`-Formel-Konsistenz
(`return_pct`/`hit` gegen echte befüllte Zeilen geprüft, keine Fixtures
nötig), Punkt-in-Zeit-Sicherheit. Alle 21 grün.

Security-Advisor-Fund währenddessen behoben: die 4 neuen
`SECURITY DEFINER`-Funktionen waren über PostgREST für `anon`/
`authenticated` aufrufbar — `EXECUTE` entzogen, sie laufen ausschliesslich
über pg_cron (als `postgres`).

## 8. Aktueller Live-Stand (10.09.2026, informativ — keine Aussage)

414 Zeilen total, 396 bereits befüllt (Rest wartet auf Horizont-Ablauf).
Stichproben sind klein (kürzeste Historie 1 Woche) — **keine
Signifikanzaussage**, das ist Aufgabe der Statistik-Pipeline (Phase 2:
BH-FDR über alle Signale gemeinsam, rolling 90 Tage vs. gesamt).

## 9. Nicht Teil dieser Phase (bewusst zurückgestellt)

- `lib/signalRegistry.ts` (zentrale TS-Liste für UI/Statistik-Pipeline) —
  noch kein Konsument, würde totem Code entsprechen; kommt mit Phase 2/3.
- Statistik-Pipeline (BH-FDR, Decay-Erkennung) — Phase 2.
- KI-Rückblick-Kachel — Phase 3.
- Kern-Engines/Divergenz-Radar/KI-Kacheln als weitere Signal-Gruppen —
  Phase 4, brauchen zusätzliche Vorarbeit (gespeicherte "vorhergesagte
  Richtung" pro Lauf).

## Referenzen

- `DIVERGENCE-PATTERN-BACKTEST_2026-09-05.md` — Ursprung der Horizont-Skala
  und der Fragile-Bullish/Distribution-Warning-Testrichtungen.
- `lib/tradingViewSignal.ts`, `lib/tradingViewSignal.test.ts` — Referenz für
  `tv_infer_signal_direction()`.
- Migrationen: `create_signal_outcomes`, `create_tv_signal_direction_and_detect`,
  `create_detect_warning_pattern_outcomes`, `create_detect_risk_factor_outcomes`,
  `fix_signal_outcomes_unique_constraint`, `fix_detect_functions_conflict_target`,
  `create_fill_signal_outcomes`, `add_signal_outcomes_pgtap_tests`,
  `harden_signal_outcomes_function_grants`.
