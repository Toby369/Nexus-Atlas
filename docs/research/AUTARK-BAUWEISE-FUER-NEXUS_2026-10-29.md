# Was Nexus von AutarkTrades Bauweise lernen kann (29.10.2026)

Toby erlebt AutarkTrade als strukturiert und systematisch aufgebaut. Hier steht,
woran das im Code liegt und was davon für Nexus taugt. Es geht um die
**Bauweise**, nicht um Funktionen: welche Funktion wo geführt wird, regelt schon
[AUTARK-NEXUS-PLAN_2026-10-28.md](AUTARK-NEXUS-PLAN_2026-10-28.md).

## Vorgehen

- AutarkTrade 4.3.1 (`Mouses007/AutarkTrade`, Stand 29.10.2026) gelesen: README,
  `src/config/`, `src/components/basis/`, `src/assets/design/tokens.css`,
  `src/stores/README.md`, `shared/`, die Selbsttests und Kernmodule im Server
  (`lagebild.js`, `boersen-status.js`, `drossel.js`, `radar-ergebnisse.js`,
  `quellen/`).
- Nexus daneben gezählt (Stand Commit `b4e46f5`). Zahlen unten sind
  `grep`-Zählungen, keine Schätzungen.

## Kurzfazit

AutarkTrade wirkt systematisch, weil **jede wiederkehrende Frage genau eine
Antwort an genau einer Stelle hat**: welche Seiten und Kacheln es gibt (ein
Register), wie eine Karte, ein Leerzustand oder eine Quellenzeile aussieht (ein
Baustein), welche Farben es gibt (eine Datei), was eine Fremdquelle liefern muss
(ein Test). Nexus hat dieselben Ideen oft schon angefangen (Kachel-Register,
Design-Tokens, Handelszeiten, Info-Ⓘ), führt sie aber nicht durch: die
Kacheln bauen Hülle, Leerzustand, Quelle und Datenstand jede für sich.

Die drei Punkte mit dem grössten Nutzen für Nexus:

1. **Datenstand und Ausfälle sichtbar machen** (39 Edge Functions, keine
   gemeinsame Übersicht, ob sie laufen).
2. **Grundbausteine** für Karte, Leerzustand und Quellenzeile (56 von Hand
   gebaute Karten-Hüllen, 19 eigene „keine Daten“-Texte).
3. **Datenvertrag-Test** gegen gespeicherte echte Börsen-Antworten (heute
   würde eine geänderte API eine Kachel still falsch machen).

## Teil 1: Die zehn Bauprinzipien von AutarkTrade

