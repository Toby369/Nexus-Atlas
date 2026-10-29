-- News nur 30 Tage behalten (Toby 29.10.2026). Alle Leser schauen hoechstens
-- 72 h zurueck (Briefing, Bericht, News-Kachel, ETF-Panel, CPI/FOMC-Ergebnis).
-- Haengt an purge_old_snapshots() (taeglich 03:47) statt an einem eigenen Job.
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
  delete from news_events where published_at < now() - interval '30 days';
  get diagnostics v_n = row_count; v_result := v_result || jsonb_build_object('news_events', v_n);
  return v_result;
end $$;

revoke all on function public.purge_old_snapshots(interval) from public, anon, authenticated;
