-- Zinskurs (Toby 15.11.2026): jede Aenderung des Fed-Zielbands bleibt
-- dauerhaft stehen, nicht nur 1 h nach dem FOMC. Gefuellt taeglich von
-- collect-economic-calendar aus FRED (DFEDTARU/DFEDTARL, ab 2023). Wachstum: hoechstens
-- ~8 Zeilen pro Jahr, darum keine Aufbewahrungsfrist noetig.
create table if not exists public.fed_rate_changes (
  effective_date date primary key,
  lower_pct numeric(5,2) not null,
  upper_pct numeric(5,2) not null,
  updated_at timestamptz not null default now()
);

alter table public.fed_rate_changes enable row level security;
create policy "Public read access" on public.fed_rate_changes for select using (true);

-- Bis 30.10. vergab Supabase automatisch alle Rechte; ab dann keine. Beides
-- abdecken: erst alles weg, dann nur das Noetige.
revoke all on public.fed_rate_changes from anon, authenticated;
grant select on public.fed_rate_changes to anon, authenticated;
grant select, insert, update, delete on public.fed_rate_changes to service_role;
