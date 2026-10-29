-- Exportiert aus supabase_migrations.schema_migrations (20260911183935 create_confluence_stats_engine)

-- Wilson-Konfidenzintervall (95% Default), CONFLUENCE-SCORE-PROTOCOL_2026-09-11.md Abschnitt 4.
create or replace function research_wilson_ci(p_x integer, p_n integer, p_z numeric default 1.959963985)
returns table(lower numeric, upper numeric)
language sql immutable as $$
  with base as (
    select p_x::numeric / nullif(p_n,0) as phat
  )
  select
    case when p_n = 0 then null else
      (phat + p_z^2/(2*p_n) - p_z*sqrt(phat*(1-phat)/p_n + p_z^2/(4*p_n^2))) / (1 + p_z^2/p_n)
    end,
    case when p_n = 0 then null else
      (phat + p_z^2/(2*p_n) + p_z*sqrt(phat*(1-phat)/p_n + p_z^2/(4*p_n^2))) / (1 + p_z^2/p_n)
    end
  from base;
$$;

-- Zweiproportion-Z-Test (ungepoolter Stichprobenvergleich, nicht gegen fixen Baseline-Wert
-- wie research_bh_fdr) -- CONFLUENCE-SCORE-PROTOCOL_2026-09-11.md Abschnitt 4, exakte Formel
-- dort vorregistriert.
create or replace function research_two_proportion_ztest(p_x1 integer, p_n1 integer, p_x2 integer, p_n2 integer)
returns table(p1 numeric, p2 numeric, z_score numeric, raw_p_value numeric)
language sql immutable as $$
  with base as (
    select
      p_x1::numeric / nullif(p_n1,0) as phat1,
      p_x2::numeric / nullif(p_n2,0) as phat2,
      (p_x1 + p_x2)::numeric / nullif(p_n1 + p_n2, 0) as pbar
  )
  select
    phat1, phat2,
    (phat1 - phat2) / sqrt(nullif(pbar*(1-pbar)*(1.0/p_n1 + 1.0/p_n2), 0)) as z,
    2 * (1 - public.research_norm_cdf(abs((phat1 - phat2) / sqrt(nullif(pbar*(1-pbar)*(1.0/p_n1 + 1.0/p_n2), 0)))))
  from base;
$$;

-- Ergebnis-Tabelle: deckt Einzelsignale (Abschnitt 2-4), Paare Variante A/B (Abschnitt 5) und
-- die unkorrigierte Rohdaten-Ansicht (raw_p_value/raw_significant, siehe Nachtrag) in einem
-- einheitlichen Schema ab. BH-FDR-Rang/-Schwelle wird bewusst NICHT hier gespeichert, sondern
-- von research_confluence_bh_fdr() zur Abfragezeit ueber den jeweiligen Pool berechnet
-- (kumulativ, Abschnitt 6) -- analog zu research_bh_fdr_patterns.
create table research_confluence_signal_stats (
  id bigint generated always as identity primary key,
  cell_type text not null check (cell_type in ('signal','pair_a','pair_b')),
  pool text not null check (pool in ('main','exploratory')),
  signal_a text not null,
  signal_b text, -- null fuer cell_type='signal'
  direction text not null check (direction in ('LONG','SHORT')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  n1 integer not null,
  x1 integer not null,
  n2 integer not null,
  x2 integer not null,
  hit_rate1_pct numeric,
  hit_rate2_pct numeric,
  wilson1_lower numeric,
  wilson1_upper numeric,
  wilson2_lower numeric,
  wilson2_upper numeric,
  z_score numeric,
  raw_p_value numeric,
  raw_significant boolean,
  min_n_met boolean not null,
  computed_at timestamptz not null default now(),
  unique (cell_type, signal_a, signal_b, direction, window_start, window_end)
);

alter table research_confluence_signal_stats enable row level security;
create policy "Public read access" on research_confluence_signal_stats
  for select to public using (true);

comment on table research_confluence_signal_stats is
  'CONFLUENCE-SCORE-PROTOCOL_2026-09-11.md: n1/x1 = Signal-aktiv-Gruppe (Groesse/Treffer), n2/x2 = Signal-nicht-aktiv-Gruppe (bzw. bei Paaren: Praevalenz-Gegenstueck). MIN_N=10 pro Gruppe (min_n_met). pool=main enthaelt cell_type in (signal, pair_a); pool=exploratory enthaelt cell_type=pair_b (volle Kombinatorik, eigene BH-FDR-Korrektur, siehe Abschnitt 5 Nachtrag).';

-- Kumulative BH-FDR-Korrektur ueber einen Pool (Abschnitt 6). Analog research_bh_fdr_patterns,
-- aber pool-parametrisiert (main vs. exploratory bleiben getrennte Korrektur-Familien).
create or replace function research_confluence_bh_fdr(p_pool text, p_alpha numeric default 0.05)
returns table(
  id bigint, cell_type text, signal_a text, signal_b text, direction text,
  window_start timestamptz, window_end timestamptz,
  n1 integer, n2 integer, hit_rate1_pct numeric, hit_rate2_pct numeric,
  raw_p_value numeric, rank integer, bh_critical_value numeric, significant_after_bh boolean
)
language sql stable as $$
  with tested as (
    select s.* from research_confluence_signal_stats s
    where s.pool = p_pool and s.min_n_met and s.raw_p_value is not null
  ),
  ranked as (
    select *, rank() over (order by raw_p_value) as rnk, count(*) over () as m
    from tested
  )
  select
    id, cell_type, signal_a, signal_b, direction, window_start, window_end,
    n1, n2, hit_rate1_pct, hit_rate2_pct,
    round(raw_p_value,4), rnk::int,
    round((rnk::numeric/m)*p_alpha, 4),
    raw_p_value <= (rnk::numeric/m)*p_alpha
  from ranked
  order by raw_p_value;
$$;
