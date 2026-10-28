-- Tagesplan (Toby 28.10.2026): ein Plan pro Tag aus dem Morgen-Ablauf
-- (Zonen, Perp-Lage, Wenn-Dann-Szenarien, Abend-Rueckblick) als jsonb,
-- Struktur siehe lib/dailyPlan.ts. Ein paar KB pro Tag.
create table public.daily_plans (
  plan_date date primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Muster in Nexus: RLS an, oeffentlich lesbar, Schreiben nur serverseitig
-- (Service-Role, /api/daily-plan). Seit 30.10.2026 vergibt Supabase fuer
-- neue Tabellen keine Data-API-Rechte mehr automatisch (CLAUDE.md).
alter table public.daily_plans enable row level security;
create policy "Public read access" on public.daily_plans for select using (true);
grant select on public.daily_plans to anon, authenticated;
grant select, insert, update, delete on public.daily_plans to service_role;

-- Bis 30.10.2026 vergibt Supabase neuen Tabellen noch automatisch alle Rechte
-- an anon/authenticated; darum explizit auf reines Lesen zuruecknehmen.
revoke insert, update, delete, truncate, references, trigger on public.daily_plans from anon, authenticated;
