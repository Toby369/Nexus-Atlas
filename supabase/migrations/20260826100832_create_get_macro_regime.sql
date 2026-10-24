-- Exportiert aus supabase_migrations.schema_migrations (20260826100832 create_get_macro_regime)

create or replace function public.get_macro_regime()
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with latest as (
    select distinct on (symbol) symbol, label, last_price, change_pct, market_time_utc, timestamp_utc
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
  counts as (
    select
      count(*) filter (where factor = 'risk_on') as risk_on_count,
      count(*) filter (where factor = 'risk_off') as risk_off_count,
      count(*) as factor_count
    from factors
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
    'symbols', coalesce((select jsonb_agg(row_to_json(latest)) from latest), '[]'::jsonb)
  );
$$;

comment on function public.get_macro_regime is 'Phase 4: kombiniert VIX-Niveau + Tagesbewegung von S&P 500/Nasdaq/DXY zu einem transparenten Risk-On/Risk-Off/Neutral/Mixed-Regime. Kein Black-Box-Score -- jeder Faktor einzeln nachvollziehbar in "symbols". Braucht mindestens die 4 benannten Symbole mit status=ok, sonst regime=null (keine erratene Einordnung aus unvollstaendigen Daten).';
