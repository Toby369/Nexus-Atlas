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

## Phase 2 – `get_secret` (−~535/Tag)

Prüfen, welche Edge Functions `get_secret` pro Lauf aufrufen; Schlüssel als
Edge-Function-Secret (`Deno.env`) bereitstellen statt per RPC. Braucht Toby im
Dashboard (Secrets setzen).

## Phase 3 – Browser-Polling pausieren (bis −~5'000/Tag, je nach Nutzung)

Gemeinsamer Hook: Intervalle laufen nur bei sichtbarem Tab, beim Zurückkehren
sofort einmal laden. Betrifft u.a. `DashboardPollProvider`, `LivePriceDataProvider`,
`HeroHeader`, `RegimeMatrixCard`, `LiquidationPanel`, `MarketContextCard`,
`NewsRiskPanel`, `EtfFlowPanel`, `SpotPerpFlowPanel`, `EconomicCalendarPanel`.
Abstimmen mit der Aufräum-Session (PR #12 ändert ebenfalls Komponenten).

## Phase 4 – Takt der Sammler (Entscheid Toby)

5-Min-Sammler (btc, positioning, liquidations, spot-pressure, orderbook,
spot-volume-profile) erzeugen je ~290 Aufrufe/Tag. Nur anfassen, wenn nach
Phase 1–3 noch nötig – das ist eine fachliche Entscheidung (Datenauflösung).

## Messung

Nach jeder Phase 24 h abwarten und dieselbe `query_logs`-Abfrage wiederholen;
Ergebnis hier nachtragen.
