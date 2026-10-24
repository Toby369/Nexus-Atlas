-- Exportiert aus supabase_migrations.schema_migrations (20260910032606 reharden_core_engine_function_grants)


-- Wie schon in Phase 2 beobachtet: CREATE OR REPLACE FUNCTION setzt die
-- ACL auf den Postgres-Default (PUBLIC EXECUTE) zurueck -- der urspruengliche
-- REVOKE aus create_detect_core_engine_outcomes ging beim naechsten
-- CREATE OR REPLACE (fix_core_engine_signal_type_direction_split) verloren,
-- ohne dass der Security-Advisor zwischenzeitlich erneut geprueft wurde.
-- Erneut entziehen, dieses Mal direkt FROM PUBLIC (nicht nur anon/authenticated).
revoke execute on function public.detect_overall_state_outcomes() from public;
revoke execute on function public.detect_regime_matrix_outcomes() from public;
