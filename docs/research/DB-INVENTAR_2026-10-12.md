# Datenbank-Inventar (Stand 12.10.2026)

Grundlage für das strukturelle Aufräumen: Welche Tabelle ist wie gross, wer
schreibt sie, und liest die App sie überhaupt? Erhoben nach der Verkleinerung
von 1331 MB auf 459 MB (siehe `research-python/data/archive/README.md`).

**Lesespalten:**
- **App** = Anzahl Dateien in `app/`, `lib/`, `components/`, die die Tabelle direkt per `.from()` abfragen
- **RPC** = von der App aufgerufene SQL-Funktion, die die Tabelle liest
- **Fkt** = Anzahl SQL-Funktionen in `public`, die den Tabellennamen enthalten (inkl. Tests, Pipelines)
- **Upd** = Updates seit dem letzten Statistik-Reset (Mass für Schreiblast)

## A. Von der App genutzt (Kern, bleibt)

| Tabelle | Grösse | Zeilen | App | RPC | Bemerkung |
|---|---|---|---|---|---|
| market_features | 70 MB | 190k | 7 | anchored_vwap, range_check, confluence/regime_score_live | 4,5 Mio. Updates: collect-candles upsertet je Lauf 250 Zeilen × 5 Intervalle |
| candles | 47 MB | 212k | 9 | vwap, pivots, etf, regime_live | 1m auf 14 Tage begrenzt (Cron 40) |
| market_state_matrix | 28 MB | 36k | 4 | regime_score_live | **117 Mio. Updates** – `refresh_market_state_matrix()` schreibt alle 15 Min offenbar die ganze Tabelle neu |
| market_snapshots | 23 MB | 87k | 3 | market_series, funding, oi_change u.a. | wächst ~288 Zeilen/Tag/Börse |
| positioning_signals / _snapshots | 13 + 11 MB | 14k / 56k | 1 / 1 | dashboard_poll_bundle | |
| orderbook_snapshots | 12 MB | 40k | 2 | confluence_score_live | |
| macro_snapshots | 8 MB | 38k | 2 | regime_score_live | |
| market_states | 8 MB | 4,5k | 9 | | |
| news_events | 5 MB | 3,4k | 6 | | 235k Updates |
| spot_market_snapshots | 5 MB | 14k | 1 | spot_pressure_summary | |
| liquidation_events, etf_flows, sentiment_snapshots, spot_volume_buckets, tradingview_signals, divergence_radar_snapshots, onchain_snapshots | je < 2 MB | | ≥ 0 | div. | |
| research_regime_cci_roc_1h, research_regime_score_woe/_tiers, research_regime_signal_stats, research_confluence_signal_stats | < 4 MB | | 0 | regime/confluence live + bh_fdr | Ergebnisse der Wochen-Pipelines |
| Kleinkram (< 200 kB): system_briefings, system_briefing_config, quiz_*, knowledge_base, youtube_*, economic_calendar_events, trade_debate_snapshots, escalation_snapshots, signal_review_snapshots, news_analysis_snapshots, custom_query_runs, checklist_runs, push_subscriptions, signal_stats_results, rate_limit_events | | | ≥ 1 | | |

## B. Nur intern (Input für Pipelines, App liest nicht direkt)

| Tabelle | Grösse | Geschrieben von | Gelesen von | Frage |
|---|---|---|---|---|
| research_regime_signal_activation | 89 MB | Cron 37 (wöchentlich, 7 Runden) | `research_regime_refresh_stats` → woe/tiers → Live-Score | Grösster Brocken. Braucht der Wochen-Refresh wirklich die ganze Historie, oder reicht ein gleitendes Fenster? |
| research_confluence_signal_activation | 27 MB | Cron 36 (wöchentlich) | Confluence-Stats → Live-Score | wie oben |
| research_swing_setup_chain_results | 3,6 MB | Cron 36 | Confluence-Pipeline | |
| research_funding_rate_history | 0,8 MB | Cron 37 | Regime-Pipeline | |
| signal_outcomes | 3,8 MB | Cron 28 + 34 (alle 15 Min, 9 Detektoren) | Cron 29 → signal_stats_results (App) | |
| data_quality | 0,1 MB | Cron 16 (**alle 5 Min**, 615k Updates) | nur Tests | Wird das irgendwo angezeigt? Sonst Cron seltener/weg |

