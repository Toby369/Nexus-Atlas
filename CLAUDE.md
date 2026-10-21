@AGENTS.md

# Sprache

Antworte Toby immer auf Deutsch — auch die ganze Konversation über, nicht nur einzelne Nachrichten.

# Supabase: neue Tabellen brauchen GRANTs

Seit dem 30.10.2026 vergibt Supabase für neue Tabellen im Schema `public` keine Data-API-Rechte mehr automatisch (Mail von Supabase vom 20.10.2026). Bestehende Tabellen sind nicht betroffen. Wer eine Tabelle neu anlegt oder neu erstellt (auch nach einem `drop`), schreibt die Rechte in dieselbe Migration, sonst meldet die App „permission denied“:

```sql
-- Muster in Nexus: RLS an, öffentlich lesbar, Schreiben nur serverseitig (Service-Role)
alter table public.meine_tabelle enable row level security;
create policy "Public read access" on public.meine_tabelle for select using (true);
grant select on public.meine_tabelle to anon, authenticated;
grant select, insert, update, delete on public.meine_tabelle to service_role;
```

Tabellen ohne Lesezugriff aus dem Browser (z. B. `push_subscriptions`) bekommen nur den `service_role`-Grant und keine Policy. Hat die Tabelle eine `identity`- oder `serial`-Spalte, braucht `service_role` zusätzlich `grant usage on sequence ...`.
