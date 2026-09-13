# Nexus-Atlas Struktur-Konzept — einheitlicher, lesbarer, aussagekräftiger

Vorregistrierung im selben Sinn wie die Forschungsprotokolle: dieses Dokument legt die
Zielstruktur fest, **bevor** am Code etwas verändert wird. Grundlage: die Diskussion vom
12.09.2026 (Confluence-Score-Ergebnisse, Frage nach genereller Aufräumung).

## 0. Leitprinzipien (Toby, 12.09.2026)

Nexus soll werden: **einheitlicher, leichter lesbar, strukturierter, verständlicher,
aussagekräftiger, "keep it simple" — ohne Datenverlust.** Zusätzlich: **Nexus und der Score
sind lernbar** — das System soll sich fortlaufend aus neuen Daten weiterentwickeln, nicht ein
einmal fixiertes Modell sein.

**Was das konkret bedeutet:**
- "Ohne Datenverlust" = wir vereinfachen die **Präsentation und Struktur**, nicht die
  zugrundeliegenden Daten oder Fähigkeiten. Nichts wird gelöscht — alles bleibt abrufbar, nur
  klarer eingeordnet.
- "Lernbar" = ist für den Setup-Score bereits umgesetzt (wöchentlicher Cron erweitert WOE-Werte
  automatisch mit wachsenden Daten, siehe `research_confluence_score_refresh()`). Dasselbe
  Prinzip muss das künftige Gesamteinschätzung-Modell von Anfang an übernehmen — kein
  einmaliges, eingefrorenes Regelwerk.

## 1. Drei Ebenen statt einer flachen Kachel-Liste

| Ebene | Beantwortet | Kriterium für Aufnahme |
|---|---|---|
| **1 — Bewertung** | "Wie stehen die Chancen gerade, konkret, aggregiert?" | Nur statistisch validierte Signale/Paare (BH-FDR-signifikant, out-of-sample bestätigt) |
| **2 — Signale im Detail** | "Was genau steckt in der Bewertung — und was nicht?" | Jedes einzeln getestete Signal, klar markiert: validiert (fliesst ein) / nicht validiert (nur sichtbar) |
| **3 — Beobachtung & Kontext** | "Was sehe ich sonst noch, ohne Anspruch auf geprüfte Vorhersagekraft?" | Alles, was (noch) nicht gegen echte Setup-Outcomes getestet wurde — deskriptiv, aber nützlich |

Eine Kachel/ein Signal kann **nur einer** Ebene angehören, aber Ebene-2-Signale sind über eine
Verlinkung/Kennzeichnung aus Ebene 1 heraus erreichbar ("warum dieser Score? → Aufschlüsselung").

## 2. Vollständiges Kachel-Inventar, Ebenen-Zuordnung

### Ebene 1 — Bewertung (validiert)

| Kachel | Status | Anmerkung |
|---|---|---|
| **Setup-Score** (bisher "Confluence-Score", `confluence-score`) | ✅ validiert, 3× out-of-sample bestätigt | Umbenennen auf **"Setup-Score (15m · TP 1,75% · SL 0,5% · 20x)"** — Namensgebung macht die Setup-Bindung explizit, siehe Abschnitt 4 |
| **Gesamteinschätzung** (`HeroHeader`, vormals zusätzlich `MarketStateCard`) | ⚠️ noch NICHT nach neuem Massstab validiert | Bleibt vorerst wie heute (14-Faktoren-Formel), aber mit Hinweis "wird neu validiert" — Wechsel zu Ebene 1 erst nach eigenem Gesamteinschätzung-Score-Protokoll (siehe Abschnitt 5). Die separate `kurznotiz`-Kachel wurde entfernt (13.09.2026) — derselbe Satz stand bereits im HeroHeader. Per Screenshot entdeckt, dass Badge + Zeitstempel + Verlässlichkeits-Zahl ZUSAETZLICH zwischen HeroHeader und der separaten `MarketStateCard` dupliziert waren (beide pollten unabhängig dieselbe `market_states`-Zeile alle 60s) — daraufhin komplett zu EINER Sektion verschmolzen: HeroHeader zeigt jetzt Kurzuebersicht (Badge/Kurzsatz/Bestätigung/Status-Zeilen aller Sparten) UND das Gesamteinschätzung-Detail (Konfidenz-Aufschlüsselung/Muster/Risk-Faktoren/14-Faktoren-Aufklapper) in derselben Box, ein Poll statt zwei. `MarketStateCard.tsx` geloescht. |
| ~~Einstiegsfilter~~ (EntryFilterBadge, 4h-Struktur) | entfernt (13.09.2026) | War Teil des Trend-Konfirmation-Faktors im Setup-Score — siehe Abschnitt 6/7 |

