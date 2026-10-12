# DB aufräumen — SQL-Blöcke für den Supabase-Editor (12.10.2026)

Grundlage sind Tobys Entscheide vom 12.10.2026 (Abschnitt "Phase 7" in
`NEXUS-STRUKTUR-KONZEPT_2026-09-12.md`) und das Inventar
`DB-INVENTAR_2026-10-12.md` der Session "Nexus Atlas auf unter 500 MB". Die Zahlen sind
live und read-only geprüft am 12.10.2026: DB 460 MB bei 500 MB Free-Limit.

**So ausführen:** Supabase → SQL Editor. Jeden Block einzeln ausführen, `VACUUM` immer als
eigene Abfrage (läuft nicht in einer Transaktion). Die Reihenfolge ist wichtig: zuerst
exportieren, dann löschen.

**Was bleibt (bewusst nicht angefasst):** `options_snapshots` (speist den Options-Faktor
von compute-market-state), `research_swing_setup_chain_results` und alle
`research_confluence_*`/`research_regime_*`-Tabellen (wöchentliche Score-Pipelines, Jobs
36/37), `market_state_matrix` (Kachel Marktphase), `data_quality`, `escalation_snapshots`.

---

## Block 0 — Export (vor allem Löschen) ✅ erledigt

Die Session "Nexus Atlas auf unter 500 MB" hat am 12.10. um 13:15 UTC alle Tabellen mit
Inhalt aus Block 4 und 5 exportiert und die Zeilenzahlen gegen die DB geprüft. Ablage:
`research-python/data/archive/phase7/` (Branch `ccr-99ba062e-i15rwe`, PR #11). Nicht
exportiert wurden nur Tabellen, die schon leer sind.

- Die Tabellen aus Block 5 haben den Stand von 13:15 UTC. Kommen bis zum Drop noch Zeilen
  dazu, vorher kurz neu exportieren.
- Die Screenshots zu `chart_vision_analyses` liegen im Storage-Bucket
  `chart-vision-screenshots` und gehören nicht zum Archiv. Ob der Bucket mit wegsoll, ist
  noch offen.

## Block 1 — Cron-Jobs

```sql
-- Backtest-Rekonstruktion: schreibt nur in backtest_states, die App liest sie nicht
select cron.unschedule(18);  -- backtest-reconstruct-1h-states-v2 (*/15)
select cron.unschedule(19);  -- backtest-reconstruct-4h-states-v2 (stündlich)
select cron.unschedule(20);  -- backtest-reconstruct-1d-states-v2 (täglich)

-- Kurs-Historie (CoinGecko): Tabelle seit Start leer, es fehlt ein API-Key
select cron.unschedule(24);  -- collect-btc-price-history-daily

-- Datenqualität: stündlich statt alle 5 Minuten (bisher 615'000 Updates auf 46 Zeilen)
select cron.alter_job(16, schedule := '7 * * * *');

-- Briefing-Taktgeber: alle 15 statt 5 Minuten. Sicher, weil der report-scheduler
-- (Version vom 12.10.) eine geplante Uhrzeit bis 20 Minuten lang nachholt und
-- doppelte Läufe selbst verhindert. Der Jobname behält "every-5-min".
select cron.alter_job(8, schedule := '*/15 * * * *');
```

Optional: Die Edge Function `collect-btc-price-history-daily` kann danach im Dashboard
gelöscht werden (Edge Functions → … → Delete).

## Block 2 — Briefing-Zeiten auf Viertelstunden

Die App lässt ab diesem PR nur noch :00/:15/:30/:45 zu. Die bestehenden Zeiten werden auf
die nächste Viertelstunde gerundet: 06:35 → 06:30, 10:15 bleibt, 16:10 → 16:15,
23:10 → 23:15.

```sql
update public.system_briefing_config
set schedule_times = array['06:30','10:15','16:15','23:15']::time[],
    updated_at = now()
where id = 1;
```

## Block 3 — Marktphase inkrementell

`refresh_market_state_matrix()` schrieb alle 15 Minuten **alle** ~36'000 Zeilen neu
(117 Mio. Updates seit Juli). Neu werden nur noch die letzten 2 Tage geschrieben. Die
Berechnung über die ganze Serie bleibt, damit SMA200 & Co. korrekt sind. Für einen
vollen Neuaufbau ruft man `select public.refresh_market_state_matrix(p_lookback := null);`
auf.

```sql
drop function public.refresh_market_state_matrix(text, text, text);

create function public.refresh_market_state_matrix(
  p_symbol text default 'BTCUSDT',
  p_interval text default '1h',
  p_exchange text default 'binance',
  p_lookback interval default interval '2 days'
)
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare
  v_count integer;
  v_since timestamptz;
begin
  -- Nur die juengsten Zeilen neu schreiben; p_lookback = null -> alles.
  if p_lookback is not null then
    select max(m.timestamp_utc) - p_lookback into v_since
    from public.market_state_matrix m
    where m.symbol = p_symbol and m.interval = p_interval;
  end if;

  insert into public.market_state_matrix (
    timestamp_utc, symbol, interval,
    adx_14, plus_di, minus_di, linreg_slope, linreg_r2,
    garman_klass_vol, bb_width, bb_percent_b, atr_ratio,
    rsi_14, dist_zscore_sma20, dist_zscore_sma50, dist_zscore_sma200,
    funding_zscore, price_change_pct, oi_change_pct, oi_price_quadrant, cvd_zscore,
    liq_cluster_density, net_taker_flow_ratio,
    regime, data_coverage_pct
  )
  select
    s.timestamp_utc, p_symbol, p_interval,
    s.adx_14, s.plus_di, s.minus_di, s.linreg_slope, s.linreg_r2,
    s.garman_klass_vol, s.bb_width, s.bb_percent_b, s.atr_ratio,
    s.rsi_14, s.dist_zscore_sma20, s.dist_zscore_sma50, s.dist_zscore_sma200,
    s.funding_zscore, s.price_change_pct, s.oi_change_pct, s.oi_price_quadrant, s.cvd_zscore,
    s.liq_cluster_density, s.net_taker_flow_ratio,
    s.regime, s.data_coverage_pct
  from public.compute_market_state_matrix_series(p_symbol, p_interval, p_exchange) s
  where v_since is null or s.timestamp_utc >= v_since
  on conflict (timestamp_utc, symbol, interval) do update set
    adx_14 = excluded.adx_14, plus_di = excluded.plus_di, minus_di = excluded.minus_di,
    linreg_slope = excluded.linreg_slope, linreg_r2 = excluded.linreg_r2,
    garman_klass_vol = excluded.garman_klass_vol, bb_width = excluded.bb_width,
    bb_percent_b = excluded.bb_percent_b, atr_ratio = excluded.atr_ratio,
    rsi_14 = excluded.rsi_14, dist_zscore_sma20 = excluded.dist_zscore_sma20,
    dist_zscore_sma50 = excluded.dist_zscore_sma50, dist_zscore_sma200 = excluded.dist_zscore_sma200,
    funding_zscore = excluded.funding_zscore, price_change_pct = excluded.price_change_pct,
    oi_change_pct = excluded.oi_change_pct, oi_price_quadrant = excluded.oi_price_quadrant,
    cvd_zscore = excluded.cvd_zscore, liq_cluster_density = excluded.liq_cluster_density,
    net_taker_flow_ratio = excluded.net_taker_flow_ratio, regime = excluded.regime,
    data_coverage_pct = excluded.data_coverage_pct;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- Kontrolle: sollte ~50 (2 Tage 1h-Kerzen) statt ~36'000 liefern
select public.refresh_market_state_matrix();
```

Job 21 ruft die Funktion ohne Argumente auf und braucht keine Änderung.

## Block 4 — Altlasten: Tabellen und verwaiste Funktionen

Keine dieser Tabellen wird von der App gelesen. Die Funktionen sind Backtest- und
Einmal-Forschungsläufe, die nach Block 1 von keinem Cron-Job, keiner anderen live
genutzten Funktion und keinem App-RPC mehr aufgerufen werden (live geprüft).

```sql
-- Funktionen zuerst (PL/pgSQL-Funktionen halten Tabellen nicht fest)
drop function if exists
  public.backtest_reconstruct_1h_states(timestamptz, timestamptz),
  public.backtest_reconstruct_1h_states_v2(timestamptz, timestamptz),
  public.backtest_reconstruct_states_v2(text, timestamptz, timestamptz),
  public.backtest_hit_rate_by_horizon(integer[], text, text),
  public.backtest_hit_rate_by_confidence(integer[], text, text),
  public.backtest_confidence_buckets(text, text[]),
  public.backtest_populate_model_results(text),
  public.research_factor_coverage(boolean),
  public.research_evaluate_nonoverlap_7d(text, text, integer),
  public.research_evaluate_purged(text, text, integer),
  public.research_evaluate_patterns_purged(text, integer[], numeric),
  public.research_bh_fdr(numeric),
  public.research_bh_fdr_patterns(numeric),
  public.research_build_triple_barrier_context(timestamptz, timestamptz),
  public.research_update_momentum_confirmed(timestamptz, timestamptz),
  public.research_log_test_access(text, text, text),
  public.run_backtest_reconstruction_tests(),
  public.run_backtest_hit_rate_tests(),
  public.run_lookahead_protection_tests(),
  public.run_multi_interval_backtest_tests(),
  public.run_model_d_tests(),
  public.run_phase1_validation_integrity_tests(),
  public.run_phase5_calibration_tests(),
  public.run_research_coverage_tests();

-- Backtest-Rekonstruktion (54 MB) und Modell-Läufe
drop table if exists
  public.backtest_states,
  public.backtest_model_results,
  public.backtest_model_runs;          -- Trigger prevent_frozen_model_update fällt mit
drop function if exists public.prevent_frozen_model_update();

-- Einmal-Forschung (abgeschlossene Studien, Ergebnisse stehen in docs/research/)
drop table if exists
  public.research_pattern_events,
  public.research_dc_events,
  public.research_swing_setup_results,
  public.research_triple_barrier_results,
  public.research_triple_barrier_context,
  public.research_pattern_results_purged,
  public.research_model_results_purged,
  public.research_leakage_integrity_log,
  public.research_test_access_log;

-- Reste früher entfernter Funktionen
drop table if exists
  public.market_commentary,            -- still seit 28.08.2026
  public.handelslage_snapshots,
  public.chart_narratives,
  public.market_state_narratives,
  public.signal_engine_snapshots,
  public.chart_vision_analyses,
  public.nexus_events,
  public.news_warning_pushes_sent,
  public.escalation_agent_runs,        -- leer; die Eskalation nutzt escalation_snapshots
  public.btc_price_history_daily;      -- leer, Job 24 in Block 1 entfernt
```

Falls ein `drop function` mit "does not exist" auf eine andere Signatur hinweist: Die
Signatur mit `select oid::regprocedure from pg_proc where proname = '<name>';` prüfen
und anpassen. Falls ein `drop table` wegen einer Abhängigkeit scheitert, die Meldung
schicken. Kein `cascade` ohne Prüfung.

## Block 5 — Nach dem Deploy dieses PRs

Erst ausführen, wenn der PR gemergt und auf Vercel live ist. Sonst lädt die alte App-Version
noch aus diesen Tabellen.

```sql
drop table if exists
  public.custom_query_runs,            -- Freie Anfrage (1 Lauf in 30 Tagen)
  public.news_analysis_snapshots,      -- KI-News-Einordnung (5)
  public.youtube_overall_analyses,     -- YouTube-Gesamtanalyse (2)
  public.report_runs,                  -- AI Report Engine, letzter Lauf 12.10. 04:35 UTC
  public.report_configs;
```

`report_runs`: Der Scheduler hat bis heute früh noch Report-Läufe geschrieben. Die neue
Version der Edge Function `report-scheduler` vom 12.10. (08:25 UTC) startet nur noch das
System-Briefing, seither kommt nichts mehr dazu. Die App liest beide Tabellen nicht.
Vorher exportieren (Block 0).

## Block 6 — Platz freigeben (je als eigene Abfrage)

`DROP TABLE` gibt den Platz sofort frei. `market_state_matrix` ist durch die vielen
Updates aufgebläht; nach Block 3 einmal kompaktieren:

```sql
vacuum full public.market_state_matrix;
```

```sql
vacuum full public.data_quality;
```

Kontrolle:

```sql
select pg_size_pretty(pg_database_size(current_database()));
```

Erwartung: etwa −70 MB aus den Drops (davon backtest_states 54 MB) plus das, was
`vacuum full` aus `market_state_matrix` holt. Die grossen Brocken
`research_regime_signal_activation` (89 MB) und `market_features` (70 MB) behandelt die
500-MB-Session separat.
