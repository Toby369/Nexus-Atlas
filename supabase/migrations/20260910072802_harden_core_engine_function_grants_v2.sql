-- Exportiert aus supabase_migrations.schema_migrations (20260910072802 harden_core_engine_function_grants_v2)


-- Root-Cause endlich vollstaendig verstanden: Supabase vergibt EXECUTE auf
-- neue Funktionen in public per ALTER DEFAULT PRIVILEGES direkt an
-- anon/authenticated (eigene ACL-Eintraege, NICHT ueber die PUBLIC-
-- Pseudo-Rolle) -- "REVOKE ... FROM PUBLIC" allein greift deshalb nicht.
-- Diese beiden Funktionen (Phase 4) waren davon noch betroffen, weil ihre
-- letzte Haertung nur "FROM PUBLIC" verwendete. Endgueltiger Fix: immer
-- alle drei Varianten (public, anon, authenticated) explizit entziehen.
revoke execute on function public.detect_overall_state_outcomes() from public, anon, authenticated;
revoke execute on function public.detect_regime_matrix_outcomes() from public, anon, authenticated;
