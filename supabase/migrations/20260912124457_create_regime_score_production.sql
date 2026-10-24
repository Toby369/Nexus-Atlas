-- Exportiert aus supabase_migrations.schema_migrations (20260912124457 create_regime_score_production)

-- Gesamteinschaetzung-Score-Protokoll Abschnitt 8 Schritt 4: WOE-Kombination
-- aus den 4 validierten quasi-unabhaengigen Faktoren (siehe
-- docs/research/GESAMTEINSCHAETZUNG-SCORE-PHASE1-RESULTS_2026-09-12.md).
-- Identische Mathematik wie der Setup-Score (Weight-of-Evidence,
-- Naive-Bayes-Log-Odds), aber eigenstaendige Gewichte -- niemals gemeinsame
-- Gewichte fuer unterschiedliche Zielgroessen (Struktur-Konzept Abschnitt 5).
--
-- WICHTIG -- asymmetrische Faktorenliste je Richtung, weil nur das
-- verwendet wird, was fuer GENAU DIESE Richtung die BH-FDR-Korrektur
-- besteht: UP = Trend-Konsens + CVD-Z-Score + Bollinger %b (Momentum-Faktor
-- UP war NICHT signifikant, p=0,06). DOWN = Trend-Konsens + CVD-Z-Score +
-- Momentum-Faktor (Bollinger %b DOWN war NICHT signifikant, p=0,60).

create table if not exists research_regime_score_woe (
  id bigint generated always as identity primary key,
  direction text not null check (direction in ('UP','DOWN')),
  factor text not null,
  level text not null,
  n integer not null,
  x integer not null,
  woe numeric,
  computed_at timestamptz not null default now(),
  unique (direction, factor, level)
);

alter table research_regime_score_woe enable row level security;
create policy "Public read access" on research_regime_score_woe for select to public using (true);

create table if not exists research_regime_score_tiers (
  direction text primary key check (direction in ('UP','DOWN')),
  base_logit numeric not null,
  tier_low_max numeric not null,
  tier_mid_max numeric not null,
  n_total integer not null,
  computed_at timestamptz not null default now()
);

alter table research_regime_score_tiers enable row level security;
create policy "Public read access" on research_regime_score_tiers for select to public using (true);

-- logit()/sigmoid() als kleine Hilfsfunktionen (falls nicht schon vorhanden
-- aus der Confluence-Score-Implementierung -- create or replace ist sicher,
-- da reine, deterministische Funktionen).
create or replace function research_logit(p numeric) returns numeric
language sql immutable as $$
  select ln(p / (1 - p));
$$;

create or replace function research_sigmoid(l numeric) returns numeric
language sql immutable as $$
  select 100.0 / (1 + exp(-l));
$$;

create or replace function research_regime_score_refresh()
returns void
language plpgsql
as $function$
declare
  v_base_up numeric;
  v_base_down numeric;
  v_n_total integer;
