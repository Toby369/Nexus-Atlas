# Log-Ingestion senken – Plan (12.10.2026)

Supabase Free-Plan: Log Ingestion 1,57 / 1 GB (157 %), Status „UPCOMING“
(noch nicht durchgesetzt). Ziel: deutlich unter 1 GB/Monat, ohne Funktionen
oder Datenqualität zu verlieren.

## Phase 0 – Ausgangslage (Messung 24 h, `query_logs`)

| Quelle | Einträge/Tag | Anteil Volumen |
|---|---|---|
| API-Gateway (`edge_logs`) | 28'850 | ~88 % |
| Postgres | 8'236 | ~6 % |
| Edge Functions (Aufrufe + Konsole) | 8'276 | ~4 % |
| Rest | ~300 | < 2 % |

Jeder REST-/RPC-Aufruf ist ein `edge_logs`-Eintrag → **Hebel = Anzahl API-Aufrufe**.

Grösste Verursacher (Aufrufe/Tag):

| Verursacher | Aufrufe | Ursache |
|---|---|---|
| `nexus-news-analyst` | 4'800 PATCH + 96 GET | bewertet alle 15 Min die neuesten 50 News neu und schreibt **jede einzeln** zurück – auch wenn sich nichts ändert (Bewertung ist deterministisch) |
| `nexus-news-collector` | ~3'800 GET + 580 GET `news_sources` + Inserts | prüft **jeden Feed-Eintrag einzeln** auf Duplikat, lädt die Quell-ID pro Feed und Lauf neu |
| Browser (Dashboard) | ~5'500 | ~15 Komponenten pollen per `setInterval`, auch wenn der Tab im Hintergrund ist |
| Vercel-Server (`node`) | ~1'700 | API-Routen (Briefing, Kontexte) |
| `rpc/get_secret` | 535 | Edge Functions holen Schlüssel bei jedem Lauf per RPC |
| Sammler (5-Min-Jobs) | je ~290 | 1 Schreibzugriff pro Lauf – nötig |
| einmalig 12.10. | ~2'750 | Archiv-Export (`python-requests`), fällt weg |

## Phase 1 – News-Funktionen bündeln (−~8'400 Aufrufe/Tag, ~30 %)

- **news-analyst:** nur Zeilen zurückschreiben, deren berechnete Werte sich von den
  gespeicherten unterscheiden. Ergebnis identisch, im Normalfall 0 Updates pro Lauf.
- **news-collector:** Quell-IDs einmal pro Lauf laden; Duplikatprüfung pro Feed mit
  einer `in(external_id, …)`-Abfrage statt pro Eintrag; neue Einträge pro Feed
  gesammelt einfügen. Ergebnis identisch.
- Quellcode beider Funktionen neu im Repo unter `supabase/functions/` (bisher nur in
  Supabase vorhanden).

**Umgesetzt 12.10.2026, ~16:13 UTC** (analyst v10, collector v19). Messung pro
15-Min-Slot, nur Aufrufe der News-Funktionen:

| Slot | GET news_events | PATCH | GET news_sources | Summe |
|---|---|---|---|---|
| vorher (15:00–16:00, je) | 26 | 50 | 6 | ~82 |
| 16:30 (erster regulärer Lauf danach) | 2 | 0 | 1 | 3 |

→ von ~7'900 auf ~300 Aufrufe pro Tag (−96 %). Neue News werden weiter erfasst,
übersetzt und bewertet (Testlauf: 8 neu, 60 Duplikate übersprungen, 7 Bewertungen
geschrieben).

## Phase 2 – `get_secret` (−~535/Tag)

Prüfen, welche Edge Functions `get_secret` pro Lauf aufrufen; Schlüssel als
Edge-Function-Secret (`Deno.env`) bereitstellen statt per RPC. Braucht Toby im
Dashboard (Secrets setzen).

## Phase 3 – Browser-Polling pausieren (bis −~5'000/Tag, je nach Nutzung)

Gemeinsamer Hook: Intervalle laufen nur bei sichtbarem Tab, beim Zurückkehren
sofort einmal laden. Betrifft u.a. `DashboardPollProvider`, `LivePriceDataProvider`,
`HeroHeader`, `RegimeMatrixCard`, `LiquidationPanel`, `MarketContextCard`,
`NewsRiskPanel`, `EtfFlowPanel`, `SpotPerpFlowPanel`, `EconomicCalendarPanel`.
PR #12 der Aufräum-Session ist bereits gemergt, kein Konflikt.

