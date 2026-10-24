-- Exportiert aus supabase_migrations.schema_migrations (20260827073044 create_get_macro_regime_asof)


-- Look-ahead-Schutz fuer den macro-Faktor: get_macro_regime() selbst bleibt
-- UNVERAENDERT und laeuft produktiv weiter (nimmt implizit den jeweils
-- neuesten Wert je Symbol -- fuer den Live-Betrieb korrekt). Fuer
-- Backtesting braucht es eine eigene, Zeitpunkt-parametrisierte Version,
-- die NUR Daten <= p_asof sieht -- sonst wuerde ein historischer Zustand
-- faelschlich mit spaeteren Makro-Daten berechnet (klassischer Look-ahead-
-- Bias). Byte-genau dieselbe Klassifikationslogik wie get_macro_regime(),
-- einzige Aenderung: "timestamp_utc <= p_asof" in der latest-CTE.
create or replace function public.get_macro_regime_asof(p_asof timestamptz)
returns jsonb
language sql
stable
as $function$
  with latest as (
    select distinct on (symbol) symbol, label, last_price, prev_close, change_pct, market_time_utc, timestamp_utc
    from macro_snapshots
    where status = 'ok' and timestamp_utc <= p_asof
    order by symbol, timestamp_utc desc
  ),
  factors as (
    select
      symbol,
      case
        when symbol = '^VIX' and last_price < 15 then 'risk_on'
        when symbol = '^VIX' and last_price > 25 then 'risk_off'
        when symbol = '^VIX' then 'neutral'
        when symbol in ('^GSPC', '^IXIC') and change_pct > 0.5 then 'risk_on'
        when symbol in ('^GSPC', '^IXIC') and change_pct < -0.5 then 'risk_off'
        when symbol in ('^GSPC', '^IXIC') then 'neutral'
        when symbol = 'DX-Y.NYB' and change_pct < -0.3 then 'risk_on'
        when symbol = 'DX-Y.NYB' and change_pct > 0.3 then 'risk_off'
        when symbol = 'DX-Y.NYB' then 'neutral'
        else 'neutral'
      end as factor
    from latest
    where symbol in ('^VIX', '^GSPC', '^IXIC', 'DX-Y.NYB')
  ),
  net_liquidity as (
    select
      (select last_price from latest where symbol = 'WALCL') as walcl_now,
      (select prev_close from latest where symbol = 'WALCL') as walcl_prev,
      (select last_price from latest where symbol = 'WTREGEN') as tga_now,
      (select prev_close from latest where symbol = 'WTREGEN') as tga_prev,
      (select last_price from latest where symbol = 'RRPONTSYD') as rrp_now,
      (select prev_close from latest where symbol = 'RRPONTSYD') as rrp_prev
  ),
  net_liquidity_calc as (
    select
      case when walcl_now is not null and tga_now is not null and rrp_now is not null
        then walcl_now - tga_now - rrp_now else null end as nl_now,
      case when walcl_prev is not null and tga_prev is not null and rrp_prev is not null
        then walcl_prev - tga_prev - rrp_prev else null end as nl_prev
    from net_liquidity
  ),
  net_liquidity_factor as (
    select
      nl_now,
      nl_prev,
      case when nl_now is not null and nl_prev is not null and nl_prev <> 0
        then round(((nl_now - nl_prev) / abs(nl_prev)) * 100, 3) else null end as nl_change_pct
    from net_liquidity_calc
  ),
  net_liquidity_class as (
    select
      nl_now, nl_prev, nl_change_pct,
      case
        when nl_change_pct is null then null
        when nl_change_pct > 0.5 then 'risk_on'
        when nl_change_pct < -0.5 then 'risk_off'
        else 'neutral'
      end as factor
    from net_liquidity_factor
  ),
  counts as (
    select
      count(*) filter (where factor = 'risk_on') as risk_on_count,
      count(*) filter (where factor = 'risk_off') as risk_off_count,
      count(*) as factor_count
    from (
      select factor from factors
      union all
      select factor from net_liquidity_class where factor is not null
    ) all_factors
  )
  select jsonb_build_object(
    'regime', case
      when (select factor_count from counts) = 0 then null
      when (select risk_on_count from counts) >= 3 and (select risk_off_count from counts) = 0 then 'Risk-On'
      when (select risk_off_count from counts) >= 3 and (select risk_on_count from counts) = 0 then 'Risk-Off'
      when (select risk_on_count from counts) > 0 and (select risk_off_count from counts) > 0 then 'Mixed'
      else 'Neutral'
    end,
    'risk_on_count', (select risk_on_count from counts),
    'risk_off_count', (select risk_off_count from counts),
    'factor_count', (select factor_count from counts),
    'symbols', coalesce((select jsonb_agg(row_to_json(latest)) from latest), '[]'::jsonb),
    'net_liquidity', (select row_to_json(net_liquidity_class) from net_liquidity_class)
  );
$function$;

revoke all on function public.get_macro_regime_asof(timestamptz) from public;
grant execute on function public.get_macro_regime_asof(timestamptz) to anon, authenticated, service_role;
