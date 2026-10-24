-- Exportiert aus supabase_migrations.schema_migrations (20260914024944 raise_schedule_times_max_to_5)

alter table report_configs drop constraint report_configs_schedule_times_max3;
alter table report_configs add constraint report_configs_schedule_times_max5 check (schedule_times is null or array_length(schedule_times, 1) <= 5);