## C. Kandidaten zum Entfernen (App liest nicht, keine Live-Abhängigkeit gefunden)

| Tabelle | Grösse | Geschrieben von | Befund |
|---|---|---|---|
| **backtest_states** | **54 MB** | Cron 18/19/20 (1h alle 15 Min, 4h stündlich, 1d täglich) | Nur `backtest_*`-Auswertungsfunktionen und Research-Exporte lesen. Research-Phase 0–5 (Aug/Sep). Wenn abgeschlossen: Crons stoppen, Tabelle archivieren → −54 MB und weniger Log-Ingestion |
| research_pattern_events | 5,5 MB | einmalig | Nur Triple-Barrier-Aufbau (Tabellen bereits archiviert) |
| research_dc_events | 3,4 MB | einmalig | Keine Funktion, keine App |
| market_commentary | 1 MB | ? (Edge Function prüfen) | Keine Funktion, keine App |
| options_snapshots | 0,6 MB | Cron 11 (alle 30 Min) | App liest nicht direkt; `get_options_iv_rank` wird von der App nicht aufgerufen |
| report_runs / report_configs | 1,2 MB | report-scheduler | Report-Engine laut Commit `bf31eab` entfernt; **Cron 8 läuft weiter alle 5 Min** – inzwischen Taktgeber fürs System-Briefing (`lib/authGate.ts:49`). Prüfen, ob 5 Min nötig sind |
| research_*_results_purged, backtest_model_*, research_leakage_integrity_log, research_test_access_log, research_rsi_reversal_results, handelslage_snapshots, chart_narratives, market_state_narratives, signal_engine_snapshots, chart_vision_analyses | je < 150 kB | einmalig / Edge Functions | App liest nicht (Edge Functions ggf. prüfen) – Platz egal, aber Übersicht |
| **Leer:** nexus_events, news_warning_pushes_sent, escalation_agent_runs, **btc_price_history_daily** (Cron 24 läuft täglich, Tabelle trotzdem leer → Job defekt oder überflüssig) | 0 | | Aufräumen oder reparieren |

Bereits leer (Daten archiviert, Struktur noch da): research_swing_setup_results,
research_triple_barrier_results, research_triple_barrier_context → können samt
Aufbau-Funktionen gedroppt werden, falls nicht mehr gebraucht.

## Cron-Jobs (36 aktiv)

Alle 5 Min (12 / Stunde): 1 collect-btc, 2 collect-positioning, 5 collect-liquidations,
7 collect-spot-pressure, 8 report-scheduler, 10 collect-orderbook, 16 refresh-data-quality,
38 collect-spot-volume-profile.
Alle 15 Min: 3 news-collector, 4 news-analyst, 9 collect-candles, 13 compute-market-state,
18 backtest-1h, 21 market-state-matrix, 23 state-change-push, 28 fill-signal-outcomes,
33 divergence-radar, 34 detect-signal-outcomes (9 Detektoren).
Seltener: 6 etf-flows (4h), 11 options (30 Min), 12 macro (30 Min), 14 sentiment (1h),
19 backtest-4h (1h), 15/20/22/24/26 täglich, 29/30/36/37 wöchentlich,
39/40 Aufräum-Jobs (täglich).

Die Edge-Function-Aufrufe (≈ 9'000 pro Tag) sind die Hauptquelle der
**Log-Ingestion (157 % des Free-Kontingents, noch nicht durchgesetzt)**.

## Hebel, grob nach Wirkung

1. backtest_states + Crons 18/19/20 stoppen → −54 MB, −~100 Läufe/Tag
2. Regime-/Confluence-Activation auf gleitendes Fenster → bis −80 MB, Wachstum gebremst
3. `refresh_market_state_matrix` nur neue Zeilen schreiben statt alles → weniger Bloat/Last
4. 5-Min-Jobs prüfen (data_quality, report-scheduler, Sammler) → weniger Log-Ingestion
5. Leere/tote Tabellen und Funktionen droppen → Übersicht
