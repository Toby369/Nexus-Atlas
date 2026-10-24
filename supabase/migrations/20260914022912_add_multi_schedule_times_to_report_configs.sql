-- Exportiert aus supabase_migrations.schema_migrations (20260914022912 add_multi_schedule_times_to_report_configs)

-- Nutzer-Wunsch (14.09.2026): "ich moechte bis zu 3 zeiten planen koennen"
-- fuer jeden der 4 Report-Slots, statt nur einer taeglichen Uhrzeit.
-- schedule_time (einzelner time-Wert) wird durch schedule_times (Array,
-- max. 3 Eintraege) ersetzt -- kein Zusatztabellen-Overhead noetig, ein
-- Array reicht fuer diese kleine, feste Obergrenze.
alter table public.report_configs
  add column schedule_times time[] null;

update public.report_configs
  set schedule_times = array[schedule_time]
  where schedule_time is not null;

alter table public.report_configs
  add constraint report_configs_schedule_times_max3
  check (schedule_times is null or array_length(schedule_times, 1) <= 3);

alter table public.report_configs
  drop column schedule_time;
