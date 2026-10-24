-- Exportiert aus supabase_migrations.schema_migrations (20260826192729 add_net_liquidity_to_macro_regime)

-- Erweitert get_macro_regime um Fed-Netto-Liquiditaet (jetzt via FRED
-- verfuegbar: WALCL Fed-Bilanzsumme, WTREGEN Treasury General Account,
-- RRPONTSYD Overnight Reverse Repo) als fuenften Regime-Faktor, statt eine
-- eigene UI-Kachel dafuer anzulegen (Spec-Vorgabe: "vieles davon kann in
-- eine Macro-Regime-Engine einfliessen statt Kacheln zu werden").
--
-- Netto-Liquiditaet = Fed-Bilanzsumme - TGA - Reverse Repo (etablierter,
-- nicht selbst erfundener Begriff: steigende Liquiditaet gilt als
-- unterstuetzend/risk-on fuer Risikoassets inkl. BTC, fallende als
-- risk-off). Woechentliche Aktualisierung (WALCL/WTREGEN), daher wird die
-- Veraenderung zum jeweils VORHERIGEN Beobachtungswert je Serie verglichen
-- (bereits vorhandene prev_close-Spalte), nicht zum vorherigen Collector-
-- Lauf. NET_LIQUIDITY_CHANGE_THRESHOLD_PCT=0.5 ist eine erste, dokumentierte
-- Kalibrierung (noch nicht per Backtesting validiert, da erst ein
-- Datenpunkt vorliegt) -- spaeter justierbar.
create or replace function public.get_macro_regime()
returns jsonb
language sql
stable
as $$
  with latest as (
    select distinct on (symbol) symbol, label, last_price, prev_close, change_pct, market_time_utc, timestamp_utc
    from macro_snapshots
    where status = 'ok'
    order by symbol, timestamp_utc desc
  ),
  -- Faktor-Klassifikation je Symbol: risk_on / risk_off / neutral.
  -- Schwellenwerte: VIX-Baender folgen der marktueblichen Interpretation
  -- (unter 15 ruhig, ueber 25 erhoeht/Angst -- CBOE-Konvention). Aktien-
  -- /DXY-Tagesbewegung nutzt dieselbe konservative 0.3%/0.5%-Logik wie die
  -- bestehende Marktkontext-Klassifikation (lib/marketContext.ts).
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
$$;

comment on function public.get_macro_regime() is 'Makro-Regime (Risk-On/Risk-Off/Mixed/Neutral) aus VIX/S&P/Nasdaq/DXY-Tagesbewegung PLUS Fed-Netto-Liquiditaets-Trend (Bilanzsumme - TGA - Reverse Repo, via FRED). Speist compute-market-state (Faktor "macro"), keine eigene UI-Kachel.';
