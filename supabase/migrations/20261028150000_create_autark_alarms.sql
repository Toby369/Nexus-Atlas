-- Alarme aus AutarkTrade (Toby 28.10.2026, docs/research/AUTARK-NEXUS-PLAN_2026-10-28.md).
-- AutarkTrade schickt jeden ausgeloesten Alarm per Webhook an die Edge
-- Function webhook-autark; die speichert ihn hier. Payload siehe dort.
create table public.autark_alarms (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  sent_at timestamptz,
  quelle text,
  regel text,
  schwere text,
  symbol text,
  meldung text not null,
  preis numeric,
  niveau numeric,
  payload jsonb not null
);
create index autark_alarms_received_at_idx on public.autark_alarms (received_at desc);

-- Muster in Nexus: RLS an, oeffentlich lesbar, Schreiben nur serverseitig
-- (Service-Role in der Edge Function). GRANTs explizit (CLAUDE.md).
alter table public.autark_alarms enable row level security;
create policy "Public read access" on public.autark_alarms for select using (true);
grant select on public.autark_alarms to anon, authenticated;
grant select, insert, update, delete on public.autark_alarms to service_role;
grant usage on sequence public.autark_alarms_id_seq to service_role;
revoke insert, update, delete, truncate, references, trigger on public.autark_alarms from anon, authenticated;
revoke usage on sequence public.autark_alarms_id_seq from anon, authenticated;