| # | Prinzip | Wo im Code | Kernsatz aus dem Code |
|---|---|---|---|
| 1 | **Register als reine Datenmodule** | `src/config/menu.js`, `marktradar.js`, `kachel-registry.js` | Jede Kachel ist ein Datensatz: `id`, Titel, Endpunkt, `intervallMs`, Breite, `quelle`, Info-Schlüssel. Reihenfolge getrennt davon in `STANDARD_REIHENFOLGE`. „Eine Kachel darf nie verschwinden.“ |
| 2 | **Grundbausteine statt Einzelbau** | `src/components/basis/` (Karte, Knopf, Pille, Reiter, Tabelle, Dialog, Seitenkopf, Hinweis, Leerzustand, Kreisel, Quellenhinweis) | Neue Seiten setzen sich aus 14 Bausteinen zusammen. |
| 3 | **Eine Datei mit allen Farben** | `src/assets/design/tokens.css` | „Diese Datei ist die EINZIGE Stelle mit Farbwerten.“ Türkis heisst überall „hier kannst du etwas tun / diese Zahl zählt“, Grün/Rot nur Gewinn/Verlust. Auch Abstände und Radien als Token. |
| 4 | **Ehrliche Zustände** | README, `boersen-status.js`, `Leerzustand.vue` | „Ein leerer Ticker darf nie wie ein ruhiger Markt aussehen.“ Eine Kachel ohne Quelle sagt, warum. Ein Filter, der alles ausblendet, sagt, wie viel er versteckt. Zugangsfehler (bleibt) und Aussetzer (geht vorbei) werden getrennt gemeldet. |
| 5 | **Quelle an jeder Zahl** | `basis/Quellenhinweis.vue`, `Q` in `marktradar.js` | Quellen sind Daten im Register, nicht Text in der Kachel: „Daten: Binance“, „Quelle: Alternative.me“, „KI-generiert · Claude“. Leise, aber nie ausgeblendet. |
| 6 | **KI liest nur ab, was der Code gemessen hat** | `server/lagebild.js`, KI-Chartanalyse | Die Gesamtlage-KI sieht nur die Zeilen der anderen Kacheln (in der Grossansicht als „Basis“ gezeigt). Die Chart-KI wählt nur per ID aus vom Code gemessenen Marken, kann also keine Preise erfinden. Antwort wird auf feste Stimmungen und Punktzahl normalisiert. |
| 7 | **Datenvertrag mit Fremdquellen** | `server/__selftest-datenvertrag.mjs`, `server/fixtures/`, `scripts/fixtures-auffrischen.mjs` | „Die Rechnung war korrekt — sie rechnete nur mit nichts.“ Test prüft gegen gespeicherte echte Antworten, welche Felder der Code voraussetzt. |
| 8 | **Erfolgsmessung, die sich nicht selbst belügt** | `server/radar-ergebnisse.js` | Behauptung beim Lauf einfrieren, später messen. Immer mit Kontrollgruppe (Zufallsstichprobe aus der unteren Hälfte). Gewichte werden nicht automatisch auf denselben Zeitraum optimiert. Gruppen unter vier Fällen grau statt als Befund. |
| 9 | **Reine Rechenmodule mit eigenem Selbsttest** | `shared/*.js` + `__selftest-*.mjs` (über 100), `scripts/run-selftests.mjs` | Rechnungen ohne Netz, Datenbank und UI, im Browser und Server gleich. Ein Befehl (`npm run test:self`) startet alle. Tests prüfen gezielt die Fehler, die still danebengehen (Einheit Faktor 100, vertauschte Long/Short-Richtung). |
| 10 | **Begründung im Code, mit Datum und Vorfall** | praktisch jede Datei | Kopfkommentar sagt *warum* („Am 14.09.2026 lief der Pionex-Schlüssel ab …“) und was man nicht tun soll. Dazu Schutz vor teuren Doppelklicks (`drossel.js`) und abschaltbare Modi („aus heisst aus, nicht versteckt“). |

## Teil 2: Abgleich mit Nexus

