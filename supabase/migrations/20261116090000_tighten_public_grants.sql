-- Rechte aufraeumen (Toby 16.11.2026). Bis 30.10.2026 vergab Supabase neuen
-- Tabellen automatisch ALLE Rechte an anon/authenticated. RLS mit reinen
-- Lese-Regeln hat Schreiben schon blockiert; das hier ist die zweite Sicherung
-- (TRUNCATE unterliegt z. B. keiner RLS). Es werden KEINE Daten geloescht.
--
-- Ziel je Tabelle in public:
--   * mit Lese-Policy: anon/authenticated nur SELECT
--   * ohne Policy (Push, Rate-Limit, Nutzungszaehler): keine Rechte
--   * service_role: SELECT, INSERT, UPDATE, DELETE (schreibt serverseitig)
-- Alle Schreibzugriffe der App laufen ueber den Server (lib/supabaseAdmin.ts),
-- geprueft am 16.11.2026.

do $$
declare
  t record;
begin
  for t in
    select c.oid, c.relname,
           exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polcmd in ('r', '*')) as has_read_policy
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  loop
    execute format('revoke all on public.%I from anon, authenticated', t.relname);
    if t.has_read_policy then
      execute format('grant select on public.%I to anon, authenticated', t.relname);
    end if;
    execute format('grant select, insert, update, delete on public.%I to service_role', t.relname);
  end loop;
end $$;

-- Sequenzen braucht nur der Server.
revoke all on all sequences in schema public from anon, authenticated;
grant usage, select on all sequences in schema public to service_role;

-- pgTAP-Hilfsviews (Extension) muss der Browser nicht sehen. Hinweis
-- 16.11.2026: Sie gehoeren supabase_admin, das Revoke als postgres greift
-- darum nicht (Warnung, kein Fehler). Sie zeigen nur Fremdschluessel-
-- Metadaten, keine Daten; ganz weg nur ueber "drop extension pgtap".
revoke all on public.pg_all_foreign_keys, public.tap_funky from anon, authenticated;

-- Wartungs- und Testfunktionen nur fuer Server und Cron (laeuft als postgres),
-- nicht ueber die Data-API ausloesbar. Lese-Funktionen (get_*) bleiben offen.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'downsample_old_snapshots', 'refresh_data_quality', 'refresh_market_state_matrix', '_dq_evaluate',
        'run_core_engine_outcomes_tests', 'run_data_quality_tests', 'run_divergence_radar_outcomes_tests',
        'run_signal_outcomes_tests', 'run_signal_stats_tests'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
