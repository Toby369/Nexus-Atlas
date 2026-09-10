# Periodischer KI-Rückblick — Phase 5: Divergenz-Radar-Persistenz (10.09.2026)

Schließt die in Phase 4 dokumentierte Lücke: der Divergenz-Radar
(`lib/divergenceRadar.ts`/`divergenceRadarContext.ts`, 8 Paare) wurde bisher
nur live für die Dashboard-Anzeige berechnet, nie gespeichert — ohne
Historie kein Backtest. Diese Phase baut die Persistenz-Schicht und wired
3 der 8 Paare in die bestehende `signal_outcomes`-Pipeline ein.

## 1. Persistenz-Schicht

- `divergence_radar_snapshots`: neue Tabelle, speichert bei jedem Snapshot
  sowohl die 8 fertig berechneten Paar-Status als auch die **Rohwerte**
  (Preis, `overall_state`, TradingView-Richtung, Handelslage-Bias,
  Zyklus-Band, RSI/MACD-Divergenzrichtung) — damit die noch zurückgestellten
  Paare später ohne Schema-Änderung nachgezogen werden können.
- `lib/divergenceRadarContext.ts::buildDivergenceRadar()` liefert jetzt
  zusätzlich zu den bestehenden Feldern diese Rohwerte (rein additiv, keine
  bestehende Nutzung brach dadurch).
- `POST /api/divergence-radar/snapshot`: kein AI-Aufruf, reine
  Momentaufnahme. Auth über `CRON_SECRET` wie die anderen Scheduler-Routen
  (`lib/authGate.ts` ergänzt).
- Edge Function `divergence-radar-scheduler` + `pg_cron` alle 15 Minuten,
  gleiches Muster wie `signal-review-scheduler`.

## 2. Detection: nur 3 von 8 Paaren, bewusst begründet

Anders als bei den bisherigen Phasen hat nicht jedes Paar eine im Code
bereits eindeutig dokumentierte Richtung. Umgesetzt wurden nur die drei,
bei denen die Richtung ohne zusätzliche, nicht im Code begründete Annahme
feststeht:

| Paar | signal_type | Richtung | Begründung |
|---|---|---|---|
| Spot-Pressure-Absorption | `spot_pressure_absorption_bullish/bearish` | = Status selbst | `ABSORPTION_BULLISH/BEARISH` sind bereits per Namenskonvention gerichtet (Code-Kommentar: "Stärke-/Schwäche-Signal") |
| Onchain vs. Preis | `onchain_vs_price_bullish/bearish` | `PRICE_HIGH_SOPR_LOSS`→bearish, `PRICE_LOW_SOPR_PROFIT`→bullish | Direkte Analogie zu den Phase-1-Warn-Mustern (Distribution Warning=bearish, Capitulation=bullish) |
| RSI/MACD-Divergenz vs. Trend | `rsi_divergence_{bullish\|bearish}_{gegentrend\|ohne_gegentrend}` | = eigene Divergenzrichtung | Testet dieselbe Fragestellung wie `METHODIC_DIVERGENCE_2026-08-29.md`/die Structure-vs-Trend-Strength-Auswertung vom 05.09., hier für RSI/MACD statt Struktur |

**Bewusst zurückgestellt** (keine eindeutige Richtung ohne zusätzliche
Annahme): `optionsVsSentiment`, `spotVsFutures`, `cycleVsMomentum`,
`handelslageVsState`, `tradingViewVsState`. Deren Rohwerte werden bereits
mitgespeichert — eine spätere Erweiterung braucht nur neue
Detection-Funktionen, kein Schema-Update.

## 3. Keine Backfill-Historie — bewusst

Anders als Phase 1/4 (die auf bereits seit Wochen laufende Tabellen
`market_states`/`market_state_matrix` zurückgreifen konnten) gibt es für
den Divergenz-Radar **keine Vergangenheit** — er wurde nie gespeichert.
`signal_outcomes` für `category='divergence_radar'` füllt sich erst ab
jetzt, im 15-Minuten-Takt. Erste auswertbare Zellen (Mindeststichprobe
n≥10 in Phase 2) sind frühestens in einigen Tagen zu erwarten.

