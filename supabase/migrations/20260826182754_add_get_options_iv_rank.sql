-- Exportiert aus supabase_migrations.schema_migrations (20260826182754 add_get_options_iv_rank)

-- Spec-Vorgabe (Phase 3 Options-Rest): IV Rank -- wie hoch die aktuelle
-- ATM-IV relativ zu ihrer eigenen historischen Spanne steht (Standard-
-- Definition, CBOE-Konvention: (aktuell - Minimum) / (Maximum - Minimum) *
-- 100, NICHT die verwandte aber andere "IV Percentile"-Definition).
--
-- WICHTIG (Spec: keine Dummy-Werte/keine erfundene Praezision): Ein IV Rank
-- ist nur aussagekraeftig, wenn genug Historie vorliegt. options_snapshots
-- sammelt seit dem 26.08.2026 (siehe frueheste Zeile) -- ein Rank aus wenigen
-- Stunden Historie waere irrefuehrend. Diese Funktion liefert deshalb
-- iv_rank = null + status = 'insufficient_history', solange die tatsaechlich
-- vorliegende Zeitspanne unter p_min_history_days liegt, statt einen
-- verfruehten/falschen Rank vorzutaeuschen. Aktiviert sich von selbst,
-- sobald genug Historie gesammelt wurde -- kein Code-Change noetig.
create or replace function public.get_options_iv_rank(p_min_history_days numeric default 30, p_currency text default 'BTC')
returns jsonb
language sql
stable
as $$
with hist as (
  select timestamp_utc, atm_iv
  from options_snapshots
  where status = 'ok' and currency = p_currency and atm_iv is not null
),
bounds as (
  select
    count(*) as sample_count,
    min(timestamp_utc) as earliest,
    max(timestamp_utc) as latest,
    min(atm_iv) as iv_min,
    max(atm_iv) as iv_max,
    extract(epoch from (max(timestamp_utc) - min(timestamp_utc))) / 86400.0 as history_days
  from hist
),
current as (
  select atm_iv as current_atm_iv
  from hist
  order by timestamp_utc desc
  limit 1
)
select jsonb_build_object(
  'current_atm_iv', c.current_atm_iv,
  'sample_count', b.sample_count,
  'history_days', round(b.history_days, 2),
  'min_history_days_required', p_min_history_days,
  'iv_min', b.iv_min,
  'iv_max', b.iv_max,
  'iv_rank',
    case
      when b.history_days >= p_min_history_days and b.iv_max is not null and b.iv_max <> b.iv_min
        then round(((c.current_atm_iv - b.iv_min) / (b.iv_max - b.iv_min)) * 100, 1)
      else null
    end,
  'status',
    case
      when b.sample_count is null or b.sample_count = 0 then 'unavailable'
      when b.history_days < p_min_history_days then 'insufficient_history'
      when b.iv_max = b.iv_min then 'flat_range'
      else 'ok'
    end
)
from bounds b, current c;
$$;

comment on function public.get_options_iv_rank(numeric, text) is 'IV Rank (CBOE-Definition, min-max-normalisiert) der aktuellen ATM-IV relativ zur eigenen Historie. status=insufficient_history statt eines Dummy-Werts, solange options_snapshots weniger als p_min_history_days Tage Historie hat.';
