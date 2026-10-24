-- Exportiert aus supabase_migrations.schema_migrations (20261012045533 create_system_briefing_config)

-- Zeitplan und Benachrichtigungen des System-Briefings (ersetzt die AI Report
-- Engine, Master-Report und System-Briefing zusammengelegt). Eine Zeile (id=1).
create table if not exists public.system_briefing_config (
  id smallint primary key default 1 check (id = 1),
  schedule_times time[] null,
  email_enabled boolean not null default false,
  push_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint system_briefing_config_schedule_times_max5
    check (schedule_times is null or array_length(schedule_times, 1) <= 5)
);

alter table public.system_briefing_config enable row level security;
create policy "Public read access" on public.system_briefing_config for select using (true);

-- Startwerte aus dem bisherigen Master-Report (report_configs Slot 4).
insert into public.system_briefing_config (id, schedule_times, email_enabled, push_enabled)
select 1, schedule_times, email_enabled, push_enabled
from public.report_configs where slot = 4
on conflict (id) do nothing;

insert into public.system_briefing_config (id) values (1) on conflict (id) do nothing;

alter table public.system_briefings
  add column if not exists email_sent boolean not null default false,
  add column if not exists push_sent boolean not null default false;
