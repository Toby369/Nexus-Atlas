-- Exportiert aus supabase_migrations.schema_migrations (20260827163815 create_research_test_access_log)


-- Phase 6, Section 2: Testset-Schutz haerten. Ehrliche Einordnung: ein
-- generisches SELECT gegen backtest_states/market_features im TEST-
-- Zeitraum kann auf DB-Ebene nicht vollstaendig technisch verhindert
-- werden, ohne die Tabellen fuer Produktion mit-einzuschraenken (sie
-- werden von compute-market-state und dem Dashboard mitbenutzt). Die
-- bereits existierende, echte technische Sperre ist der is_frozen-Trigger
-- auf backtest_model_runs (Phase 5, verifiziert per Test) -- der bleibt
-- die primaere Schutzmassnahme fuer Modell-KONFIGURATION.
--
-- Zusaetzlich hier: ein Zugriffs-Log, durch das jede legitime,
-- absichtliche Testset-Auswertung nachvollziehbar protokolliert wird,
-- statt sich nur auf Disziplin zu verlassen. Konvention: jede Research-
-- Funktion, die den TEST-Zeitraum auswertet, ruft zuerst
-- research_log_test_access() auf.
create table if not exists public.research_test_access_log (
  id bigserial primary key,
  accessed_at timestamptz not null default now(),
  purpose text not null,
  model_version text,
  caller_note text
);

alter table public.research_test_access_log enable row level security;
create policy "research_test_access_log_select_all" on public.research_test_access_log for select using (true);
revoke all on public.research_test_access_log from anon, authenticated;
grant select on public.research_test_access_log to anon, authenticated, service_role;
grant insert on public.research_test_access_log to service_role;

create or replace function public.research_log_test_access(p_purpose text, p_model_version text default null, p_note text default null)
returns void
language sql
as $$
  insert into public.research_test_access_log (purpose, model_version, caller_note)
  values (p_purpose, p_model_version, p_note);
$$;

revoke all on function public.research_log_test_access(text, text, text) from public, anon, authenticated;
grant execute on function public.research_log_test_access(text, text, text) to service_role;

-- Rueckwirkender Log-Eintrag fuer den in Phase 5 offengelegten, folgenlosen
-- Walk-Forward-Zwischenfall (Fold 5 = TEST-Zeitraum wurde kurz mitberechnet,
-- vor jeder Modelländerung) -- Transparenz auch rueckwirkend, nicht nur ab jetzt.
insert into public.research_test_access_log (accessed_at, purpose, model_version, caller_note)
values (now(), 'Phase 5 Walk-Forward (Fold 5 versehentlich mitberechnet)', 'domain_balanced_v1',
  'Rueckwirkend protokolliert: keine Modellparameter wurden danach veraendert, Modelle waren bereits eingefroren.');
