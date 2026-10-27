-- Nutzungs-Zaehler (Toby 27.10.2026): welche Reiter/Kacheln er tatsaechlich
-- benutzt, als Grundlage zum Ausmisten des Archivs. Es wird NICHTS automatisch
-- geloescht; die Auswertung steht im Konto.
create table public.tile_usage (
  id bigint generated always as identity primary key,
  item text not null check (item ~ '^(tab|tile|step):[a-z0-9-]{1,40}$'),
  created_at timestamptz not null default now()
);
create index tile_usage_item_idx on public.tile_usage (item);

-- Kein Lesezugriff aus dem Browser (wie push_subscriptions): nur service_role,
-- keine Policy. Die bis 30.10.2026 automatisch vergebenen Rechte an
-- anon/authenticated werden explizit entzogen.
alter table public.tile_usage enable row level security;
revoke all on public.tile_usage from anon, authenticated;
grant select, insert, update, delete on public.tile_usage to service_role;
grant usage on sequence public.tile_usage_id_seq to service_role;
revoke all on sequence public.tile_usage_id_seq from anon, authenticated;
