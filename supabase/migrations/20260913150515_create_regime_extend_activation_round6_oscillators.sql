-- Exportiert aus supabase_migrations.schema_migrations (20260913150515 create_regime_extend_activation_round6_oscillators)

create or replace function public.research_regime_extend_activation_round6()
returns void
language plpgsql
as $function$
begin
  -- Kandidat 1: CCI-Extrem -- Trend-Fortsetzung, |CCI| >= 100.
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'CCI-Extrem (Fortsetzung)', dir.direction, e.outcome,
    coalesce((
      select case when dir.direction = 'UP' then r.cci >= 100 else r.cci <= -100 end
      from research_regime_cci_roc_1h r
      where r.candle_open_time <= e.evaluation_time and r.cci is not null
      order by r.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;

  -- Kandidat 2: ROC-Z-Score -- Momentum-Fortsetzung, |z| >= 1.0 (Stddev ueber
  -- die volle Historie, siehe Vorregistrierung).
  insert into research_regime_signal_activation (evaluation_time, signal_a, direction, outcome, is_active)
  select e.evaluation_time, 'ROC-Z-Score', dir.direction, e.outcome,
    coalesce((
      select case when dir.direction = 'UP' then r.roc >= 1.844195360030752
                  else r.roc <= -1.844195360030752 end
      from research_regime_cci_roc_1h r
      where r.candle_open_time <= e.evaluation_time and r.roc is not null
      order by r.candle_open_time desc limit 1
    ), false)
  from research_regime_evaluation_events() e, (values ('UP'),('DOWN')) as dir(direction)
  on conflict (evaluation_time, signal_a, direction) do nothing;
end;
$function$;
