-- Exportiert aus supabase_migrations.schema_migrations (20260911192812 fix_two_proportion_ztest_zero_n)

create or replace function research_two_proportion_ztest(p_x1 integer, p_n1 integer, p_x2 integer, p_n2 integer)
returns table(p1 numeric, p2 numeric, z_score numeric, raw_p_value numeric)
language sql immutable as $$
  with base as (
    select
      p_x1::numeric / nullif(p_n1,0) as phat1,
      p_x2::numeric / nullif(p_n2,0) as phat2,
      (p_x1 + p_x2)::numeric / nullif(p_n1 + p_n2, 0) as pbar
  ),
  se as (
    select *,
      case when p_n1 > 0 and p_n2 > 0 then sqrt(pbar*(1-pbar)*(1.0/p_n1 + 1.0/p_n2)) else null end as se_val
    from base
  )
  select
    phat1, phat2,
    case when se_val > 0 then (phat1 - phat2) / se_val else null end,
    case when se_val > 0 then 2 * (1 - public.research_norm_cdf(abs((phat1 - phat2) / se_val))) else null end
  from se;
$$;
