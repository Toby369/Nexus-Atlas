-- Speicherplatz (Toby 29.10.2026): DB bei ~0,445 von 0,5 GB (Free-Plan), +2-3 MB/Tag.
--
-- 1. Setup-Score (Confluence) und Regime-Score entfallen: die woechentlichen
--    Forschungs-Pipelines und ihre Tabellen (~125 MB, v.a. die
--    *_signal_activation-Historie) werden entfernt. Keine anderen Funktionen
--    oder Views haengen daran (geprueft per pg_proc/pg_views am 29.10.2026).
--    Die Kachel "Marktphase" (market_state_matrix) ist davon NICHT betroffen.
select cron.unschedule('confluence-score-pipeline-weekly')
where exists (select 1 from cron.job where jobname = 'confluence-score-pipeline-weekly');
select cron.unschedule('regime-score-pipeline-weekly')
where exists (select 1 from cron.job where jobname = 'regime-score-pipeline-weekly');

do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'research\_confluence\_%' or p.proname like 'research\_regime\_%')
  loop
    execute format('drop function %s', f);
  end loop;
end $$;

drop table if exists
  public.research_regime_signal_activation,
  public.research_confluence_signal_activation,
  public.research_regime_signal_stats,
  public.research_confluence_signal_stats,
  public.research_regime_score_woe,
  public.research_confluence_score_woe,
  public.research_regime_score_tiers,
  public.research_confluence_score_tiers,
  public.research_regime_cci_roc_1h,
  public.research_funding_rate_history;

-- 2. Snapshots: downsample_old_snapshots() verdichtet ab 35 Tagen auf einen
--    Wert pro Stunde; ab 90 Tagen wird jetzt geloescht. Kein Live-Feature liest
--    weiter als 30 Tage zurueck (laengster Zeitraum 1M, Datenqualitaet 14 Tage).
create or replace function public.purge_old_snapshots(p_keep interval default '90 days')
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_cutoff timestamptz := now() - p_keep;
  v_result jsonb := '{}'::jsonb;
  v_n bigint;
begin
  delete from market_snapshots where timestamp_utc < v_cutoff;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('market_snapshots', v_n);
  delete from positioning_snapshots where timestamp_utc < v_cutoff;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('positioning_snapshots', v_n);
  delete from positioning_signals where timestamp_utc < v_cutoff;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('positioning_signals', v_n);
  delete from orderbook_snapshots where timestamp_utc < v_cutoff;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('orderbook_snapshots', v_n);
  delete from macro_snapshots where timestamp_utc < v_cutoff;
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('macro_snapshots', v_n);
  return v_result;
end $$;

revoke all on function public.purge_old_snapshots(interval) from public, anon, authenticated;

select cron.schedule('purge-old-snapshots-daily', '47 3 * * *', 'select public.purge_old_snapshots();');

-- 3. Cron-Protokoll (12 MB bei 7 Tagen) nur noch 3 Tage behalten.
select cron.schedule('purge-cron-history-daily', '17 3 * * *',
  $c$delete from cron.job_run_details where end_time < now() - interval '3 days'$c$);
