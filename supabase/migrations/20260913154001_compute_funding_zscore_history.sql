-- Exportiert aus supabase_migrations.schema_migrations (20260913154001 compute_funding_zscore_history)

-- Rolling Z-Score exakt nach der bereits dokumentierten/getesteten Formel aus
-- research-python/src/features/derivatives.py::funding_zscore (window=90,
-- ddof=1, min_periods=90 -- 90 Funding-Perioden a 8h ~= 30 Tage).
alter table research_funding_rate_history add column funding_zscore numeric;

with z as (
  select funding_time,
    avg(funding_rate) over w as mean_fr,
    stddev_samp(funding_rate) over w as std_fr,
    count(*) over w as cnt
  from research_funding_rate_history
  window w as (order by funding_time rows between 89 preceding and current row)
)
update research_funding_rate_history r
set funding_zscore = case
  when z.cnt = 90 and z.std_fr > 0 then (r.funding_rate - z.mean_fr) / z.std_fr
  else null
end
from z
where r.funding_time = z.funding_time;

select count(*), count(funding_zscore) from research_funding_rate_history;
