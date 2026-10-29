-- Exportiert aus supabase_migrations.schema_migrations (20260910024147 create_compute_signal_stats)


-- Periodischer KI-Rueckblick Phase 2: berechnet je (category, signal_type,
-- horizon_hours) im gewaehlten Fenster entweder einen Richtungstest
-- (direction_expected gesetzt: Trefferquote vs. unbedingte Baseline-
-- Richtungswahrscheinlichkeit) oder einen Magnitude-Test
-- (direction_expected NULL: durchschnittliche absolute Bewegung vs.
-- Baseline-Volatilitaet desselben Horizonts) -- exakt die in Phase 1
-- dokumentierte Aufteilung.
--
-- Normalapproximation + research_norm_cdf() -- dieselbe, bereits im
-- Candlestick-/Divergenz-Backtest verwendete Methodik (siehe
-- research_bh_fdr_patterns), hier fuer die laufende Live-Ueberwachung
-- wiederverwendet statt neu erfunden.
--
-- MIN_N = 10: unterhalb dieser Stichprobengroesse bleibt raw_p_value/rank/
-- bh_critical_value/significant_after_bh NULL -- "keine Aussage" statt
-- einer aus zu wenig Daten erfundenen Ueberzeugung (Sorgfalts-Leitplanke
-- aus dem Rueckblick-Plan vom 09.09.2026).
create or replace function public.compute_signal_stats(p_window text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min_n constant integer := 10;
  v_upserted integer;
begin
  if p_window not in ('90d', 'all') then
    raise exception 'p_window muss 90d oder all sein, war: %', p_window;
  end if;

  with baselines as (
    select h.horizon_hours, b.*
    from (select unnest(array[4, 12, 24]) as horizon_hours) h
    cross join lateral public.signal_baseline_stats(h.horizon_hours, p_window) b
  ),
  groups as (
    select
      so.category, so.signal_type, so.horizon_hours, so.direction_expected,
      count(*) as n,
      avg(case when so.hit then 1.0 else 0.0 end) as hit_rate,
      avg(so.return_pct) as avg_return_pct,
      avg(abs(so.return_pct)) as avg_abs_return_pct
    from public.signal_outcomes so
    where so.filled_at is not null
      and (p_window <> '90d' or so.fired_at >= now() - interval '90 days')
    group by 1, 2, 3, 4
  ),
  scored as (
    select
      g.category, g.signal_type, g.horizon_hours, g.direction_expected,
      case when g.direction_expected is not null then 'directional' else 'magnitude' end as test_type,
      g.n,
      case when g.direction_expected is not null then round(g.hit_rate * 100, 2) else null end as hit_rate_pct,
      case
        when g.direction_expected = 'bullish' then round(b.baseline_bullish_rate * 100, 2)
        when g.direction_expected = 'bearish' then round(b.baseline_bearish_rate * 100, 2)
        else null
      end as baseline_hit_rate_pct,
      round(g.avg_return_pct, 4) as avg_return_pct,
      round(g.avg_abs_return_pct, 4) as avg_abs_return_pct,
      case when g.direction_expected is null then round(b.avg_abs_return_pct, 4) else null end as baseline_avg_abs_return_pct,
      case
        when g.n < v_min_n then null
        when g.direction_expected = 'bullish' and b.baseline_bullish_rate > 0 and b.baseline_bullish_rate < 1 then
          2 * (1 - public.research_norm_cdf(abs((g.hit_rate - b.baseline_bullish_rate) / sqrt(b.baseline_bullish_rate * (1 - b.baseline_bullish_rate) / g.n))))
        when g.direction_expected = 'bearish' and b.baseline_bearish_rate > 0 and b.baseline_bearish_rate < 1 then
          2 * (1 - public.research_norm_cdf(abs((g.hit_rate - b.baseline_bearish_rate) / sqrt(b.baseline_bearish_rate * (1 - b.baseline_bearish_rate) / g.n))))
        when g.direction_expected is null and b.stddev_abs_return_pct > 0 then
          2 * (1 - public.research_norm_cdf(abs((g.avg_abs_return_pct - b.avg_abs_return_pct) / (b.stddev_abs_return_pct / sqrt(g.n)))))
        else null
      end as raw_p_value
    from groups g
    join baselines b on b.horizon_hours = g.horizon_hours
  ),
  ranked as (
    select *,
      case when raw_p_value is not null then rank() over (order by raw_p_value) end as rnk,
      count(*) filter (where raw_p_value is not null) over () as m
    from scored
  ),
  upserted as (
    insert into public.signal_stats_results (
      window_label, category, signal_type, horizon_hours, direction_expected, test_type,
      n, hit_rate_pct, baseline_hit_rate_pct, avg_return_pct, avg_abs_return_pct,
      baseline_avg_abs_return_pct, raw_p_value, rank, bh_critical_value, significant_after_bh, computed_at
    )
    select
      p_window, category, signal_type, horizon_hours, direction_expected, test_type,
      n, hit_rate_pct, baseline_hit_rate_pct, avg_return_pct, avg_abs_return_pct,
      baseline_avg_abs_return_pct, round(raw_p_value, 4), rnk,
      case when rnk is not null then round((rnk::numeric / nullif(m, 0)) * 0.05, 4) end,
      case when rnk is not null and m > 0 then raw_p_value <= (rnk::numeric / m) * 0.05 else null end,
      now()
    from ranked
    on conflict (window_label, category, signal_type, horizon_hours) do update set
      direction_expected = excluded.direction_expected,
      test_type = excluded.test_type,
      n = excluded.n,
      hit_rate_pct = excluded.hit_rate_pct,
      baseline_hit_rate_pct = excluded.baseline_hit_rate_pct,
      avg_return_pct = excluded.avg_return_pct,
      avg_abs_return_pct = excluded.avg_abs_return_pct,
      baseline_avg_abs_return_pct = excluded.baseline_avg_abs_return_pct,
      raw_p_value = excluded.raw_p_value,
      rank = excluded.rank,
      bh_critical_value = excluded.bh_critical_value,
      significant_after_bh = excluded.significant_after_bh,
      computed_at = excluded.computed_at
    returning 1
  )
  select count(*) into v_upserted from upserted;

  return v_upserted;
end;
$$;

comment on function public.compute_signal_stats is
  'Periodischer KI-Rueckblick Phase 2 (10.09.2026): berechnet/aktualisiert signal_stats_results fuer ein Fenster (90d/all) -- Trefferquote bzw. Magnitude vs. Baseline, Normalapproximation-p-Wert, BH-FDR-Korrektur ueber alle in diesem Lauf berechneten Zellen desselben Fensters (nicht kumulativ ueber vergangene Laeufe, siehe Tabellenkommentar).';

create or replace function public.run_weekly_signal_stats()
returns void
language sql
security definer
set search_path = ''
as $$
  select public.compute_signal_stats('90d');
  select public.compute_signal_stats('all');
$$;

comment on function public.run_weekly_signal_stats is
  'Periodischer KI-Rueckblick Phase 2 (10.09.2026): woechentlicher Cron-Einstiegspunkt, berechnet beide Fenster (90d + all).';

revoke execute on function public.compute_signal_stats(text) from anon, authenticated;
revoke execute on function public.run_weekly_signal_stats() from anon, authenticated;

select cron.schedule(
  'weekly-signal-stats',
  '0 5 * * 1',
  $cron$select public.run_weekly_signal_stats();$cron$
);
