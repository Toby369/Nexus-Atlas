-- Exportiert aus supabase_migrations.schema_migrations (20261015173840 push_messages)

-- Jede versendete Push-Nachricht mit kurzer Erklaerung. Antippen oeffnet
-- /mitteilung/<id> in der App. Nur service_role (Edge Function schreibt,
-- Next.js liest serverseitig mit dem Admin-Client).
create table if not exists public.push_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null,
  title text not null,
  body text not null,
  explanation text not null,
  details jsonb not null default '[]'::jsonb,
  link_url text
);
create index if not exists push_messages_created_at_idx on public.push_messages (created_at desc);
alter table public.push_messages enable row level security;