begin
  delete from research_regime_score_woe;
  delete from research_regime_score_tiers;

  select count(*) into v_n_total from research_regime_evaluation_events();
  select avg((outcome='UP')::int) into v_base_up from research_regime_evaluation_events();
  select avg((outcome='DOWN')::int) into v_base_down from research_regime_evaluation_events();

  -- Trend-Konsens (0-6), beide Richtungen
  insert into research_regime_score_woe (direction, factor, level, n, x, woe)
  with piv as (
    select a.evaluation_time, a.outcome,
      sum(case when a.signal_a in ('Struktur 1h','Struktur 4h','Struktur 1d','MTF-Alignment','Trendstaerke (ADX+DI)','Regressionssteigung')
                and a.direction = dirs.direction and a.is_active then 1 else 0 end) as konsens
    from research_regime_signal_activation a
    join (values ('UP'),('DOWN')) as dirs(direction) on a.direction = dirs.direction
    group by a.evaluation_time, a.outcome, dirs.direction
  ),
  agg as (
    select
      case when konsens_dir = 'UP' then 'UP' else 'DOWN' end,
      'trend_konsens' as factor, konsens::text as level,
      count(*) as n, count(*) filter (where outcome = konsens_dir) as x
    from (
      select evaluation_time, outcome, konsens, 'UP' as konsens_dir from piv
      union all
      select evaluation_time, outcome, konsens, 'DOWN' as konsens_dir from piv
    ) x
    group by 1, konsens
  )
  select 'UP', 'trend_konsens', level, n, x, null from agg where false; -- placeholder, replaced below

  -- (Die obige CTE-Verschachtelung war ein Irrweg -- sauberer direkt:)
  delete from research_regime_score_woe where factor = 'trend_konsens';

  insert into research_regime_score_woe (direction, factor, level, n, x, woe)
  select dirs.direction, 'trend_konsens', konsens::text,
    count(*) as n,
    count(*) filter (where a_outcome = dirs.direction) as x,
    null
  from (
    select e.evaluation_time, e.outcome as a_outcome,
      sum(case when a.signal_a in ('Struktur 1h','Struktur 4h','Struktur 1d','MTF-Alignment','Trendstaerke (ADX+DI)','Regressionssteigung')
                and a.direction = 'UP' and a.is_active then 1 else 0 end) as konsens
    from research_regime_evaluation_events() e
    join research_regime_signal_activation a on a.evaluation_time = e.evaluation_time
    group by e.evaluation_time, e.outcome
  ) up_konsens, (values ('UP')) as dirs(direction)
  group by dirs.direction, konsens
  union all
  select dirs.direction, 'trend_konsens', konsens::text,
    count(*) as n,
    count(*) filter (where a_outcome = dirs.direction) as x,
    null
  from (
    select e.evaluation_time, e.outcome as a_outcome,
      sum(case when a.signal_a in ('Struktur 1h','Struktur 4h','Struktur 1d','MTF-Alignment','Trendstaerke (ADX+DI)','Regressionssteigung')
                and a.direction = 'DOWN' and a.is_active then 1 else 0 end) as konsens
    from research_regime_evaluation_events() e
    join research_regime_signal_activation a on a.evaluation_time = e.evaluation_time
    group by e.evaluation_time, e.outcome
  ) down_konsens, (values ('DOWN')) as dirs(direction)
  group by dirs.direction, konsens;

  -- CVD-Z-Score (beide Richtungen), Momentum-Faktor (nur DOWN), Bollinger %b (nur UP)
  insert into research_regime_score_woe (direction, factor, level, n, x, woe)
  select direction, 'cvd_z', is_active::text, count(*), count(*) filter (where outcome = direction), null
  from research_regime_signal_activation
  where signal_a = 'CVD-Z-Score'
  group by direction, is_active
  union all
  select direction, 'momentum', is_active::text, count(*), count(*) filter (where outcome = direction), null
  from research_regime_signal_activation
  where signal_a = 'Momentum-Faktor (RSI+MACD)' and direction = 'DOWN'
  group by direction, is_active
  union all
  select direction, 'bollinger_pctb', is_active::text, count(*), count(*) filter (where outcome = direction), null
  from research_regime_signal_activation
  where signal_a = 'Bollinger %b (Mean-Reversion)' and direction = 'UP'
  group by direction, is_active;

  -- WOE je Zeile berechnen
  update research_regime_score_woe w
  set woe = research_logit(least(greatest(w.x::numeric / nullif(w.n,0), 0.001), 0.999))
           - research_logit(case when w.direction = 'UP' then v_base_up else v_base_down end)
  where w.n > 0;

  -- Tiers (Base-Logit + Terzil-Grenzen der kombinierten Logits ueber alle Bewertungspunkte)
  insert into research_regime_score_tiers (direction, base_logit, tier_low_max, tier_mid_max, n_total)
  select 'UP', research_logit(v_base_up),
    percentile_cont(0.3333) within group (order by combined_logit),
    percentile_cont(0.6667) within group (order by combined_logit),
    v_n_total
  from (
    select
      research_logit(v_base_up)
      + coalesce((select woe from research_regime_score_woe where direction='UP' and factor='trend_konsens' and level = konsens::text), 0)
      + coalesce((select woe from research_regime_score_woe where direction='UP' and factor='cvd_z' and level = cvdz::text), 0)
      + coalesce((select woe from research_regime_score_woe where direction='UP' and factor='bollinger_pctb' and level = bb::text), 0)
      as combined_logit
    from (
      select e.evaluation_time,
        sum(case when a.signal_a in ('Struktur 1h','Struktur 4h','Struktur 1d','MTF-Alignment','Trendstaerke (ADX+DI)','Regressionssteigung')
                  and a.direction='UP' and a.is_active then 1 else 0 end) as konsens,
        bool_or(a.is_active) filter (where a.signal_a = 'CVD-Z-Score' and a.direction='UP') as cvdz,
        bool_or(a.is_active) filter (where a.signal_a = 'Bollinger %b (Mean-Reversion)' and a.direction='UP') as bb
      from research_regime_evaluation_events() e
      join research_regime_signal_activation a on a.evaluation_time = e.evaluation_time
      group by e.evaluation_time
    ) s
  ) t;

  insert into research_regime_score_tiers (direction, base_logit, tier_low_max, tier_mid_max, n_total)
  select 'DOWN', research_logit(v_base_down),
    percentile_cont(0.3333) within group (order by combined_logit),
    percentile_cont(0.6667) within group (order by combined_logit),
    v_n_total
  from (
    select
      research_logit(v_base_down)
      + coalesce((select woe from research_regime_score_woe where direction='DOWN' and factor='trend_konsens' and level = konsens::text), 0)
      + coalesce((select woe from research_regime_score_woe where direction='DOWN' and factor='cvd_z' and level = cvdz::text), 0)
      + coalesce((select woe from research_regime_score_woe where direction='DOWN' and factor='momentum' and level = mom::text), 0)
      as combined_logit
    from (
      select e.evaluation_time,
        sum(case when a.signal_a in ('Struktur 1h','Struktur 4h','Struktur 1d','MTF-Alignment','Trendstaerke (ADX+DI)','Regressionssteigung')
                  and a.direction='DOWN' and a.is_active then 1 else 0 end) as konsens,
        bool_or(a.is_active) filter (where a.signal_a = 'CVD-Z-Score' and a.direction='DOWN') as cvdz,
        bool_or(a.is_active) filter (where a.signal_a = 'Momentum-Faktor (RSI+MACD)' and a.direction='DOWN') as mom
      from research_regime_evaluation_events() e
      join research_regime_signal_activation a on a.evaluation_time = e.evaluation_time
      group by e.evaluation_time
    ) s
  ) t;
end;
$function$;

comment on function research_regime_score_refresh() is
  'Gesamteinschaetzung-Score-Protokoll Abschnitt 8 Schritt 4: WOE-Kombination aus 4 validierten '
  'Faktoren, siehe docs/research/GESAMTEINSCHAETZUNG-SCORE-PHASE1-RESULTS_2026-09-12.md.';
