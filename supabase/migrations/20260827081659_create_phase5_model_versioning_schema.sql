-- Exportiert aus supabase_migrations.schema_migrations (20260827081659 create_phase5_model_versioning_schema)


-- Phase 5: Model-Versioning-Schema. Rein additiv -- ruehrt backtest_states,
-- market_states, compute-market-state nicht an. Jede Backtest-Auswertung
-- referenziert ab jetzt eine model_run-Zeile mit vollstaendigen Metadaten,
-- damit jederzeit nachvollziehbar ist: mit welcher Engine, welchem Split,
-- welcher Konfiguration wurde dieses Ergebnis erzeugt.
create table if not exists public.backtest_model_runs (
  id bigserial primary key,
  model_version text not null unique,       -- z.B. 'baseline_v1', 'domain_balanced_v1', 'calibrated_v1'
  model_family text not null,               -- 'baseline' | 'domain_balanced' | 'calibrated'
  description text not null,
  interval text not null,
  train_start date not null,
  train_end date not null,
  validation_start date not null,
  validation_end date not null,
  test_start date not null,
  test_end date not null,
  factor_config jsonb not null default '{}'::jsonb,   -- welche Faktoren/Schwellen verwendet wurden
  domain_config jsonb not null default '{}'::jsonb,   -- Domain-Zuordnung, falls domain-basiert
  weights jsonb not null default '{}'::jsonb,         -- gelernte/verwendete Gewichte, leer bei Baseline
  trained_on text not null default 'none' check (trained_on in ('none','train','train+validation')),
  is_frozen boolean not null default false,           -- true = darf nach Erstellung nicht mehr veraendert werden
  created_at timestamptz not null default now()
);

alter table public.backtest_model_runs enable row level security;
create policy "backtest_model_runs_select_all" on public.backtest_model_runs for select using (true);
revoke all on public.backtest_model_runs from anon, authenticated;
grant select on public.backtest_model_runs to anon, authenticated, service_role;
grant insert, update on public.backtest_model_runs to service_role;

-- Verhindert nachtraegliche Veraenderung eingefrorener Modelle (z.B.
-- Baseline) auf DB-Ebene, nicht nur per Konvention -- direkte technische
-- Durchsetzung der "Baseline darf nicht veraendert werden"-Vorgabe.
create or replace function public.prevent_frozen_model_update()
returns trigger
language plpgsql
as $$
begin
  if old.is_frozen then
    raise exception 'backtest_model_runs: model_version % ist eingefroren (is_frozen=true) und darf nicht mehr geaendert werden', old.model_version;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_frozen_model_update on public.backtest_model_runs;
create trigger trg_prevent_frozen_model_update
  before update on public.backtest_model_runs
  for each row execute function public.prevent_frozen_model_update();

-- Ergebnis-Metriken pro Modell x Split x Horizont x Richtung -- die
-- eigentlichen Auswertungszahlen (Edge, Hit-Rate, Returns), damit jede
-- Zahl im Abschlussbericht auf eine gespeicherte, reproduzierbare Zeile
-- zurueckfuehrbar ist statt nur aus einer Ad-hoc-Abfrage zu stammen.
create table if not exists public.backtest_model_results (
  id bigserial primary key,
  model_version text not null references public.backtest_model_runs(model_version),
  split text not null check (split in ('train','validation','test')),
  direction text not null check (direction in ('BULLISH','BEARISH')),
  horizon_hours integer not null,
  n integer not null,
  hit_rate_pct numeric,
  baseline_hit_rate_pct numeric,
  edge_vs_baseline_pp numeric,
  mean_forward_return_pct numeric,
  median_forward_return_pct numeric,
  computed_at timestamptz not null default now(),
  unique (model_version, split, direction, horizon_hours)
);

alter table public.backtest_model_results enable row level security;
create policy "backtest_model_results_select_all" on public.backtest_model_results for select using (true);
revoke all on public.backtest_model_results from anon, authenticated;
grant select on public.backtest_model_results to anon, authenticated, service_role;
grant insert on public.backtest_model_results to service_role;
