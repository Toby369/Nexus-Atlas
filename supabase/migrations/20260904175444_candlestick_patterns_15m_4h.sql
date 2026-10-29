-- Exportiert aus supabase_migrations.schema_migrations (20260904175444 candlestick_patterns_15m_4h)


insert into public.research_pattern_events (candle_open_time, interval, pattern_name, direction_expected)
select candle_open_time, '15m', pattern_name, direction_expected
from public.research_detect_candlestick_patterns('15m')
where direction_expected is not null
on conflict do nothing;

insert into public.research_pattern_events (candle_open_time, interval, pattern_name, direction_expected)
select candle_open_time, '4h', pattern_name, direction_expected
from public.research_detect_candlestick_patterns('4h')
where direction_expected is not null
on conflict do nothing;

-- Horizonte konsistent als 4/12/24 Kerzen vorwaerts auf allen Intervallen
-- (dieselbe Regel wie bereits fuer 1h verwendet), Embargo = laengster
-- getesteter Horizont -- vorregistriert vor Ergebnis-Ansicht.
select public.research_evaluate_patterns_purged('15m', array[1,3,6], 0.25);
select public.research_evaluate_patterns_purged('4h', array[16,48,96], 4);
