-- Exportiert aus supabase_migrations.schema_migrations (20260827085252 create_confidence_bucket_analysis)


-- Section 8: Confidence-Buckets. Nur BULLISH/BEARISH (gerichtete
-- Erwartung), TRAIN+VALIDATION only (TEST bleibt unangetastet). 24h-
-- Horizont (meiste Beobachtungen). Kein Modell-Family-Parameter noetig --
-- direkt auf domain_balanced_v1 (Model B), da calibrated_v1 in diesem
-- Fenster identische Klassifikationen liefert (siehe Verifikation).
create or replace function public.backtest_confidence_buckets(p_model_version text, p_splits text[] default array['train','validation'])
returns table (
  bucket text,
  n integer,
  direction_accuracy_pct numeric,
  edge_vs_baseline_pp numeric,
  mean_forward_return_pct numeric
)
language plpgsql
stable
as $$
declare
  v_run record;
begin
  select * into v_run from backtest_model_runs where model_version = p_model_version;

  return query
  with states as (
    select
      bs.candle_open_time,
      mf.close_price as price_t,
      case v_run.model_family
        when 'baseline' then public.baseline_signal_state(bs.factors)
        when 'domain_balanced' then bs.domain_result
        when 'calibrated' then public.calibrated_v1_signal_state(bs.factors)
      end as result,
      case
        when bs.candle_open_time::date between v_run.train_start and v_run.train_end then 'train'
        when bs.candle_open_time::date between v_run.validation_start and v_run.validation_end then 'validation'
        when bs.candle_open_time::date between v_run.test_start and v_run.test_end then 'test'
      end as split
    from backtest_states bs
    join market_features mf on mf.symbol='BTCUSDT' and mf.interval=v_run.interval and mf.candle_open_time=bs.candle_open_time
    where bs.interval = v_run.interval and bs.architecture_version = 'experimental_domain_v2_phase4_full_asof'
  ),
  fwd as (
    select
      s.result->>'overall_state' as overall_state,
      (s.result->>'confidence')::numeric as confidence,
      s.price_t, mf2.close_price as price_fwd
    from states s
    left join market_features mf2 on mf2.symbol='BTCUSDT' and mf2.interval=v_run.interval
      and mf2.candle_open_time = s.candle_open_time + interval '24 hours'
    where s.split = any(p_splits) and s.result->>'overall_state' in ('BULLISH','BEARISH')
  ),
  baseline as (
    select round(100.0*count(*) filter (where mf2.close_price > s2.price_t)/nullif(count(*),0),1) as pct_rose
    from states s2
    left join market_features mf2 on mf2.symbol='BTCUSDT' and mf2.interval=v_run.interval
      and mf2.candle_open_time = s2.candle_open_time + interval '24 hours'
    where s2.split = any(p_splits)
  ),
  bucketed as (
    select
      case
        when confidence < 50 then '0-50'
        when confidence < 60 then '50-60'
        when confidence < 70 then '60-70'
        when confidence < 80 then '70-80'
        when confidence < 90 then '80-90'
        else '90-100'
      end as bucket,
      overall_state,
      case when overall_state='BULLISH' then (price_fwd > price_t) else (price_fwd < price_t) end as is_hit,
      case when price_fwd is not null then ((price_fwd-price_t)/price_t)*100 end as ret
    from fwd where price_fwd is not null
  )
  select
    b.bucket,
    count(*)::int as n,
    round(100.0*count(*) filter (where is_hit)/count(*),1) as direction_accuracy_pct,
    round(100.0*count(*) filter (where is_hit)/count(*) - avg(case when overall_state='BULLISH' then (select pct_rose from baseline) else 100-(select pct_rose from baseline) end),1) as edge_vs_baseline_pp,
    round(avg(ret),4) as mean_forward_return_pct
  from bucketed b
  group by b.bucket
  order by b.bucket;
end;
$$;

revoke all on function public.backtest_confidence_buckets(text, text[]) from public;
grant execute on function public.backtest_confidence_buckets(text, text[]) to anon, authenticated, service_role;
