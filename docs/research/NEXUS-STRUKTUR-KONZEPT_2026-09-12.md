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
| **Gesamteinschätzung** (`kurznotiz` + `MarketStateCard`) | ⚠️ noch NICHT nach neuem Massstab validiert | Bleibt vorerst wie heute (14-Faktoren-Formel), aber mit Hinweis "wird neu validiert" — Wechsel zu Ebene 1 erst nach eigenem Gesamteinschätzung-Score-Protokoll (siehe Abschnitt 5) |
| **Einstiegsfilter** (EntryFilterBadge, 4h-Struktur) | ✅ validiert, aber **redundant** | Ist bereits Teil des Trend-Konfirmation-Faktors im Setup-Score — Kandidat zum Entfernen/Zusammenlegen, siehe Abschnitt 6 |

### Ebene 2 — Signale im Detail

20 validierte + 9 nicht-validierte Einzelsignale aus dem Confluence-Score-Protokoll (siehe
`CONFLUENCE-SCORE-PHASE3-RESULTS_2026-09-11.md`). Aktuell **verstreut** über mehrere
themenbasierte Kacheln:

| Signal-Herkunft | Aktuell in Kachel | Validiert? |
|---|---|---|
| Struktur 15m/1h/4h/1d, MTF-Alignment | `market-context`, `regime-matrix` | 7 von 8 Zellen ja |
| CVD-Richtung, Trendstärke, Trend-Regime, VWAP-Position | `market-context` | 6 von 8 Zellen ja |
| Fear & Greed | `market-context` | nein (beide Richtungen) |
| Makro-Regime | `etf-flow` | SHORT ja, LONG nein |
| Orderbuch-Imbalance | `orderbook-walls` | nein (beide, n noch zu klein) |
| Momentum-Faktor (RSI+MACD) | — (bisher keine eigene Anzeige) | ja (beide) |
| Positionierung, Divergenz-Radar: Onchain vs Preis | `positioning`, `divergence-radar` | teilweise / eingefroren |

**Vorschlag:** kein komplett neuer Ort dafür — stattdessen jede bestehende Kachel um ein
kleines Badge "✓ validiert" / "— unbestätigt" pro Zeile ergänzen (minimal-invasiv, kein
Datenverlust, keine neue Navigation nötig). Der Setup-Score selbst verlinkt/verweist auf genau
diese Zeilen als Begründung.

### Ebene 3 — Beobachtung & Kontext

Alle übrigen bestehenden Kacheln bleiben unverändert an ihrem Platz, nur konzeptionell als
"Kontext, kein geprüftes Signal" eingeordnet:

BTC Preis, OI Change, OI je Börse, Funding Rate, Spot Pressure, Zyklus-Indikatoren,
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

## 6. Identifizierte Redundanz

**Einstiegsfilter (4h-Struktur-Badge)** und der **Trend-Konfirmation-Faktor** im Setup-Score
nutzen dieselbe zugrundeliegende Information (Struktur 4h ist eine der 9 im Trend-Konfirmation-
Zähler gebündelten Signale). Sobald der Setup-Score produktiv genutzt wird, liefert er die
differenziertere Aussage (9-Signal-Konsens statt nur 1 Signal) — der separate Einstiegsfilter
wird dadurch vermutlich überflüssig. Vorschlag: nach einer Beobachtungsphase entfernen oder zu
einer reinen "Trend-Konfirmation im Detail"-Zeile innerhalb von Ebene 2 umbauen.

## 7. Offene Entscheidungen für Toby

1. Seitenstruktur-Vorschlag (Abschnitt 3) so umsetzen, oder anderes Vorgehen?
2. Einstiegsfilter jetzt schon entfernen, oder erst nach Beobachtungsphase (Abschnitt 6)?
3. Gesamteinschätzung-Score-Protokoll als nächstes eigenständiges Vorhaben starten (Abschnitt 5)
   — Voraussetzung dafür, dass Ebene 1 vollständig wird?
4. Reihenfolge: erst Struktur/Ebenen umsetzen (mit heutiger Gesamteinschätzung), oder erst das
   neue Gesamteinschätzung-Score-Protokoll fertig validieren, dann beides zusammen umbauen?
