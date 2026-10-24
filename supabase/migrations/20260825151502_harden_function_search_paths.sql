-- Exportiert aus supabase_migrations.schema_migrations (20260825151502 harden_function_search_paths)

-- Supabase Security Advisor: alle in dieser Session neu angelegten
-- Funktionen hatten keinen fest gesetzten search_path (Standard-Empfehlung
-- gegen search_path-Hijacking). Kein bekannter Exploit hier, aber billig
-- und korrekt zu beheben.
alter function public.get_market_series(text, timestamptz, int) set search_path = public;
alter function public.get_market_reference_snapshot(text, timestamptz) set search_path = public;
alter function public.get_spot_pressure_summary(timestamptz) set search_path = public;
alter function public.get_spot_pressure_series(timestamptz, int) set search_path = public;
alter function public.get_oi_change_by_exchange(timestamptz) set search_path = public;
