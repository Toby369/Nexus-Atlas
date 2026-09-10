# Periodischer KI-Rückblick — Phase 4: Kern-Engines (10.09.2026)

Erweitert die in Phase 1-3 gebaute Pipeline (`signal_outcomes` →
`signal_stats_results` → KI-Kachel) um eine vierte Signal-Gruppe:
**Kern-Engines** — der 14-Faktoren-Gesamtzustand (`market_states.overall_state`)
und das 5-Säulen-Regime (`market_state_matrix.regime`). Beide waren laut Plan
vom 09.09.2026 noch nie gegen echte Preis-Outcomes geprüft.

## 1. Kein Schema-/Pipeline-Umbau nötig

`category`/`signal_type` in `signal_outcomes` sind bewusst offener Text
(keine Enum) — Phase 2 (`compute_signal_stats`) und Phase 3
(`signalReviewContext.ts`) gruppieren generisch über beide Spalten. Diese
Phase brauchte deshalb **nur zwei neue Detection-Funktionen**, keine
Änderung an Schema, Statistik-Pipeline oder KI-Kachel.

## 2. Bug gefunden + behoben: Richtung muss im signal_type stecken

Erster Versuch: `signal_type = 'overall_state'` mit wechselndem
`direction_expected` (bullish/bearish je nach Instanz) — anders als bei
TradingView-Alerts oder Warn-Mustern, wo die Richtung schon im Namen steckt
(`LIQUIDITY_SWEEP_HIGH` ist IMMER bearish). `compute_signal_stats()`
gruppiert aber nach `(category, signal_type, horizon_hours, direction_expected)`,
während die Unique-Constraint auf `signal_stats_results` nur
`(window_label, category, signal_type, horizon_hours)` ist (ohne Richtung)
— ein bullish- und ein bearish-Grüppchen desselben `signal_type` kollidierten
beim Upsert (`ON CONFLICT DO UPDATE command cannot affect row a second time`).

**Fix**: Richtung direkt in `signal_type` kodiert, gleiche Konvention wie
überall sonst — `overall_state_bullish`/`overall_state_bearish`,
`regime_matrix_bullish`/`regime_matrix_bearish`. pgTAP-Regressionstest
(`run_core_engine_outcomes_tests`, Test 6) ruft `compute_signal_stats('90d')`
über `lives_ok()` auf, um genau diesen Fehler künftig sofort zu fangen.

## 3. Scope-Entscheidung: nur eindeutig gerichtete Zustände

- `overall_state`: nur BULLISH/BEARISH feuern ein Signal. NEUTRAL/MIXED/
  INSUFFICIENT_DATA bleiben aussen vor (keine gerichtete Aussage).
- `regime`: nur TREND_EXPANSION_BULLISH/BEARISH. VOLA_SQUEEZE_RANGING/
  UNRESOLVED_NEUTRAL bewusst zurückgestellt — wären Magnitude-Kandidaten
  wie die Risk-Faktoren in Phase 1, aber nicht Teil dieser Phase.

Preis für `regime_matrix`-Signale kommt aus `candles` (Binance BTCUSDT 1H,
`open_time = timestamp_utc`), da `market_state_matrix` selbst keine
Preis-Spalte führt — `market_states` liefert seinen Preis dagegen weiterhin
aus der `factors`-JSONB (wie in Phase 1).

## 4. Ergebnis (10.09.2026, informativ)

369 neue `signal_outcomes`-Zeilen (333 `overall_state`, 36 `regime_matrix`,
jeweils x3 Horizonte). Auffällig: `overall_state_bullish` UND
`overall_state_bearish` liegen in der Trefferquote durchgehend UNTER der
unbedingten Baseline (z.B. bullish/24h: 37,8 % vs. 55,0 % Baseline) — keine
Zelle BH-signifikant, aber konsistent mit jedem bisherigen Befund dieser
Session (kein bislang getestetes Muster hat einen korrigierten Edge).
`regime_matrix` hat noch zu wenig Stichprobe (n=5-7 je Zelle) für jede
Aussage.

## 5. Security-Nachbesserung (wiederkehrendes Muster)

Wie schon in Phase 2 beobachtet: ein `CREATE OR REPLACE FUNCTION` setzt die
Grant-Liste einer Funktion auf den Postgres-Default zurück (PUBLIC EXECUTE)
— der ursprüngliche `REVOKE` aus der ersten Migration ging beim
Bugfix-`CREATE OR REPLACE` verloren, ohne dass das sofort auffiel. Security-
Advisor hat es erneut aufgedeckt, erneut per `REVOKE ... FROM PUBLIC`
behoben. Merke für künftige Phasen: nach JEDEM `CREATE OR REPLACE` einer
`SECURITY DEFINER`-Funktion den Advisor erneut prüfen, nicht nur beim
ersten Erstellen.

## 6. Tests

`run_core_engine_outcomes_tests()` (pgTAP, 7 Assertions): Idempotenz,
Richtungs-Kodierung im `signal_type` (Regressionstest für den ON-CONFLICT-
Bug), Anti-Spam-Transitionserkennung, `compute_signal_stats()`-Regressionstest,
kein NULL-Preis bei `regime_matrix`. Alle 7 grün, die 21+13 Tests aus
Phase 1/2 weiterhin grün.

## 7. Weiterhin nicht Teil der Pipeline

- **Marktkontext-Bias** (`lib/marketContext.ts`, Preis/OI/Spot-Flow) — wird
  aktuell NUR live für die Dashboard-Anzeige berechnet, nirgends persistiert.
  Bräuchte eine neue Snapshot-Tabelle, bevor eine Historie zum Backtesten
  existiert.
- **Divergenz-Radar** (7 Paare, `lib/divergenceRadar.ts`) — dieselbe Lücke:
  reine, DB-freie Funktionen, die bei jedem Seitenaufruf frisch berechnet
  werden, keine Historie.
- **KI-Kacheln** (Trade-Debate, Handelslage, YouTube-Konsens, Reports) —
  brauchen zusätzlich eine strukturiert gespeicherte "vorhergesagte
  Richtung" pro Lauf, die aktuell nicht existiert.

Alle drei bräuchten als Vorarbeit eine neue Persistenz-Schicht (regelmäßiger
Cron, der den jeweiligen Live-Zustand snapshotet) — das ist der nächste
sinnvolle Schritt, falls diese Gruppen ebenfalls in den Rückblick sollen.

## Referenzen

- `SIGNAL-REVIEW-PHASE1_2026-09-10.md`, `..._PHASE2_...`, `..._PHASE3_...`.
- Migrationen: `create_detect_core_engine_outcomes`,
  `fix_core_engine_signal_type_direction_split`,
  `add_core_engine_detection_to_cron`, `add_core_engine_outcomes_pgtap_tests`,
  `fix_core_engine_outcomes_tests_plan_count`, `reharden_core_engine_function_grants`.
