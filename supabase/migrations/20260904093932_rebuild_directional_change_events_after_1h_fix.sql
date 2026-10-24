-- Exportiert aus supabase_migrations.schema_migrations (20260904093932 rebuild_directional_change_events_after_1h_fix)

drop table if exists public.research_dc_events;

create table public.research_dc_events as
select
  'trailing'::text as floor_mode,
  e.event_id, e.direction, e.entry_time, e.entry_price, e.confirm_time, e.confirm_price,
  e.net_move_usd, e.duration_hours,
  bs.factors as pre_event_factors
from research_directional_change_events('1h', 1000, 0.05, 'trailing') e
left join backtest_states bs
  on bs.interval = '1h' and bs.architecture_version = 'experimental_domain_v2_phase4_full_asof'
 and bs.candle_open_time = e.entry_time - interval '1 hour'
union all
select
  'fixed'::text, e.event_id, e.direction, e.entry_time, e.entry_price, e.confirm_time, e.confirm_price,
  e.net_move_usd, e.duration_hours,
  bs.factors
from research_directional_change_events('1h', 1000, 0.05, 'fixed') e
left join backtest_states bs
  on bs.interval = '1h' and bs.architecture_version = 'experimental_domain_v2_phase4_full_asof'
 and bs.candle_open_time = e.entry_time - interval '1 hour';

create index on public.research_dc_events (floor_mode, direction);
