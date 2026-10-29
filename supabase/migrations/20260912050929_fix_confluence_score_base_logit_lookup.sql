-- Exportiert aus supabase_migrations.schema_migrations (20260912050929 fix_confluence_score_base_logit_lookup)


create or replace function research_confluence_score(
  p_direction text,
  p_trend_count integer,
  p_fear_greed_active boolean,
  p_makro_active boolean,
  p_orderbuch_active boolean,
  p_momentum_state text default 'unknown'
)
returns table (probability numeric, tier text, logit numeric)
language plpgsql
stable
as $$
declare
  v_trend_level text;
  v_logit numeric;
  v_tiers research_confluence_score_tiers%rowtype;
begin
  v_trend_level := case when p_trend_count = 0 then '0' when p_trend_count = 1 then '1'
                        when p_trend_count in (2,3) then '2-3' else '4+' end;

  select * into v_tiers from research_confluence_score_tiers t where t.direction = p_direction;

  select v_tiers.base_logit
    + coalesce((select w.woe from research_confluence_score_woe w
        where w.direction = p_direction and w.factor = 'trend' and w.level = v_trend_level), 0)
    + coalesce((select w.woe from research_confluence_score_woe w
        where w.direction = p_direction and w.factor = 'fear_greed' and w.level = p_fear_greed_active::text), 0)
    + coalesce((select w.woe from research_confluence_score_woe w
        where w.direction = p_direction and w.factor = 'makro' and w.level = p_makro_active::text), 0)
    + coalesce((select w.woe from research_confluence_score_woe w
        where w.direction = p_direction and w.factor = 'orderbuch' and w.level = p_orderbuch_active::text), 0)
    + case when p_momentum_state in ('true','false') then
        coalesce((select w.woe from research_confluence_score_woe w
          where w.direction = p_direction and w.factor = 'momentum' and w.level = p_momentum_state), 0)
      else 0 end
  into v_logit;

  logit := v_logit;
  probability := round(100.0 / (1.0 + exp(-v_logit)), 1);
  tier := case
    when v_logit <= ln(v_tiers.tier_low_max / (1 - v_tiers.tier_low_max)) then 'Niedrig'
    when v_logit <= ln(v_tiers.tier_mid_max / (1 - v_tiers.tier_mid_max)) then 'Mittel'
    else 'Hoch'
  end;
  return next;
end;
$$;