## 4. Bug gefunden + behoben: Security-Advisor-Grants (dritte Wiederholung)

Wie in Phase 2 und 4 beobachtet, aber diesmal die Ursache abschließend
geklärt: `REVOKE EXECUTE ... FROM PUBLIC` allein reicht nicht. Supabase
vergibt EXECUTE auf neue Funktionen in `public` per `ALTER DEFAULT
PRIVILEGES` **direkt an `anon`/`authenticated`** (eigene ACL-Einträge, nicht
über die PUBLIC-Pseudo-Rolle) — `REVOKE ... FROM PUBLIC` entfernt diese
nicht. Beim Audit dieser Phase stellte sich heraus, dass dadurch auch die
Phase-4-Funktionen (`detect_overall_state_outcomes`,
`detect_regime_matrix_outcomes`) noch offen waren, seit deren letzter
Härtung nur `FROM PUBLIC` verwendet hatte. Endgültiger Fix: immer explizit
`REVOKE ... FROM PUBLIC, ANON, AUTHENTICATED` nach jedem `CREATE OR REPLACE`
einer `SECURITY DEFINER`-Funktion — für alle 5 aktuell betroffenen
Funktionen nachgezogen, Security-Advisor jetzt vollständig sauber (nur noch
projektweite Altlasten unverändert: `push_subscriptions`/`rate_limit_events`
ohne Policy, `function_search_path_mutable` bei 46 Altfunktionen, pgTAP in
public, Leaked-Password-Protection).

## 5. Zweiter Bug gefunden + behoben: Dashboard-Tab-Zuordnung (Phase 3)

Der volle `vitest`-Lauf (bisher in Phase 3 nicht gemacht — nur die direkt
betroffenen Dateien) deckte eine echte Regression aus Phase 3 auf:
`signal-review` wurde zu `DASHBOARD_TILES` hinzugefügt, aber nie einem Tab
in `lib/dashboardTabs.ts` zugeordnet — `assertAllTilesAssigned()` wirft in
diesem Fall zur Build-/Testzeit einen Fehler (verhindert genau dieses stille
Verschwinden einer Kachel). Behoben: `signal-review` im Tab
"KI-Analysen" ergänzt. Lehre: künftig nach JEDER neuen Kachel den vollen
`npx vitest run` laufen lassen, nicht nur die direkt editierten Dateien.

## 6. Tests

`run_divergence_radar_outcomes_tests()` (pgTAP, 9 Assertions, mit
synthetischen Snapshot-Fixtures, da noch keine echte Historie existiert):
Richtungs-Zuordnung für alle 3 Paare, Anti-Spam-Transitionserkennung,
Idempotenz. Räumt seine Fixtures selbst auf. Alle 9 grün, die 21+13+7 aus
Phase 1/2/4 weiterhin grün, voller `vitest`-Lauf grün (bis auf zwei
vorbestehende, netzwerkabhängige Integrationstests, die in dieser Sandbox
keinen Supabase-Zugriff haben — nicht durch diese Phase verursacht).

## Referenzen

- `SIGNAL-REVIEW-PHASE1_2026-09-10.md` … `PHASE4_...`.
- `METHODIC_DIVERGENCE_2026-08-29.md` — Ursprung der Structure-vs-Trend-
  Strength-Hypothese, hier auf RSI/MACD übertragen.
- Migrationen: `create_divergence_radar_snapshots`,
  `schedule_divergence_radar_scheduler`, `create_detect_divergence_radar_outcomes`,
  `add_divergence_radar_detection_to_cron`, `add_divergence_radar_outcomes_pgtap_tests`,
  `harden_divergence_radar_function_grants_v2`, `harden_core_engine_function_grants_v2`.
