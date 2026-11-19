# Übergabe NEXUS Atlas (Stand 24.10.2026)

Claude Code wird Ende Oktober 2026 pausiert. Diese Datei sagt einer neuen
Claude-Sitzung (oder einem Menschen), wo alles liegt und wie man wieder
einsteigt. Technische Details stehen im `README.md`, Arbeitsregeln in
`CLAUDE.md` und `AGENTS.md`.

## Was ohne Claude weiterläuft

Alles. Claude wird nur für Änderungen am Code gebraucht.

- **Datensammlung:** 31 aktive pg_cron-Jobs in Supabase rufen die Edge
  Functions auf (5 Min. bis wöchentlich). Kein eigener Server.
- **App:** Vercel-Projekt `nexus-atlas`, deployt automatisch bei jedem
  Merge auf `main`.
- **Pushes/Reports:** laufen über die Supabase-Crons
  (`send-state-change-push`, `report-scheduler`).

## Zugänge (nur wo sie liegen, keine Werte)

| Dienst | Was | Wo |
|---|---|---|
| GitHub | Repo `Toby369/Nexus-Atlas`, Branch `main` | github.com |
| Supabase | Projekt `NEXUS Project`, ID `cpktesxmbqrzpsurntul`, Region eu-west-3, Free-Plan | supabase.com/dashboard |
| Vercel | Projekt `nexus-atlas` (Hobby-Plan) | vercel.com/dashboard |
| Env-Variablen | Liste in `.env.example`; Werte in Vercel → Settings → Environment Variables | Vercel |
| Secrets der Edge Functions | Supabase → Edge Functions → Secrets bzw. `get_secret`-Funktion (Vault) | Supabase |

Die Vercel-Projekte `nexus-v1-2ebu` und `nexus-v1-szjf` sind alte Versuche
aus dem August und werden nicht gebraucht (können gelöscht werden).

## Stand bei der Pause

- Keine offenen Pull Requests, `main` ist sauber (letzter Merge: PR #46,
  Regelcheck/Veto/Reiter Wochenblick).
- Offene Ideen und Folgepunkte: `docs/research/IDEEN-BACKLOG.md`.
- Forschungsberichte (Backtests, Protokolle, Ergebnisse): `docs/research/`.

## Sicherung von Supabase im Repo (Stand 24.10.2026)

Datenbank und Edge Functions wurden direkt in Supabase angelegt (per
Supabase-MCP). Am 24.10.2026 wurde alles ins Repo gesichert:

- `supabase/migrations/`: alle 279 Migrationen aus
  `supabase_migrations.schema_migrations`, eine Datei pro Migration.
- `supabase/schema/`: Katalog-Stand zum selben Zeitpunkt, als Referenz:
  `tables.sql` (57 Tabellen/Views mit Policies und Rechten),
  `functions.sql` (94 Funktionen), `cron-jobs.sql` (31 pg_cron-Jobs),
  `schema-snapshot.json` (alles zusammen, maschinenlesbar).
- `supabase/functions/`: alle 37 deployten Edge Functions.

**Massgeblich bleibt der deployte Stand in Supabase.** Wer eine Funktion
ändert, deployt sie und schreibt die Änderung auch ins Repo, sonst laufen
beide wieder auseinander. Neue DB-Änderungen als Migration anlegen und die
Datei zusätzlich unter `supabase/migrations/` ablegen.

## Offene Aufräum-Punkte

- ~~Acht stillgelegte Edge Functions in Supabase löschen~~ erledigt
  29.10.2026 (Toby im Dashboard: `debug-*`, alte `nexus-*`,
  `backfill-title-de`).
- **Einmal-Backfills** (`backfill-*`) haben keinen Cron und werden nur bei
  Bedarf von Hand aufgerufen.
- **FOMC-Termine 2027 nachtragen:** `collect-economic-calendar` kennt nur
  die Termine 2026. Nach dem 09.12.2026 fehlt der nächste Zinsentscheid,
  bis die Liste um 2027 ergänzt ist (federalreserve.gov, FOMC-Kalender).
- `collect-btc-price-history-daily` und `youtube-monitor-scheduler` haben
  aktuell keinen Cron-Job.

## Termine

- **Ab 15.11.2026: Archiv-Kacheln entscheiden.** Welche Kacheln im Reiter
  „Archiv“ werden genutzt, welche können weg? Grundlage ist der
  Nutzungszähler (Tabelle `tile_usage`, Auswertung auch auf der Konto-Seite
  unter „Nutzung der Kacheln“). Am 29.10. lagen erst 13 Einträge aus zwei
  Tagen vor, zu wenig. Abfrage:
  ```sql
  select item, count(*) klicks, max(created_at)::date zuletzt
  from tile_usage where created_at > now() - interval '30 days'
  group by item order by klicks desc;
  ```
  Kacheln ohne Klick in drei Wochen sind Kandidaten zum Entfernen (Kachel in
  `lib/dashboardTiles.ts` und `lib/dashboardTabs.ts` austragen, Komponente
  löschen). Hintergrund: `docs/research/AUTARK-BAUWEISE-FUER-NEXUS_2026-10-29.md`,
  Punkt J.
- **Signal-Statistik ansehen** (läuft jeden Montag 05:00 UTC,
  `weekly-signal-stats`): `select * from signal_stats_results where
  significant_after_bh` zeigt Signale, die sich signifikant von der
  Basisrate unterscheiden -- auch nach UNTEN (siehe Punkt H im
  Recherche-Dokument).

## Risiko: Supabase pausiert inaktive Gratis-Projekte

Free-Projekte werden nach rund 7 Tagen ohne Nutzung pausiert. Nexus
regelmässig öffnen verhindert das. Falls doch pausiert: Supabase-Dashboard →
Projekt → „Restore“. Daten bleiben erhalten, die Crons laufen danach wieder.

## Wieder einsteigen (für Claude)

1. `CLAUDE.md`, `AGENTS.md`, `README.md` und diese Datei lesen.
2. Wenn die Next.js-Version sich geändert hat: Doku unter
   `node_modules/next/dist/docs/` lesen (siehe `AGENTS.md`).
3. Supabase-Projekt `cpktesxmbqrzpsurntul` prüfen: Status, Advisors, Logs,
   `select jobname, active from cron.job`. Vor Änderungen an einer Edge
   Function den deployten Stand mit `supabase/functions/` vergleichen.
4. Vor jedem Push lokal prüfen:
   `npx tsc --noEmit && npx eslint . && npm test && npx next build`
5. Neue Tabellen: GRANTs in dieselbe Migration (Regel in `CLAUDE.md`).
6. Mit Toby immer auf Deutsch kommunizieren.
