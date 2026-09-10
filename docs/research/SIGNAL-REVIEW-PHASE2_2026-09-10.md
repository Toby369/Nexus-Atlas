# Periodischer KI-Rückblick — Phase 2: Statistik-Pipeline (10.09.2026)

Aufbauend auf Phase 1 (`SIGNAL-REVIEW-PHASE1_2026-09-10.md`, signal_outcomes
mit TradingView-Alerts + Warn-Muster/Risk-Faktoren): eine woechentliche,
automatisierte Statistik-Pipeline, die Trefferquote/Baseline/statistische
Signifikanz je Signal berechnet — **kein UI, keine KI-Kachel** (Phase 3).

## 1. Zwei getrennte Fenster statt eines

`signal_stats_results` wird für **"90d"** (rollierende letzte 90 Tage) und
**"all"** (gesamte Historie) getrennt befüllt — macht Signal-Verfall
sichtbar (Recherche-Ergebnis vom 09.09.: Rolling-Hit-Rate + Decay-Erkennung
ist branchenüblich für genau diese Aufgabe). Jeder wöchentliche Lauf
ersetzt (Upsert) den Stand je Zelle komplett; anders als
`research_pattern_results_purged` (kumulative FDR über alle je gelaufenen
akademischen Backtests, um manuelles "FDR-Shopping" zu verhindern) ist das
hier eine automatisierte Routine über immer dieselben festen Zellen — die
BH-FDR-Korrektur läuft deshalb frisch pro Lauf/Fenster, nicht kumulativ
über vergangene Wochen.

## 2. Zwei Testarten, je nach `direction_expected`

- **directional** (Signal hat eine Richtung): Trefferquote vs. unbedingte
  Baseline-Richtungswahrscheinlichkeit (Normalapproximation, `z = (p̂-p₀)/
  √(p₀(1-p₀)/n)`, `raw_p_value` über das bereits bestehende
  `research_norm_cdf()` — dieselbe Methodik wie `research_bh_fdr_patterns`,
  hier wiederverwendet statt neu erfunden).
- **magnitude** (Signal ist eine reine Risiko-/Volatilitäts-Flag ohne
  Richtung, z. B. `low_mtf_alignment`, `elevated_volatility`,
  `warning_pattern`): Ø|Preisbewegung| vs. Baseline-Volatilität desselben
  Horizonts, One-Sample-Z-Test mit der Baseline-Streuung als
  Populationsschätzer (die Baseline-Stichprobe ist um Größenordnungen
  größer als jede Signal-Gruppe).

Baseline für beide: `signal_baseline_stats()` — für jede 1H-Kerze im
gewählten Fenster wird dieselbe punkt-in-Zeit-sichere "nächste
abgeschlossene Kerze ab genau horizon_hours später"-Logik wie
`fill_signal_outcomes()` angewendet (gleiche Quelle, gleicher Mechanismus,
nur ohne Signal-Bedingung — Signal-Ergebnis und Baseline sind dadurch
methodisch direkt vergleichbar).

## 3. Sorgfalts-Leitplanke: Mindeststichprobe

`MIN_N = 10`. Zellen darunter bleiben ohne `raw_p_value`/`rank`/
`bh_critical_value`/`significant_after_bh` (NULL) — "keine Aussage" statt
einer aus zu wenig Daten erfundenen Überzeugung, exakt die
Sorgfalts-Leitplanke aus dem am 09.09. freigegebenen Plan. Bei der
aktuellen, noch jungen Historie (seit 26.08./03.09.2026) betrifft das die
Mehrheit der TradingView-Alert-Typen (kleine Stichproben je Typ) sowie
Distribution Warning/Capitulation/Short Squeeze.

## 4. Erster Lauf (10.09.2026, informativ)

144 Zellen (72 pro Fenster: 24 Signal×Horizont-Kombinationen). Von den
Zellen mit n≥10: durchgehend **kein einziger Fund übersteht die BH-FDR-
Korrektur in beiden Fenstern gleichzeitig** — `LIQUIDITY_SWEEP_HIGH`/24h
ist im 90d-Fenster knapp signifikant (p=0.0022 < kritisch 0.0033), im
all-Fenster aber nicht mehr (p=0.0045 > kritisch 0.0033) — genau die Art
von fragilem, nicht robustem Fund, den die Pipeline korrekt nicht als
gesichert ausweist. Konsistent mit jedem bisherigen Backtest dieser
Session: kein bisher getestetes Muster hat einen Multiple-Testing-
korrigierten Edge.

**SUPPORTED, nicht PROVEN, dass (noch) kein Edge nachweisbar ist** — die
Stichproben sind mit 1-2 Wochen Historie strukturell klein; das ist Aufgabe
der Zeit, nicht der Methodik.

## 5. Schema

- `signal_stats_results`: ein Datensatz pro (window_label, category,
  signal_type, horizon_hours), RLS aktiv, "Public read access".
- `signal_baseline_stats(horizon_hours, window)`: SQL-Funktion, gibt
  Richtungswahrscheinlichkeiten + Ø/Streuung der absoluten Bewegung zurück.
- `compute_signal_stats(window)`: aggregiert signal_outcomes, berechnet
  beide Testarten, upserted + BH-FDR pro Fenster. `run_weekly_signal_stats()`
  ruft beide Fenster auf, Cron `weekly-signal-stats` (Montag 05:00 UTC).

Beide neuen `SECURITY DEFINER`-Funktionen (`compute_signal_stats`,
`run_weekly_signal_stats`) sowie die vier Phase-1-Funktionen hatten
zunächst noch einen impliziten `PUBLIC`-EXECUTE-Grant (Postgres-Default für
neue Funktionen) — `REVOKE ... FROM anon, authenticated` allein entfernt
das NICHT, da beide Rollen über `PUBLIC` weiterhin Zugriff erben. Korrigiert
per `REVOKE ... FROM PUBLIC`; jetzt nur noch `postgres` (pg_cron) und
`service_role` ausführungsberechtigt.

## 6. Tests

`run_signal_stats_tests()` (pgTAP, 13 Assertions): Baseline-Sanity,
Fenster-Vollständigkeit, Idempotenz, Mindeststichprobe-Guard, test_type/
Spalten-Konsistenz, BH-FDR-Formel-Konsistenz, `significant_after_bh`-
Konsistenz, Fenster-Validierung. Alle 13 grün, alle 21 Phase-1-Tests
weiterhin grün.

## 7. Nicht Teil dieser Phase

- KI-Rückblick-Kachel (liest ausschliesslich `signal_stats_results`,
  erfindet keine eigene Bewertung) — Phase 3.
- Kern-Engines/Divergenz-Radar/KI-Kacheln als weitere Signal-Gruppen in
  `signal_outcomes` — Phase 4.

## Referenzen

- `SIGNAL-REVIEW-PHASE1_2026-09-10.md` — signal_outcomes, Direction-Mapping,
  Detection/Backfill.
- `research_norm_cdf`, `research_bh_fdr_patterns` — wiederverwendete
  bestehende Statistik-Infrastruktur.
- Migrationen: `create_signal_stats_results`, `create_signal_baseline_stats`,
  `create_compute_signal_stats`, `fix_compute_signal_stats_numeric_cast`,
  `add_signal_stats_pgtap_tests`, `revoke_public_execute_signal_pipeline_functions`.
