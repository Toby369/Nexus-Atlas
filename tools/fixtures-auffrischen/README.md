# Fixtures der Börsen auffrischen

`lib/boersenVertrag.test.ts` prüft die Sammler `collect-btc` und
`collect-positioning` gegen gespeicherte echte Börsen-Antworten
(`supabase/functions/_fixtures/`). So fällt ein geändertes Schema einer Börse
im Test auf und nicht erst als still falsche Zahl in einer Kachel.
Hintergrund: [docs/research/AUTARK-BAUWEISE-FUER-NEXUS_2026-10-29.md](../../docs/research/AUTARK-BAUWEISE-FUER-NEXUS_2026-10-29.md), Punkt C.

Etwa einmal im Monat oder wenn eine Börse in der Datenstand-Ampel rot ist:

```bash
node tools/fixtures-auffrischen/fixtures-auffrischen.mjs
npm test
git diff supabase/functions/_fixtures/   # was hat sich geändert?
```

Das Skript braucht Zugang zu den Börsen (PC oder VPS). Die Claude-Cloud-Umgebung
sperrt die Börsen. Dort geht es über `pg_net` in der Datenbank
(`select net.http_get(url)`, Antwort in `net._http_response`), so wurden die
ersten Fixtures am 29.10.2026 aufgezeichnet.

Fällt ein Test nach dem Auffrischen: Die Meldung nennt Börse und Feld (z. B.
`Bybit: Feld "markPrice" fehlt`). Dann `supabase/functions/_shared/boersenParser.ts`
anpassen und beide Sammler neu deployen.