**Umgesetzt 12.10.2026:** `lib/visibleInterval.ts` (`setVisibleInterval`, mit Tests)
ersetzt `setInterval` in 17 Daten-Abfragen in 12 Komponenten. Unverändert bleiben
reine Uhr-/Zeitanzeigen (`TradingHoursBadge`, `ClientTimestamp`, Freshness-Check im
`HeroHeader`, Stale-Check im `LivePriceDataProvider`) und `OfflineBanner` (war schon
sichtbarkeitsabhängig). Wirkt erst nach dem Vercel-Deploy von `main`; Messung danach.

### Messung 13.10.2026 (24 h, 12.10. 17:30 – 13.10. 17:30 UTC, nach Phase 1 + 3)

| Quelle | 12.10. (Ausgangslage) | 13.10. | Veränderung |
|---|---|---|---|
| API-Gateway (`edge_logs`) | 28'850 (davon ~2'750 einmaliger Export) | 18'736 | −35 % (−28 % ohne Export) |
| Postgres | 8'236 | 6'257 | −24 % |
| Edge Functions (Konsole) | 5'656 | 4'345 | −23 % |
| Edge Functions (Aufrufe) | 2'620 | 1'875 | −28 % |

- **News-Funktionen:** nicht mehr unter den 25 grössten Posten (vorher ~8'700/Tag).
- **Pause bei verstecktem Tab wirkt:** zwischen 19 und 05 UTC kein einziger Browser-Aufruf.
- **Neuer Hauptposten ist der sichtbare Browser:** ~10'200 Aufrufe an diesem Tag, bis zu
  ~1'900 pro Stunde bei offener App (1 Gerät). Treiber sind die 30-Sekunden-Abfragen in
  `LivePriceDataProvider` (3 Abfrageschleifen, 5 Endpunkte) und `DashboardPollProvider`
  plus CORS-Preflights (`OPTIONS`), obwohl die zugrundeliegenden Sammler nur alle
  5 Minuten neue Daten schreiben.

**Entscheid Toby 13.10.:** 30-s-Abfragen auf 60 s (`DashboardPollProvider`,
`LivePriceDataProvider`) → halbiert den grössten verbleibenden Posten; Daten erscheinen
bis zu 60 s statt 30 s nach dem Sammeln. Umgesetzt im selben PR wie diese Messung.

### Messung 16.10.2026 (3 Tage nach 60-s-Polling)

| Quelle | 12.10. | 13.10. | 15.10. | 16.10. |
|---|---|---|---|---|
| API-Gateway (`edge_logs`) | 28'850 | 18'736 | 11'076 | **9'736** (−66 %) |
| Postgres | 8'236 | 6'257 | 7'073 | 7'030 |

Am 16.10. (24 h bis 19:30 UTC): 7'972 Aufrufe von Edge Functions/Sammlern, 1'731 vom
Vercel-Server, nur 27 aus dem Browser (App kaum offen) – die Browser-Ersparnis durch
60 s ist an diesem Tag deshalb nicht messbar; bei offener App sind ~5'000/Tag zu erwarten.

Hochrechnung: ~0,6–0,8 GB Log-Ingestion pro Monat (vorher 1,57 GB) → unter 1 GB.

DB-Grösse 16.10.: 410 MB. `market_features` nach `fillfactor = 80` + `vacuum full`
(Toby, 16.10.) und `collect-candles` v20 (nur geänderte Zeilen, PR #36) stabil bei 86 MB.

**Fazit:** keine weiteren Schritte nötig. Verbleibende Hebel nur bei Bedarf: Takt der
5-Min-Sammler (Phase 4), Research-Activation-Tabellen auf Zeitfenster, Aufbewahrungsfrist
für Snapshots.

## Phase 4 – Takt der Sammler (Entscheid Toby)

5-Min-Sammler (btc, positioning, liquidations, spot-pressure, orderbook,
spot-volume-profile) erzeugen je ~290 Aufrufe/Tag. Nur anfassen, wenn nach
Phase 1–3 noch nötig – das ist eine fachliche Entscheidung (Datenauflösung).

## Messung

Nach jeder Phase 24 h abwarten und dieselbe `query_logs`-Abfrage wiederholen;
Ergebnis hier nachtragen.
