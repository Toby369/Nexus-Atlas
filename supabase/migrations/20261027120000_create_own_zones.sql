-- Eigene Zonen (Toby 27.10.2026): seine Chart-Levels aus TradingView. Regelcheck,
-- Plan-Satz, Kopf-Zeile und Push rechnen damit, sobald mindestens eine Zone
-- eingetragen ist; die Nexus-Keylevels bleiben der Abgleich.
create table public.own_zones (
  id bigint generated always as identity primary key,
  price numeric not null check (price > 0),
  created_at timestamptz not null default now()
);

-- Muster in Nexus: RLS an, oeffentlich lesbar, Schreiben nur serverseitig
-- (Service-Role, /api/own-zones). Seit 30.10.2026 vergibt Supabase fuer neue
-- Tabellen keine Data-API-Rechte mehr automatisch (CLAUDE.md).
alter table public.own_zones enable row level security;
create policy "Public read access" on public.own_zones for select using (true);
grant select on public.own_zones to anon, authenticated;
grant select, insert, update, delete on public.own_zones to service_role;
grant usage on sequence public.own_zones_id_seq to service_role;

-- Bis 30.10.2026 vergibt Supabase neuen Tabellen noch automatisch ALLE Rechte
-- an anon/authenticated. RLS wuerde Schreiben zwar blockieren, TRUNCATE aber
-- nicht -- darum explizit auf reines Lesen zuruecknehmen.
revoke insert, update, delete, truncate, references, trigger on public.own_zones from anon, authenticated;
revoke usage on sequence public.own_zones_id_seq from anon, authenticated;