### Ebene 2 — Signale im Detail

**Korrektur 12.09.2026 (nach Code-Pruefung):** die ursprüngliche Annahme unten war falsch — die
einzeln getesteten Confluence-Score-Signale (Struktur 15m/1h/4h/1d, MTF-Alignment, CVD-Richtung,
Trendstärke, Trend-Regime, VWAP-Position, Fear & Greed, Makro-Regime, Orderbuch-Imbalance) haben
**keine eigenen sichtbaren Zeilen** in `market-context`/`regime-matrix`/`etf-flow`/
`orderbook-walls` — sie existieren nur als Rohspalten in `market_features`/`market_states`, die
in andere, eigenständige Formeln einfliessen (z.B. `MarketStateCard`s 14-Faktoren-Gesamteinschätzung).
Badges auf diesen Kacheln zu setzen hätte fälschlich suggeriert, dass genau diese Zahlen für den
Setup-Score getestet wurden.

**Umgesetzte Lösung:** ein `<details>`-Aufklapper direkt in der Setup-Score-Kachel
("Signale im Detail (X validiert, Y unbestätigt)"), gespeist live von
`research_confluence_bh_fdr('main')` — derselben Funktion, die auch die produktiven WOE-Werte
berechnet. Zeigt pro Signal & Richtung Trefferquote, Stichprobengrösse und ✓/—-Status, direkt an
der Quelle der Wahrheit statt an mehreren, davon unabhängigen Anzeige-Orten dupliziert. Kein
Datenverlust (alle 27 Signal-Zellen sichtbar), keine neue Navigation, kein Risiko einer falschen
Zuordnung.

### Ebene 3 — Beobachtung & Kontext

Alle übrigen bestehenden Kacheln bleiben unverändert an ihrem Platz, nur konzeptionell als
"Kontext, kein geprüftes Signal" eingeordnet:

BTC Preis, OI Change, OI je Börse, Funding Rate (Spot Pressure als Aufklapper in
Marktkontext, seit 13.09.2026 zusammengeführt, siehe Abschnitt 7), Zyklus-Indikatoren,
Wirtschaftskalender, Liquidations-/Hebelkarte, ETF-Flows & Makro (Rohdaten-Ansicht),
News & Risiko, Handelslage, Institutional Playbook, Lernen, sowie alle KI-Kacheln
(News-Einordnung, Signal Engine, Periodischer Rückblick, Eskalation, Trade-Debate,
Freie Anfrage, YouTube-Monitor) — KI-Zusammenfassungen sind per Definition Prosa über bereits
vorhandene Zahlen, nie eine eigene Bewertung (bestehendes Prinzip, unverändert).

## 3. Seitenstruktur — Vorschlag

Statt einer einzigen langen, flachen Kachel-Liste: **3 Reiter/Abschnitte**, die genau den
3 Ebenen entsprechen, mit Ebene 1 permanent oben sichtbar (unabhängig vom gewählten Reiter) —
ähnlich wie `MarketStateCard` heute schon fest platziert ist, nur um den Setup-Score ergänzt.
Ebene 2 und 3 bleiben frei verschiebbar/minimierbar wie bisher (`DashboardLayout.tsx` bleibt
technisch unverändert, nur die Tab-Zuordnung in `lib/dashboardTabs.ts` ändert sich).

## 4. Namenskonvention

- **"Setup-Score (15m · TP 1,75% · SL 0,5% · 20x)"** statt "Confluence-Score" — Parameter im
  Namen selbst, damit die Bindung an genau dieses eine Setup nie missverstanden wird.
- **"Gesamteinschätzung-Score"** (Arbeitstitel) für das künftige, eigenständig validierte
  Regime-Modell — bewusst NICHT "Setup-Score v2", um die methodische Trennung (Regime- vs.
  Alpha-Frage, siehe Abschnitt 5) auch im Namen zu markieren.

## 5. Voraussetzung für Ebene 1 komplett: Gesamteinschätzung-Score-Protokoll

