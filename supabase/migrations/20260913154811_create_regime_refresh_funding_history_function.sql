-- Exportiert aus supabase_migrations.schema_migrations (20260913154811 create_regime_refresh_funding_history_function)

-- Haelt research_funding_rate_history aktuell (analog
-- research_regime_refresh_cci_roc_1h) -- ohne das wuerde die Tabelle nach
-- dem einmaligen Backfill stehen bleiben und kuenftige Bewertungspunkte
-- beim Asof-Join in research_regime_extend_activation_round2() ins Leere
-- laufen lassen (wieder dieselbe Fehlerklasse).
create or replace function public.research_regime_refresh_funding_history()
returns void
language plpgsql
as $function$
declare
  v_last timestamptz;
  v_start_ms bigint;
  v_request_id bigint;
  v_status int;
  v_content text;
  v_tries int := 0;
begin
  select max(funding_time) into v_last from research_funding_rate_history;
  v_start_ms := (extract(epoch from coalesce(v_last, '2022-09-04'::timestamptz)) * 1000 + 1)::bigint;

  v_request_id := net.http_get(
    url := 'https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&startTime=' || v_start_ms || '&limit=1000'
  );

  loop
    v_tries := v_tries + 1;
    perform pg_sleep(1);
    select status_code, content into v_status, v_content from net._http_response where id = v_request_id;
    exit when v_status is not null or v_tries >= 10;
  end loop;

  if v_status = 200 then
    insert into research_funding_rate_history (funding_time, funding_rate)
    select to_timestamp((elem->>'fundingTime')::bigint / 1000.0), (elem->>'fundingRate')::numeric
    from jsonb_array_elements(v_content::jsonb) as elem
    on conflict (funding_time) do nothing;
  end if;

  -- Z-Score fuer die komplette Historie neu berechnen (billig genug bei
  -- ~4.400 Zeilen, vermeidet fehleranfaellige Teil-Updates am Fensterrand).
  with z as (
    select funding_time,
      avg(funding_rate) over w as mean_fr,
      stddev_samp(funding_rate) over w as std_fr,
      count(*) over w as cnt
    from research_funding_rate_history
    window w as (order by funding_time rows between 89 preceding and current row)
  )
  update research_funding_rate_history r
  set funding_zscore = case when z.cnt = 90 and z.std_fr > 0 then (r.funding_rate - z.mean_fr) / z.std_fr else null end
  from z
  where r.funding_time = z.funding_time;
end;
$function$;
