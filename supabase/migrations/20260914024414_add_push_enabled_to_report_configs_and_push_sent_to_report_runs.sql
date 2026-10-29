-- Exportiert aus supabase_migrations.schema_migrations (20260914024414 add_push_enabled_to_report_configs_and_push_sent_to_report_runs)

alter table report_configs add column push_enabled boolean not null default false;
alter table report_runs add column push_sent boolean not null default false;
