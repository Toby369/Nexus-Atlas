-- Exportiert aus supabase_migrations.schema_migrations (20260910024748 revoke_public_execute_signal_pipeline_functions)


-- Nachbesserung: REVOKE ... FROM anon, authenticated entfernt nur explizite
-- Grants an diese Rollen, nicht den impliziten PUBLIC-Grant, den Postgres
-- jeder neuen Funktion standardmaessig erteilt -- und ueber den anon/
-- authenticated (als Mitglieder von PUBLIC) weiterhin EXECUTE haben.
-- Korrekt ist REVOKE ... FROM PUBLIC.
revoke execute on function public.detect_tradingview_signal_outcomes() from public;
revoke execute on function public.detect_warning_pattern_outcomes() from public;
revoke execute on function public.detect_risk_factor_outcomes() from public;
revoke execute on function public.fill_signal_outcomes() from public;
revoke execute on function public.compute_signal_stats(text) from public;
revoke execute on function public.run_weekly_signal_stats() from public;