Institutionelle Praxis trennt Regime-Klassifikation ("wie ist die Marktlage") strikt von
Trade-Signal-Scoring ("sollte ich jetzt handeln") — beide nutzen denselben methodischen
Werkzeugkasten (Signal-Test, BH-FDR, Out-of-Sample-Validierung, WOE-Kombination), aber niemals
dieselben Gewichte für unterschiedliche Zielgrössen. Die 20 für den Setup-Score validierten
Signale sind **nicht automatisch** für eine allgemeine Gesamteinschätzung validiert — das
erfordert eine eigene, neu vorregistrierte Testrunde mit eigener Zielgrösse (z.B. "Preisbewegung
>X% in den nächsten Y Stunden", unabhängig von Hebel/TP/SL).

**Das ist ein eigenständiges Projekt**, vom Umfang vergleichbar mit dem gesamten
Confluence-Score-Protokoll — eigenes Dokument, eigene Pre-Registrierung, vor Ebene-1-Umsetzung
für die Gesamteinschätzung zu erledigen. Bis dahin bleibt die Gesamteinschätzung in ihrer
heutigen Form (klar gekennzeichnet als "wird neu validiert").

## 6. Identifizierte Redundanz (erledigt 13.09.2026)

**Einstiegsfilter (4h-Struktur-Badge)** und der **Trend-Konfirmation-Faktor** im Setup-Score
nutzten dieselbe zugrundeliegende Information (Struktur 4h ist eine der 9 im Trend-Konfirmation-
Zähler gebündelten Signale). Der Setup-Score liefert die differenziertere Aussage (9-Signal-
Konsens statt nur 1 Signal) und ist produktiv validiert — der separate Einstiegsfilter war damit
überflüssig. Entscheidung (13.09.2026, im Rahmen der Dashboard-Struktur-Aufräumung): entfernt,
nicht erst nach Beobachtungsphase. `EntryFilterBadge`/`lib/entryFilter.ts` samt Test gelöscht,
Aufruf aus `HeroHeader.tsx` entfernt. Kein Datenverlust — dieselbe 4h-Struktur-Information bleibt
über den Trend-Konfirmation-Faktor im Setup-Score sichtbar.

## 7. Offene Entscheidungen für Toby

1. ~~Einstiegsfilter jetzt schon entfernen, oder erst nach Beobachtungsphase (Abschnitt 6)?~~
   Entschieden (13.09.2026): entfernt, siehe Abschnitt 6.
2. Gesamteinschätzung-Score-Protokoll als eigenständiges Vorhaben (Abschnitt 5) läuft bereits
   (siehe GESAMTEINSCHAETZUNG-SCORE-PHASE1-RESULTS_2026-09-12.md) — Regime-Score-Kachel ist schon
   fest bei Ebene 1 platziert, obwohl das Protokoll noch nicht abgeschlossen ist ("in Aufbau").
   Weiterhin offen: wann gilt es als abgeschlossen genug für den vollen Ebene-1-Status ohne
   "in Aufbau"-Hinweis?
3. Seitenstruktur (Abschnitt 3) ist umgesetzt, allerdings anders als hier skizziert: statt Tabs
   1:1 auf die 3 Ebenen zu legen, gruppieren die 3 Tabs (`lib/dashboardTabs.ts`) nur die
   Ebene-3-Kacheln thematisch (Ebene 1 fix oben, Ebene 2 als Aufklapper im Setup-Score, kein
   separater Tab noetig) — siehe Kommentar dort vom 12.09.2026 fuer die Begruendung.
4. Die ~26 Ebene-3-Kacheln selbst wurden seit diesem Dokument nicht mehr auf Redundanz/Gruppierung
   durchgesehen (seither u. a. Warn-Muster-Faktoren, weitere Divergenz-Radar-Paare hinzugekommen)
   — laufende Dashboard-Struktur-Aufräumung ab 13.09.2026, tab-für-tab. Im Marktkontext-Tab dabei
   bereits erledigt: Kurznotiz entfernt (Duplikat vom HeroHeader-Kurzsatz, siehe Ebene-1-Tabelle oben),
   Spot Pressure in Marktkontext zusammengeführt (beide nutzten denselben Spot-Taker-Netto-Flow —
   Marktkontext als einen von 3 Inputs, Spot Pressure als eigenständiges Detail-Verdikt zum selben
   Wert; jetzt ein Aufklapper in `MarketContextCard.tsx` statt zwei Kacheln nebeneinander),
   Orderbuch-Wände von Marktkontext nach Preis/Orderflow/Makro verschoben (reine
   Liquiditäts-Momentaufnahme, kein Regime-/Stimmungssignal wie die übrigen Marktkontext-Kacheln).
   Im Preis/Orderflow/Makro-Tab ebenfalls erledigt: OI je Börse in OI Change zusammengeführt
   (gleiches Muster — Detail-Aufschlüsselung derselben OI-Change%-Zahl, jetzt Aufklapper in
   `OiChangeCard.tsx`), Liquidations-/Hebelkarte (Modell-Schätzung) und Liquidationen (echte
   Events) nebeneinander gestellt statt weit auseinander — kein Merge (unterschiedliche
   Datengrundlage), aber leichter vergleichbar.