| # | Prinzip | Nexus heute | Stand |
|---|---|---|---|
| 1 | Register | `lib/dashboardTiles.ts` + `lib/dashboardTabs.ts`; neue Kacheln im gespeicherten Layout werden ergänzt (`DashboardLayout.tsx`). Register kennt aber nur `id`, `title`, `size`. Abfragetakt, Quelle und Info-Text stecken in jeder Komponente. | teilweise |
| 2 | Grundbausteine | Kein Ordner dafür. `rounded-(lg\|xl) border border-border bg-surface` 56-mal von Hand, 19 Komponenten mit eigenem „keine Daten“-Text. Gut: `PanelInfo` (32 Nutzungen), `ClientTimestamp` (14). | fehlt grösstenteils |
| 3 | Farb-Tokens | `app/globals.css` mit Tokens und geprüften Kontrastwerten, Farbwelt schon nach AutarkTrade (22.10.). Abstände/Radien noch als lose Tailwind-Klassen. | weitgehend da |
| 4 | Ehrliche Zustände | Einzelne Kacheln zeigen Alter/„veraltet“. **Korrektur 29.10.:** `data_quality` (seit 27.08., stündlich von `refresh_data_quality()` aus den Rohdaten berechnet) gibt es schon, wird aber nirgends angezeigt, ist bis 60 Min alt und kennt Bitunix/Pionex nicht. | in der DB da, in der App fehlte es (A/B umgesetzt, siehe unten) |
| 5 | Quelle an jeder Zahl | Quellenzeile in 7 Komponenten, je eigener Wortlaut. | teilweise |
| 6 | KI liest nur ab | KI-Einordnung, System-Briefing, Zweitmeinungen. Kontext wird in `lib/*Context.ts` gebaut und teils getestet (`systemBriefingContext.test.ts`), die Grundlage wird in der Oberfläche aber nicht als „Basis“ gezeigt. | teilweise |
| 7 | Datenvertrag | Keine gespeicherten Börsen-Antworten, keine Tests für die Parser in den Edge Functions (Deno). | fehlt |
| 8 | Erfolgsmessung | Stark: `signal_outcomes`, `divergence_radar_outcomes` mit pgTAP, viele Backtests mit Protokoll vor Ergebnis (`docs/research/*-PROTOCOL`). Kontrollgruppe/Basisrate nicht durchgehend. | weitgehend da |
| 9 | Reine Module + Tests | Stark: 67 Testdateien in `lib/`, `npm test`. Kein CI-Lauf vor dem Merge (kein `.github/`). | weitgehend da |
| 10 | Begründung im Code | Gleiche Kultur (datierte Toby-Kommentare). Abschaltbarkeit über Reiter „Archiv“, Nutzungszähler (`TileUsageSummary`). 3 `debug-*`-Edge-Functions liegen noch im Repo. | da |

Schon von AutarkTrade übernommen: Farbwelt, Handelszeiten mit Zone je Sitzung
(`lib/tradingHours.ts`), Tagesplan-Logik, Zonen und Alarme per Sync.

## Teil 3: Empfehlungen, nach Nutzen geordnet

### Stufe 1: Vertrauen in die Zahlen (zuerst)

**A. Datenstand-Übersicht „Läuft alles?“**
Eine Tabelle oder View `collector_status` (Funktion, letzter Erfolg, letzter
Fehler, erwarteter Takt), von jeder Edge Function am Ende des Laufs
geschrieben, nach dem Muster von `autark_sync_status`. Anzeige: kleine Ampel
in der Kopfzeile (grün = alle im Takt, gelb = eine überfällig) und eine Liste
im Konto. Fehlerarten wie in `boersen-status.js` trennen: „Zugang weg“ (Push)
gegen „Börse kurz nicht erreichbar“ (nur Anzeige).
*Warum zuerst:* Nexus zeigt Einschätzungen aus 4 Börsen, ETF-Flows und News.
Fällt ein Sammler aus, sieht das Lagebild heute normal aus. Genau der Fall, den
AutarkTrade am 14.09. erlebt hat.
*Neue Tabelle:* Grants laut CLAUDE.md in dieselbe Migration.

**B. Frische je Kachel aus dem Register**
`DashboardTileMeta` um `takt` (erwartetes Intervall) ergänzen. Ein gemeinsamer
Kachelkopf zeigt „Stand vor 4 Min“ und färbt sich gelb, wenn das Alter über
dem doppelten Takt liegt. Damit wird `ClientTimestamp` überall gleich genutzt.

**C. Datenvertrag-Test**
Je Börse eine echte Antwort als JSON unter `supabase/functions/_fixtures/`
ablegen, die Parser-Funktionen in reine Module ziehen und mit Vitest prüfen,
dass die vorausgesetzten Felder da sind und Zahlen sind. Ein kleines Skript
frischt die Fixtures auf. Besonders wichtig bei Bitunix und Pionex (kleinere
Börsen, Schemata ändern sich eher).

### Stufe 2: Einheitliches Bild (danach)

**D. Ordner `components/basis/`** mit `Karte` (Hülle, Kopf mit Titel, Ⓘ,
Datenstand), `Leerzustand` (Titel, ein Satz warum, optional Knopf),
`Quellenhinweis` (Quellen als Daten: `daten` / `quelle` / `ki`), `Hinweis`
(Info/Warnung/Fehler), `Pille`. Neue Kacheln nur noch damit; bestehende beim
nächsten Anfassen umstellen, nicht in einem grossen Umbau.

