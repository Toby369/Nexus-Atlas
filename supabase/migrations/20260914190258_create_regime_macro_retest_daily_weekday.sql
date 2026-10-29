-- Exportiert aus supabase_migrations.schema_migrations (20260914190258 create_regime_macro_retest_daily_weekday)

-- Nutzer-Wunsch 14.09.2026 ("makro höhere Kerzen ... Wochenende auslassen,
-- kannst du das?"): Retest der 8 bereits im Regime-Score-Protokoll
-- getesteten Makro-Signale (DXY, S&P 500, Nasdaq, Gold, VIX, Net-Liquidity,
-- USD/JPY, M2, CPI, PCE) auf der angepassten Auswertungsbasis
-- research_regime_evaluation_events_daily_weekday() (einmal taeglich,
-- 24h-Zielfenster, Wochenende ausgeschlossen -- siehe Kommentar dort).
--
-- Aktivierungslogik 1:1 aus research_regime_extend_activation_round4() und
-- _round5() uebernommen (identische Symbole/Schwellenwerte aus
-- macro_snapshots), nur gegen die neuen Bewertungspunkte statt der
-- produktiven 4h-Basis. Bewusst OHNE persistente Aktivierungstabelle --
-- reines Retest-Experiment, keine produktive Pipeline, deshalb alles in
-- einer Funktion berechnet statt ueber research_regime_signal_activation
-- gespiegelt (dort wuerden die evaluation_time-Werte teilweise mit der
-- 4h-Basis kollidieren, siehe Hinweis in
-- research_regime_evaluation_events_daily_weekday()).
--
-- BH-FDR-Pool ist bewusst NUR diese 8 Signale (13 Zeilen, kein gemeinsamer
-- Pool mit den anderen 34 Regime-Score-Kandidaten) -- andere Zielgroesse
-- (24h/Wochentage statt 4h/alle Tage), waere sonst kein sauberer Vergleich
-- und keine korrekte gemeinsame Korrektur.
create or replace function public.research_regime_macro_retest_daily_weekday(p_alpha numeric default 0.05)
returns table(
  signal_a text, direction text, n1 integer, n2 integer,
  hit_rate1_pct numeric, hit_rate2_pct numeric,
  raw_p_value numeric, rank integer, bh_critical_value numeric, significant_after_bh boolean
)
language sql
stable
as $function$
  with events as (
    select * from research_regime_evaluation_events_daily_weekday()
  ),
  activation as (
    select e.evaluation_time, 'DXY-Bewegung'::text as signal_a, 'UP'::text as direction, e.outcome,
      coalesce((select m.change_pct < -0.3 from macro_snapshots m where m.symbol='DX-Y.NYB' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false) as is_active
    from events e
    union all
    select e.evaluation_time, 'DXY-Bewegung', 'DOWN', e.outcome,
      coalesce((select m.change_pct > 0.3 from macro_snapshots m where m.symbol='DX-Y.NYB' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'S&P-500-Bewegung', 'UP', e.outcome,
      coalesce((select m.change_pct > 0.5 from macro_snapshots m where m.symbol='^GSPC' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'S&P-500-Bewegung', 'DOWN', e.outcome,
      coalesce((select m.change_pct < -0.5 from macro_snapshots m where m.symbol='^GSPC' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'Nasdaq-Bewegung', 'UP', e.outcome,
      coalesce((select m.change_pct > 0.5 from macro_snapshots m where m.symbol='^IXIC' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'Nasdaq-Bewegung', 'DOWN', e.outcome,
      coalesce((select m.change_pct < -0.5 from macro_snapshots m where m.symbol='^IXIC' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'Gold-Bewegung', 'UP', e.outcome,
      coalesce((select m.change_pct > 0.5 from macro_snapshots m where m.symbol='GC=F' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'Gold-Bewegung', 'DOWN', e.outcome,
      coalesce((select m.change_pct < -0.5 from macro_snapshots m where m.symbol='GC=F' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'VIX erhöht', 'DOWN', e.outcome,
      coalesce((select m.last_price > 25 from macro_snapshots m where m.symbol='^VIX' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'Net-Liquidity steigt', 'UP', e.outcome,
      coalesce((
        with vals as (
          select
            (select m.last_price from macro_snapshots m where m.symbol='WALCL' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as walcl_now,
            (select m.prev_close from macro_snapshots m where m.symbol='WALCL' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as walcl_prev,
            (select m.last_price from macro_snapshots m where m.symbol='WTREGEN' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as tga_now,
            (select m.prev_close from macro_snapshots m where m.symbol='WTREGEN' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as tga_prev,
            (select m.last_price from macro_snapshots m where m.symbol='RRPONTSYD' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as rrp_now,
            (select m.prev_close from macro_snapshots m where m.symbol='RRPONTSYD' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1) as rrp_prev
        )
        select (walcl_now - tga_now - rrp_now - (walcl_prev - tga_prev - rrp_prev)) / nullif(abs(walcl_prev - tga_prev - rrp_prev), 0) * 100 > 0.5
        from vals
        where walcl_now is not null and walcl_prev is not null and tga_now is not null
          and tga_prev is not null and rrp_now is not null and rrp_prev is not null
      ), false)
    from events e
    union all
    select e.evaluation_time, 'USD/JPY fällt', 'DOWN', e.outcome,
      coalesce((select m.change_pct < -0.3 from macro_snapshots m where m.symbol='JPY=X' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'M2-Wachstum', 'UP', e.outcome,
      coalesce((select m.change_pct > 0 from macro_snapshots m where m.symbol='M2SL' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'CPI-Anstieg', 'DOWN', e.outcome,
      coalesce((select m.change_pct > 0 from macro_snapshots m where m.symbol='CPIAUCSL' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
    union all
    select e.evaluation_time, 'PCE-Anstieg', 'DOWN', e.outcome,
      coalesce((select m.change_pct > 0 from macro_snapshots m where m.symbol='PCEPI' and m.status='ok' and m.timestamp_utc <= e.evaluation_time order by m.timestamp_utc desc limit 1), false)
    from events e
  ),
  stats as (
    select signal_a, direction,
      count(*) filter (where is_active) as n_active,
      count(*) filter (where not is_active) as n_inactive,
      count(*) filter (where is_active and outcome = direction) as hits_active,
      count(*) filter (where not is_active and outcome = direction) as hits_inactive
    from activation
    group by signal_a, direction
  ),
  props as (
    select *,
      hits_active::numeric / nullif(n_active, 0) as p1,
      hits_inactive::numeric / nullif(n_inactive, 0) as p2,
      (hits_active + hits_inactive)::numeric / nullif(n_active + n_inactive, 0) as p_pool
    from stats
    where n_active >= 10 and n_inactive >= 10
  ),
  zvals as (
    select *,
      (p1 - p2) / nullif(sqrt(p_pool * (1 - p_pool) * (1.0 / nullif(n_active, 0) + 1.0 / nullif(n_inactive, 0))), 0) as z
    from props
  ),
  pvals as (
    select *,
      case when z is null then 1.0 else erfc(abs(z::double precision) / sqrt(2))::numeric end as raw_p
    from zvals
  ),
  ranked as (
    select *, row_number() over (order by raw_p asc) as rnk, count(*) over () as m
    from pvals
  ),
  crit as (
    select *, (rnk::numeric / m) * p_alpha as bh_crit
    from ranked
  ),
  maxk as (
    select coalesce(max(rnk) filter (where raw_p <= bh_crit), 0) as k from crit
  )
  select
    crit.signal_a, crit.direction, crit.n_active as n1, crit.n_inactive as n2,
    round(crit.p1 * 100, 1) as hit_rate1_pct, round(crit.p2 * 100, 1) as hit_rate2_pct,
    crit.raw_p as raw_p_value, crit.rnk::integer as rank, round(crit.bh_crit, 6) as bh_critical_value,
    (crit.rnk <= (select k from maxk)) as significant_after_bh
  from crit
  order by crit.direction, crit.raw_p asc;
$function$;
