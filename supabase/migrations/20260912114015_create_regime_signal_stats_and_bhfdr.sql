-- Exportiert aus supabase_migrations.schema_migrations (20260912114015 create_regime_signal_stats_and_bhfdr)

-- Gesamteinschaetzung-Score-Protokoll Abschnitt 6+8 Schritt 3: eigener,
-- komplett von research_confluence_signal_stats getrennter BH-FDR-Pool.
-- Erfolg = outcome (UP/DOWN/NEUTRAL) entspricht exakt der getesteten
-- Richtungshypothese -- NEUTRAL zaehlt (wie die Gegenrichtung) als
-- "kein Treffer", identisches Prinzip wie LONG/SHORT-Hit im Setup-Score.

create table if not exists research_regime_signal_stats (
  id bigint generated always as identity primary key,
  cell_type text not null default 'signal',
  signal_a text not null,
  direction text not null check (direction in ('UP','DOWN')),
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
  min_n_met boolean not null default false,
  computed_at timestamptz not null default now(),
  unique (signal_a, direction)
);

alter table research_regime_signal_stats enable row level security;
create policy "Public read access" on research_regime_signal_stats for select to public using (true);

create or replace function research_regime_refresh_stats()
returns void
language plpgsql
as $function$
declare
  v_min_n constant integer := 10;
begin
  delete from research_regime_signal_stats;

  insert into research_regime_signal_stats (signal_a, direction, n1, x1, n2, x2, min_n_met)
  select
    signal_a, direction,
    count(*) filter (where is_active) as n1,
    count(*) filter (where is_active and outcome = direction) as x1,
    count(*) filter (where not is_active) as n2,
    count(*) filter (where not is_active and outcome = direction) as x2,
    (count(*) filter (where is_active) >= v_min_n and count(*) filter (where not is_active) >= v_min_n) as min_n_met
  from research_regime_signal_activation
  group by signal_a, direction;

  update research_regime_signal_stats s
  set
    hit_rate1_pct = round(100.0 * s.x1 / nullif(s.n1, 0), 1),
    hit_rate2_pct = round(100.0 * s.x2 / nullif(s.n2, 0), 1),
    wilson1_lower = w1.lower, wilson1_upper = w1.upper,
    wilson2_lower = w2.lower, wilson2_upper = w2.upper,
    z_score = zt.z_score,
    raw_p_value = zt.raw_p_value
  from research_regime_signal_stats s2
  cross join lateral research_wilson_ci(s2.x1, s2.n1) w1
  cross join lateral research_wilson_ci(s2.x2, s2.n2) w2
  cross join lateral research_two_proportion_ztest(s2.x1, s2.n1, s2.x2, s2.n2) zt
  where s.id = s2.id and s2.min_n_met;
end;
$function$;

comment on function research_regime_refresh_stats() is
  'Gesamteinschaetzung-Score-Protokoll Abschnitt 5+6: Einzelsignal-Statistik, eigener Pool, '
  'komplett getrennt von research_confluence_refresh_stats().';

-- Eigener BH-FDR-Pool (Abschnitt 6) -- bewusst eigene Funktion statt
-- Wiederverwendung von research_confluence_bh_fdr, damit die beiden Pools
-- niemals versehentlich vermischt werden koennen.
create or replace function research_regime_bh_fdr(p_alpha numeric default 0.05)
returns table(
  signal_a text,
  direction text,
  n1 integer,
  n2 integer,
  hit_rate1_pct numeric,
  hit_rate2_pct numeric,
  raw_p_value numeric,
  rank integer,
  bh_critical_value numeric,
  significant_after_bh boolean
)
language sql
stable
as $function$
  with testable as (
    select * from research_regime_signal_stats where min_n_met and raw_p_value is not null
  ),
  m as (
    select count(*) as total from testable
  ),
  ranked as (
    select t.*, row_number() over (order by t.raw_p_value asc) as rnk
    from testable t
  )
  select
    r.signal_a, r.direction, r.n1, r.n2, r.hit_rate1_pct, r.hit_rate2_pct, r.raw_p_value,
    r.rnk::int as rank,
    round((r.rnk::numeric / m.total) * p_alpha, 6) as bh_critical_value,
    r.raw_p_value <= (r.rnk::numeric / m.total) * p_alpha as significant_after_bh
  from ranked r, m
  order by r.raw_p_value asc;
$function$;

comment on function research_regime_bh_fdr(numeric) is
  'Gesamteinschaetzung-Score-Protokoll Abschnitt 6: eigener BH-FDR-Pool, komplett getrennt von '
  'research_confluence_bh_fdr(''main'').';