**E. Register erweitern** um `quelle` und `info` (Text für `PanelInfo`), damit
Quellenzeile und Ⓘ an einer Stelle gepflegt werden. Danach sind die
Kachel-Komponenten nur noch Inhalt.

**F. Abstände und Radien als Token** in `globals.css` (`--radius-karte`,
`--abstand-*`), damit die Kacheln gleich atmen.

### Stufe 3: KI und Auswertung schärfen

**G. „Basis“ unter jedem KI-Text** aufklappbar zeigen: die Zeilen, die die KI
gesehen hat. Die Kontext-Bauer in `lib/*Context.ts` liefern sie schon.
Dazu ein Einheiten-Test wie `__selftest-lagebild.mjs`: Funding als
Dezimalbruch gegen Prozent, Long- gegen Short-Liquidationen.

**H. Kontrollgruppe in der Erfolgsmessung**: bei Divergenz-Radar und
Setup-Score neben den gemeldeten Fällen eine Zufallsstichprobe nicht gemeldeter
Zeitpunkte gleich messen. Gruppen unter einer Mindestzahl grau anzeigen.

**I. Tests vor dem Merge**: eine GitHub Action, die `npm run lint` und
`npm test` bei jedem PR laufen lässt (AutarkTrade hat das auch nicht, aber
Nexus hat die Tests schon, sie laufen nur nicht automatisch).

**J. Aufräumen**: `debug-fetch-farside`, `debug-fetch-openrouter-free`,
`debug-test-webpush-import` prüfen und entfernen, wenn nicht mehr gebraucht.
Mit dem Nutzungszähler entscheiden, welche Archiv-Kacheln wegfallen (Phase C im
Autark-Plan).

## Teil 4: Bewusst nicht abschauen

- **Funktionen, die AutarkTrade führt** (Chart, Tagebuch, Sitzungsplan,
  Hype-/Coin-Radar, Portfolio): Rollen laut Autark-Plan, nicht doppelt bauen.
- **Frei ziehbare Kachel-Raster überall:** Nexus hat sich mit festen Reitern
  („Trade“ fest, Rest thematisch) bewusst für weniger Freiheit und mehr Fokus
  entschieden.
- **Zweisprachigkeit (i18n):** Nexus ist nur für Toby, Deutsch reicht.
- **Eigener Test-Läufer ohne Framework:** Nexus hat Vitest, das ist besser.

## Umsetzung A + B (29.10.2026)

- **RPC `get_data_freshness()`** (Migration `20261029100000_get_data_freshness.sql`):
  jüngster Zeitstempel je Quelle direkt aus den Rohdaten, über vorhandene
  Zeit-Indizes und ein 24-Std-Fenster. Keine neue Tabelle, keine Änderung an
  den Sammlern, also kein zusätzlicher Speicher (DB 411/500 MB). Gemessen ~26 ms.
- **`lib/dataFreshness.ts`**: Register aller Quellen mit dem Alter, das im
  gesunden Betrieb höchstens vorkommt (gegen die grösste Lücke der Woche davor
  geprüft). Gelb über dem Normalalter, rot ab dem Dreifachen oder ohne Daten.
- **Ampel in der Kopfzeile** (`components/DataStatusLight.tsx`), Klick führt
  zur Liste aller Quellen im Konto (`/account#datenstand`).
- **Kachelkopf** (`components/TileFreshness.tsx`): „vor 4 Min“, bei
  Verspätung gelb/rot mit dem Namen der Quelle. Quellen je Kachel stehen im
  Register `lib/dashboardTiles.ts` (Feld `quellen`).
- **Log-Ingestion:** ein gemeinsamer Abruf je Seite, alle 5 Min, nur bei
  sichtbarem Tab (`lib/dataFreshnessStore.ts`).
