-- Exportiert aus supabase_migrations.schema_migrations (20260910063034 harden_divergence_radar_function_grants_v2)


-- Nachbesserung: REVOKE ... FROM PUBLIC allein reicht nicht -- Supabase
-- vergibt EXECUTE auf neue Funktionen in public offenbar per ALTER DEFAULT
-- PRIVILEGES direkt an anon/authenticated (eigene ACL-Eintraege), nicht nur
-- ueber die PUBLIC-Pseudo-Rolle. Explizit alle drei Varianten entziehen.
revoke execute on function public.detect_spot_pressure_absorption_outcomes() from public, anon, authenticated;
revoke execute on function public.detect_onchain_vs_price_outcomes() from public, anon, authenticated;
revoke execute on function public.detect_rsi_divergence_vs_trend_outcomes() from public, anon, authenticated;
