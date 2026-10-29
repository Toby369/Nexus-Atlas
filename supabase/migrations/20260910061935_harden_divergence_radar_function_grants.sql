-- Exportiert aus supabase_migrations.schema_migrations (20260910061935 harden_divergence_radar_function_grants)


revoke execute on function public.detect_spot_pressure_absorption_outcomes() from public;
revoke execute on function public.detect_onchain_vs_price_outcomes() from public;
revoke execute on function public.detect_rsi_divergence_vs_trend_outcomes() from public;
