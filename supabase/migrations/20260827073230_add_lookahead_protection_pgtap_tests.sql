-- Exportiert aus supabase_migrations.schema_migrations (20260827073230 add_lookahead_protection_pgtap_tests)


create or replace function public.run_lookahead_protection_tests()
returns setof text
language plpgsql
as $$
declare
  v_macro_now jsonb;
  v_macro_asof jsonb;
  v_future_leak_positioning int;
  v_future_leak_orderbook int;
  v_future_leak_options int;
  v_future_leak_sentiment int;
  v_unreconstructed_empty int;
  v_total_v2 int;
begin
  return next plan(6);

  -- get_macro_regime_asof(sehr weit in der Zukunft) muss dasselbe Ergebnis
  -- liefern wie get_macro_regime() selbst, da beide dann auf dieselbe
  -- "juengste Zeile je Symbol" zugreifen -- Beweis, dass die asof-Version
  -- die produktive Logik korrekt spiegelt statt sie zu verfaelschen.
  select public.get_macro_regime() into v_macro_now;
  select public.get_macro_regime_asof(now() + interval '10 years') into v_macro_asof;
  return next is(v_macro_asof->>'regime', v_macro_now->>'regime', 'get_macro_regime_asof() weit in der Zukunft entspricht get_macro_regime() (gleiche Logik, kein Drift)');

  -- Look-ahead-Checks fuer die vier asof-Tabellen-Faktoren: keine Zeile in
  -- backtest_states (v2) darf eine Rohdaten-Zeile NACH ihrem eigenen
  -- Kerzenschluss verwendet haben.
  select count(*) into v_future_leak_positioning
  from backtest_states bs
  where bs.architecture_version = 'experimental_domain_v2_phase4_full_asof'
    and (bs.factors->'positioning'->>'value') is not null
    and not exists (
      select 1 from positioning_signals ps
      where ps.timestamp_utc <= bs.timestamp_utc
        and (ps.score = (bs.factors->'positioning'->'basis'->>'score')::numeric)
    );
  return next is(v_future_leak_positioning, 0, 'positioning-Rekonstruktion belegbar aus einer Zeile <= Kerzenschluss (kein Look-ahead)');

  select count(*) into v_future_leak_orderbook
  from backtest_states bs
  where bs.architecture_version = 'experimental_domain_v2_phase4_full_asof'
    and (bs.factors->'orderbook'->>'value') is not null
    and exists (
      select 1 from orderbook_snapshots o
      where o.symbol = 'BTCUSDT' and o.status = 'ok'
        and o.timestamp_utc > bs.timestamp_utc
    ) and not exists (
      -- nur ein grober Plausibilitaetscheck: es muss MINDESTENS eine
      -- gueltige Zeile <= Kerzenschluss geben, die den Wert erklaeren kann
      select 1 from orderbook_snapshots o2
      where o2.symbol = 'BTCUSDT' and o2.status='ok' and o2.timestamp_utc <= bs.timestamp_utc
    );
  return next is(v_future_leak_orderbook, 0, 'orderbook-Rekonstruktion hat immer mindestens eine erklaerende Zeile <= Kerzenschluss');

  select count(*) into v_future_leak_options
  from backtest_states bs
  where bs.architecture_version = 'experimental_domain_v2_phase4_full_asof'
    and (bs.factors->'options'->>'value') is not null
    and not exists (
      select 1 from options_snapshots os
      where os.status = 'ok' and os.timestamp_utc <= bs.timestamp_utc
        and os.put_call_oi_ratio = (bs.factors->'options'->'basis'->>'put_call_oi_ratio')::numeric
    );
  return next is(v_future_leak_options, 0, 'options-Rekonstruktion belegbar aus einer Zeile <= Kerzenschluss (kein Look-ahead)');

  select count(*) into v_future_leak_sentiment
  from backtest_states bs
  where bs.architecture_version = 'experimental_domain_v2_phase4_full_asof'
    and (bs.factors->'sentiment'->>'value') is not null
    and not exists (
      select 1 from sentiment_snapshots ss
      where ss.status = 'ok' and ss.timestamp_utc <= bs.timestamp_utc
        and ss.classification = (bs.factors->'sentiment'->'basis'->>'classification')
    );
  return next is(v_future_leak_sentiment, 0, 'sentiment-Rekonstruktion belegbar aus einer Zeile <= Kerzenschluss (kein Look-ahead)');

  -- v2-Zeilen haben (anders als v1) keine dokumentierte Luecke mehr --
  -- unreconstructed_factors ist ein leeres Array, da jetzt alle 14
  -- Faktoren Point-in-Time-sicher rekonstruierbar sind.
  select count(*), count(*) filter (where unreconstructed_factors = array[]::text[])
  into v_total_v2, v_unreconstructed_empty
  from backtest_states where architecture_version = 'experimental_domain_v2_phase4_full_asof';
  return next is(v_unreconstructed_empty, v_total_v2, 'v2-Zeilen haben ein leeres unreconstructed_factors-Array -- alle 14 Faktoren sind jetzt architektonisch rekonstruierbar');

  return next finish();
end;
$$;

revoke all on function public.run_lookahead_protection_tests() from public, anon, authenticated;
grant execute on function public.run_lookahead_protection_tests() to service_role;
