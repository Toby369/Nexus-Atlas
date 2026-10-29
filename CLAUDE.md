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

Bis zum 30.10.2026 vergibt Supabase neuen Tabellen noch automatisch **alle** Rechte an `anon`/`authenticated`. Nicht benötigte Rechte (v. a. `insert`, `update`, `delete`, `truncate`) in derselben Migration mit `revoke` zurücknehmen und die Rechte danach in `information_schema.role_table_grants` prüfen.

# Supabase: Datenbank unter 500 MB halten

Nexus läuft im Free-Plan von Supabase: **höchstens 0,5 GB**. Wird die Grenze überschritten, schaltet Supabase die Datenbank auf „nur lesen“, und die Sammel-Funktionen schreiben nichts mehr. Stand 29.10.2026 nach dem Aufräumen: **289 MB** (vorher 411 MB; Supabase zählt fürs Kontingent etwas mehr). Wachstum ca. 2–3 MB pro Tag. Aktueller Wert: Konto-Seite („Datenbank-Speicher“).

- Vor jeder neuen Tabelle oder jedem neuen Sammel-Job abschätzen, wie viel sie pro Tag wächst, und eine Aufbewahrungsfrist mitbauen (Muster: `downsample_old_snapshots()` verdichtet ab 35 Tagen, `purge_old_snapshots()` löscht ab 90 Tagen, beide per pg_cron).
- Keine Forschungs-/Backtest-Historien dauerhaft in der Live-Datenbank ablegen (die Score-Tabellen mit ~125 MB waren der Grund für den Engpass im Oktober 2026).
- Grösse prüfen: `select pg_size_pretty(pg_database_size(current_database()));` oder die Konto-Seite. Ab **400 MB** Toby informieren und Aufräum-Optionen vorschlagen (Aufbewahrung kürzen, grosse Tabellen prüfen, sonst Pro-Plan für 25 $/Monat). Nie ohne Tobys Okay Daten löschen.
