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

## Wichtig: Nicht alles liegt im Repo

Die Datenbank und die meisten Edge Functions wurden direkt in Supabase
angelegt (per Supabase-MCP), nicht über Dateien im Repo:

- **Datenbank-Schema:** rund 290 Migrationen existieren nur in Supabase
  (`supabase_migrations`), es gibt kein `supabase/migrations/` im Repo.
- **Edge Functions:** 37 sind in Supabase deployt, nur 6 davon liegen unter
  `supabase/functions/` (`collect-candles`, `collect-options`,
  `collect-term-basis`, `nexus-news-analyst`, `nexus-news-collector`,
  `send-state-change-push`).

Für Claude ist das kein Hindernis: Mit dem Supabase-Connector kann es
Migrationen, Funktionen und Crons direkt lesen und ändern. Ohne Supabase-
Zugang wäre der Code dieser Funktionen aber nicht greifbar. Vor einer
Änderung an einer Funktion, die nicht im Repo liegt, zuerst den deployten
Stand aus Supabase holen.

## Risiko: Supabase pausiert inaktive Gratis-Projekte

Free-Projekte werden nach rund 7 Tagen ohne Nutzung pausiert. Nexus
regelmässig öffnen verhindert das. Falls doch pausiert: Supabase-Dashboard →
Projekt → „Restore“. Daten bleiben erhalten, die Crons laufen danach wieder.

## Wieder einsteigen (für Claude)

1. `CLAUDE.md`, `AGENTS.md`, `README.md` und diese Datei lesen.
2. Wenn die Next.js-Version sich geändert hat: Doku unter
   `node_modules/next/dist/docs/` lesen (siehe `AGENTS.md`).
3. Supabase-Projekt `cpktesxmbqrzpsurntul` prüfen: Status, Advisors, Logs,
   `select jobname, active from cron.job`.
4. Vor jedem Push lokal prüfen:
   `npx tsc --noEmit && npx eslint . && npm test && npx next build`
5. Neue Tabellen: GRANTs in dieselbe Migration (Regel in `CLAUDE.md`).
6. Mit Toby immer auf Deutsch kommunizieren.