- Bewusst ausgelassen: Liquidationen (keine Liquidation = ruhiger Markt, kein
  Ausfall) und die KI-Kacheln, die auf Knopfdruck entstehen.
- **Nebenbefunde:** Binance-Liquidationen wurden laut `liquidation_events` nie
  gespeichert (nur Bybit). In `data_quality` steht `bgeometrics/miner-net-flow`
  seit gut 60 Tagen ohne Daten.

## Umsetzung C (29.10.2026): Datenvertrag mit den Börsen

- **`supabase/functions/_shared/boersenParser.ts`**: das Auslesen der
  Antworten aus `collect-btc` (6 Börsen) und `collect-positioning` (4 Börsen)
  als reine Funktionen. Pflichtfelder werfen mit Börse und Feldnamen, statt
  still `NaN` zu speichern (Postgres nimmt `NaN` in `numeric` an).
- **Fixtures**: 20 echte Antworten unter `supabase/functions/_fixtures/`,
  aufgezeichnet über `pg_net` (die Cloud-Umgebung sperrt die Börsen direkt).
- **`lib/boersenVertrag.test.ts`**: prüft Felder, Einheiten (Funding als
  Dezimalbruch, BTC-Preisbereich, Mark/Last-Abstand, OI × Preis = OI in USD),
  Anteile (Long + Short = 1) und dass ein fehlendes Feld wirft.
- **Auffrischen**: `tools/fixtures-auffrischen/` (Node-Skript für PC/VPS).
- **Befunde dabei:**
  - OKX: gespeichert wurde `nextFundingTime` = übernächste Abrechnung, 8 Std zu
    spät (live: OKX 00:00, alle anderen 16:00). Richtig ist `fundingTime`.
    Der Wert wird in der App und in SQL nirgends ausgewertet, also ohne
    Folgen bisher.
  - Bitunix liefert inzwischen einen Index-Preis, der Code verwarf ihn.
  - Bitget liefert die Positionierung als Zeitreihe, älteste zuerst; gewählt
    wird jetzt nach Zeitstempel statt nach Position.
- **Stand:** live seit 29.10.2026 12:51 UTC (`collect-btc` v16,
  `collect-positioning` v12). Erster Lauf danach: alle Börsen `ok`, OKX-Funding
  16:00 UTC wie die anderen, Bitunix mit Index-Preis.

## Nebenbefunde geklärt (29.10.2026)

- **Binance-Liquidationen:** `collect-liquidations` verband sich mit
  `wss://fstream.binance.com/ws/…`. Binance hat die USDT-M-Streams 2026 auf
  getrennte Basispfade verteilt (`/public`, `/market`), die alten Adressen sind
  seit 23.04.2026 abgeschaltet. Deshalb kam seit dem Start am 19.08.2026 keine
  einzige Binance-Zeile an. Ein Verbindungsfehler wurde still als leere Liste
  behandelt. Korrigiert auf `/market/ws/btcusdt@forceOrder`; ein Sammler ohne
  Verbindung meldet das jetzt unter `errors`. Live seit 29.10.2026 12:53 UTC
  (`collect-liquidations` v14); erster Lauf ohne Fehler, beide Streams verbunden.
- **`bgeometrics/miner-net-flow`:** kein Ausfall. `collect-onchain` fragt die
  Metrik seit 27.08.2026 bewusst nicht mehr ab (kostenpflichtig).
  `refresh_data_quality()` führte sie weiter in ihrer Liste. Migration
  `20261029130000_data_quality_ohne_miner_net_flow.sql` nimmt sie heraus.
  **Einspielen offen.**

## Vorschlag für die Reihenfolge

1. ~~A + B (Datenstand)~~ umgesetzt am 29.10.2026.
2. ~~C (Datenvertrag) für die Positionierungs- und Preis-Sammler~~ live seit 29.10.2026.
3. D + E zusammen, zuerst an zwei Kacheln (z. B. Funding, OI) als Muster.
4. G, H, I, J nach Bedarf.
