-- Exportiert aus supabase_migrations.schema_migrations (20260827185327 create_bh_fdr_on_purged_results)


-- Standardnormal-CDF-Approximation (Zelen&Severo, |Fehler| < 7.5e-8) --
-- fuer p-Werte einer einfachen Ein-Stichproben-Anteils-z-Tests. Kein
-- Ersatz fuer die Effective-Sample-Size-Korrektur (Phase 0, Abschnitt 3) --
-- die rohen n bei 168h/720h ueberschaetzen die Unabhaengigkeit weiterhin,
-- wird im Bericht explizit so eingeordnet.
create or replace function public.research_norm_cdf(z numeric)
returns numeric
language sql
immutable
as $$
  select case
    when z < 0 then 1 - public.research_norm_cdf(-z)
    else
      1 - (
        (0.319381530*t - 0.356563782*t^2 + 1.781477937*t^3 - 1.821255978*t^4 + 1.330274429*t^5)
        * exp(-(z^2)/2) / sqrt(2*pi())
      )
  end
  from (select 1.0/(1.0+0.2316419*z) as t) k;
$$;

-- Benjamini-Hochberg auf allen NEUEN (POST_PURGE_EMBARGO_CORRECTED,
-- overlapping) Zellen mit n>0. p-Wert je Zelle: zweiseitiger Ein-
-- Stichproben-Anteilstest (H0: Hit-Rate = Baseline-Hit-Rate, n=rohe
-- Zeilenzahl -- siehe Kommentar oben zur Einschraenkung bei H>24h).
create or replace function public.research_bh_fdr(p_alpha numeric default 0.05)
returns table (
  model_version text, split text, horizon_hours integer, direction text,
  n integer, hit_rate_pct numeric, baseline_hit_rate_pct numeric,
  raw_p_value numeric, rank integer, bh_critical_value numeric, significant_after_bh boolean
)
language sql
stable
as $$
  with tested as (
    select
      r.model_version, r.split, r.horizon_hours, r.direction, r.n,
      r.hit_rate_pct, r.baseline_hit_rate_pct,
      (r.hit_rate_pct/100.0) as p_hat,
      (r.baseline_hit_rate_pct/100.0) as p0
    from research_model_results_purged r
    where r.overlap_mode = 'overlapping' and r.n > 0 and r.hit_rate_pct is not null
  ),
  with_p as (
    select *,
      2 * (1 - public.research_norm_cdf(
        abs((p_hat - p0) / sqrt(nullif(p0*(1-p0),0)/n))
      )) as raw_p_value
    from tested
    where p0 > 0 and p0 < 1
  ),
  ranked as (
    select *, rank() over (order by raw_p_value) as rnk, count(*) over () as m
    from with_p
  )
  select
    model_version, split, horizon_hours, direction, n,
    round(hit_rate_pct,1), round(baseline_hit_rate_pct,1),
    round(raw_p_value,4), rnk::int,
    round((rnk::numeric/m)*p_alpha, 4),
    raw_p_value <= (rnk::numeric/m)*p_alpha
  from ranked
  order by raw_p_value;
$$;

revoke all on function public.research_norm_cdf(numeric) from public;
grant execute on function public.research_norm_cdf(numeric) to anon, authenticated, service_role;
revoke all on function public.research_bh_fdr(numeric) from public;
grant execute on function public.research_bh_fdr(numeric) to anon, authenticated, service_role;
