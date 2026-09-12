# Gesamteinschätzung-Score-Protokoll — vorregistriert vor Ergebnis-Ansicht (2026-09-12)

Pre-Registration nach demselben Prinzip wie `CONFLUENCE-SCORE-PROTOCOL_2026-09-11.md` und
`PHASE-3-RESEARCH-PROTOCOL.md`: die komplette Methodik wird hier **vor** dem ersten Blick auf
ein Ergebnis festgeschrieben. Nachträgliche Änderungen an Zieldefinition, Signal-Klassifizierung
oder Test-Verfahren sind nach Start nicht mehr zulässig — nur Erweiterungen, niemals rückwirkende
Korrekturen an bereits klassifizierten/getesteten Elementen.

**Grund für dieses zweite, eigenständige Protokoll** (statt einer Erweiterung des
Confluence-Score-Protokolls): institutionelle Praxis trennt Regime-Klassifikation
("wie ist die Marktlage") strikt von Trade-Signal-Scoring ("sollte ich mit diesem konkreten
Setup handeln") — siehe `NEXUS-STRUKTUR-KONZEPT_2026-09-12.md` Abschnitt 5. Die 20 für den
Setup-Score validierten Signale sind für eine allgemeine Marktbewertung **nicht automatisch**
gültig, weil sie gegen eine andere Zielgrösse (Hebel-Setup-Trefferquote) getestet wurden. Dieses
Dokument definiert eine eigene, davon unabhängige Zielgrösse und einen eigenen BH-FDR-Pool.

**Status 12.09.2026: mit Toby abgestimmt.** Beide Kernentscheidungen (Abschnitt 1 + 2) sind nach
Kalibrierung anhand echter Daten bestätigt — Details und Zahlen siehe die jeweiligen Abschnitte.
Ab hier gilt dasselbe Prinzip wie beim Confluence-Score-Protokoll: keine rückwirkenden
Änderungen mehr, nur Erweiterungen.

## 1. Zieldefinition (Zielgrösse) — **bestätigt 12.09.2026**

**Kernidee:** ein volatilitäts-skalierter, symmetrischer Doppel-Barrier-Test (Variante des im
Projekt bereits verwendeten Triple-Barrier-Verfahrens, siehe `research_triple_barrier_events()`),
aber OHNE Hebel/SL/TP-Sprache — die Gesamteinschätzung bewertet die Marktlage, nicht ein
konkretes Trade-Setup.

**Barrieren, ab jedem Bewertungszeitpunkt t0:**
- **Obere Barriere:** Preis erreicht `close(t0) × (1 + k × ATR14(t0)/close(t0))`
- **Untere Barriere:** Preis erreicht `close(t0) × (1 − k × ATR14(t0)/close(t0))`
- **Zeit-Barriere:** `H` Stunden ab t0

**Vorgeschlagene Werte:** `k = 1,0` (Barrieren-Distanz = 1× ATR(14) zum Bewertungszeitpunkt,
point-in-time, keine Lookahead-Information), `H = 4` Stunden.

**Drei mögliche Ausgänge pro Bewertungspunkt:**
- **UP:** obere Barriere zuerst erreicht.
- **DOWN:** untere Barriere zuerst erreicht.
- **NEUTRAL:** weder noch innerhalb von `H` Stunden (Zeit-Barriere zuerst).

**Zwei binäre Zielgrössen pro Bewertungspunkt** (analog LONG-Hit/SHORT-Hit beim Setup-Score):
`y_up = 1` falls Ausgang UP, sonst 0; `y_down = 1` falls Ausgang DOWN, sonst 0. Jedes Signal wird
gegen **beide** Zielgrössen getestet (entspricht "Signal sagt Aufwärtsbewegung voraus" bzw.
"...Abwärtsbewegung").

**Warum ATR-skaliert statt fixer Prozentwert:** ein fixer Schwellenwert (z.B. "±1%") würde in
ruhigen Marktphasen kaum je auslösen und in volatilen Phasen fast immer — das Ergebnis hinge dann
stärker davon ab, welche Vol-Regime im Testfenster überwiegen, als von echter Vorhersagekraft.
Volatilitäts-Skalierung ist Standardpraxis bei Triple-Barrier-Labeling (López de Prado,
*Advances in Financial Machine Learning*) und macht das Label über wechselnde Marktphasen hinweg
vergleichbar.

**Warum 4 Stunden:** Struktur 4h war in JEDER bisherigen Auswertung dieses Projekts
(Triple-Barrier-MTF-Alignment, Confluence-Score-Protokoll) der stärkste Einzelbefund — ein
Zeithorizont in derselben Grössenordnung passt zur Kadenz, auf der die Gesamteinschätzung
tatsächlich reagiert (stündliche Kern-Features, 15-Minuten-Neuberechnung). Deutlich kürzer (z.B.
15m/1h, wie beim Setup-Score) würde zu nah an die bereits separat validierte Setup-Frage rücken;
deutlich länger (1d+) würde die Zahl unabhängiger, nicht-überlappender Bewertungspunkte über die
verfügbare Historie stark reduzieren.

**Kalibrierung, finale Version auf voller 4-Jahres-Historie (12.09.2026, nach ATR-Backfill,
siehe Abschnitt 8 Schritt 0):** empirisch geprüft anhand aller `atr_14`-Werte (1h,
2022-09-04 bis heute, n=8.813 nicht-überlappende 4h-Bewertungspunkte), Vorwärtsfenster 4h,
gegen tatsächliche High/Low-Exkursion:

| k | Anteil UP/DOWN (Barriere ausgelöst) | Anteil NEUTRAL |
|---|---|---|
| 0,5 | 96,3% | 3,7% |
| **1,0 (gewählt)** | **67,7%** | **32,3%** |
| 1,5 | 41,7% | 58,3% |
| 2,0 | 26,7% | 73,3% |

Durchschnittliche Exkursion über 4h liegt bei 1,07×ATR (aufwärts) / 1,08×ATR (abwärts) — nahezu
perfekt symmetrisch und sehr nah an `k=1,0`, damit maximale Trennschärfe zwischen UP/DOWN/NEUTRAL
bei noch vertretbarem Datenverlust. Bestätigt die vorläufige Kalibrierung auf dem kleinen
11-Tage-Ausschnitt (damals 70,3%/29,7%) — die Verschiebung liegt bei nur ~3 Prozentpunkten, weit
unter der vorab festgelegten 10-Punkte-Toleranz für eine Anpassung. **`k=1,0/H=4h` bleibt
endgültig.**

## 2. Kandidatensignale — **bestätigt 12.09.2026**

**Basis:** identische 31 Signalgeber wie im Confluence-Score-Protokoll Abschnitt 2 (Struktur
15m/1h/4h/1d, MTF-Alignment, CVD-Richtung, Trendstärke, Trend-Regime, VWAP-Position, Funding,
Fear & Greed, Positionierung, Orderbuch-Imbalance, Optionen, Makro-Regime, Divergenz-Radar ×3,
Warn-Muster ×4, TradingView-Events ×6, TradingView-Divergenzen ×2, Momentum-Faktor) — dieselben
Rohspalten, aber gegen die **neue** Zielgrösse aus Abschnitt 1 getestet, nicht gegen die
Setup-Trefferquote. Ergebnisse aus dem Setup-Score-Protokoll werden nicht wiederverwendet oder
übertragen (das wäre genau die unzulässige Vermischung aus Abschnitt 0).

**Neu hinzugefügt** (bisher nur deskriptiv angezeigt, nie gegen eine echte Zielgrösse getestet):
8 Einzelmetriken aus den 5 Regime-Matrix-Säulen (`lib/marketRegime.ts`/`market_state_matrix`) —
**Regressionssteigung** (Trend; ADX/DMI selbst bereits über "Trendstärke (ADX+DI)" in der
31er-Basis abgedeckt, hier nur die zusätzliche, neue Komponente), **Distanz-zu-SMA50-Z-Score**
(Momentum/Mean-Reversion; RSI ebenfalls schon über Momentum-Faktor abgedeckt), **Funding-Z-Score**,
**OI-vs-Preis-Quadrant**, **CVD-Z-Score** (Mikrostruktur — als Z-Score-Operationalisierung
getrennt von den bereits vorhandenen Rohwert-Versionen Funding/CVD-Richtung getestet, analog zur
bereits etablierten Praxis, mehrere Operationalisierungen derselben Grundaussage als eigene
Zellen zu führen, siehe Confluence-Score-Phase3-Ergebnisse Abschnitt 2), **Liquidation-Cluster-
Density**, **Net-Taker-Flow-Ratio** (Makro/Sentiment), **Bollinger %b** (Volatilität/Position).

**Bewusst ausgeschlossen — Zirkularitäts-Risiko:** **Bollinger-Breite** und
**Normalized-ATR-Ratio**. Beide sind reine Volatilitäts-*Grössen*-Messungen — dieselbe
Grössenordnung, die bereits die Zielgrösse selbst skaliert (Abschnitt 1: `k × ATR14`). Als
Prädiktor gegen eine ATR-skalierte Zielgrösse getestet, würde eine "Vol-Squeeze" nahezu
automatisch mit NEUTRAL-Ausgängen korrelieren — kein echter Fund, sondern ein Artefakt der
Definition. Bollinger %b (Preis-*Position* innerhalb der Bänder, keine Grössen-Messung) ist davon
nicht betroffen und bleibt drin. Das ist auch die direkte Antwort auf die Frage von eben ("haben
wir Bollinger-Bänder-Signal?") — **beide Bollinger-Kennzahlen existieren bereits in Nexus, wurden
aber noch nie gegen eine Zielgrösse getestet**; mit diesem Protokoll wird zumindest Bollinger %b
zum ersten Mal wirklich geprüft.

**Insgesamt: 31 + 8 = 39 Kandidaten-Signalgeber × 2 Zielgrössen (y_up/y_down) = bis zu 78
Einzelzellen**, vor MIN_N-Filterung.

## 3. Alle Signale als "Leading" — keine Confirming-Kategorie

Anders als beim Setup-Score (wo Momentum als Confirming-Signal erst nach +0,25%-Bewegung bekannt
war) ist die Gesamteinschätzung ein **Schnappschuss-Urteil zum Bewertungszeitpunkt t0** — kein
laufender Trade mit Nachbeobachtungsfenster. Jedes Kandidatensignal muss daher zu t0 bereits
verfügbar (Point-in-Time) sein; Staleness-Toleranzen pro Signal-Typ identisch zu Abschnitt 6b des
Confluence-Score-Protokolls (15m/1h-Signale: 4h-Toleranz, Struktur 4h: 8h, Struktur
1d/Fear&Greed/Makro: 30h, Funding: 10h, Positionierung/Orderbuch/Optionen: 4h).

## 4. Event-Sampling — nicht-überlappende Bewertungspunkte

**Ein Bewertungspunkt alle `H` Stunden** (also alle 4h, siehe Abschnitt 1), nicht jede 15m-Kerze.
Grund: überlappende 4h-Vorhersagefenster (z.B. Bewertung um 10:00 und 10:15 mit fast identischem
Ausgang um 14:00/14:15) sind seriell stark korreliert — das würde `n` künstlich aufblähen und
Signifikanz vortäuschen, wo in Wahrheit viel weniger unabhängige Information steckt. Nicht-
überlappendes Sampling im Abstand des Horizonts ist die einfachste korrekte Lösung (keine neue
Purging/Embargo-Infrastruktur nötig, siehe Abschnitt 8) und identisch im Prinzip zur bereits
verwendeten sequenziellen Swing-Setup-Kette des Confluence-Score-Protokolls — dort sequenziell
pro Richtung, hier sequenziell auf der Zeitachse.

**Ergebnis:** bei 4 Jahren Historie (wie aktuell für den Setup-Score vorgehalten) und einem
4h-Raster ergeben sich rund `4 Jahre × 365 × 6 = ~8.760` potenzielle Bewertungspunkte — deutlich
mehr als die ~3.500-7.200 Setups pro Richtung beim Setup-Score, weil hier nicht auf einen
laufenden Trade gewartet werden muss.

## 5. Statistischer Test — identische Formel-Toolbox

Wiederverwendung der bereits implementierten und bewährten Funktionen, **keine neue Mathematik**:
`research_wilson_ci()`, `research_two_proportion_ztest()`, MIN_N=10-Gate, BH-FDR-Korrektur nach
identischer Formel wie Confluence-Score-Protokoll Abschnitt 4+6.

**Pro Signal, pro Zielgrösse (y_up und y_down getrennt):** Zweiproportion-Z-Test, Trefferquote
unter "Signal aktiv" vs. "Signal nicht/gegenteilig aktiv" — exakt dieselbe Formel, nur mit den
neuen Bewertungspunkten/Zielgrössen aus Abschnitt 1 statt den Setup-Ausgängen.

## 6. Multiple-Testing-Korrektur — **eigener, getrennter Pool**

**Wichtig, folgt direkt aus Abschnitt 0:** eigener, von `research_confluence_signal_stats`
komplett getrennter BH-FDR-Pool (z.B. `research_regime_signal_stats`, eigene Tabelle) — NICHT
Teil des kumulativen Setup-Score-Pools. Grund: unterschiedliche Zielgrösse, unterschiedliche
Fragestellung (Regime vs. Trade-Alpha) — ein gemeinsamer Pool würde methodisch zwei
unterschiedliche Hypothesenklassen vermischen und die Korrektur-Schwelle für beide unnötig
verschärfen (mehr Testzellen im Pool → strengere BH-Kritikalwerte für alle).

## 7. Out-of-Sample-Validierung — identisch zum Setup-Score-Vorgehen

Train/Test-Split mit Embargo, wie bereits beim Setup-Score praktiziert und dreifach bestätigt
(2 Jahre/kurzer Test, 4 Jahre/kurzer Test, 4 Jahre/langer Test): Signal-Trefferquoten (WOE, falls
mindestens ein Signal die BH-FDR-Korrektur übersteht) werden ausschliesslich auf
`bewertungszeit < split_date` berechnet, dann blind auf `bewertungszeit >= split_date + embargo`
angewendet. Kein Nachbau der separaten Python-Purging-Pipeline (`research-python/src/validation/`)
nötig — das war ein anderes, unabhängiges Forschungsgleis (Multivariate-Modell-Benchmark, Phase
5/6) mit eigener Infrastruktur; die hier verwendete SQL-native Embargo-Methode reicht für dieselbe
Absicherung gegen Look-Ahead-Bias.

## 8. Architektur — laufender Prozess statt Einmal-Backtest

Analog zur bestehenden Confluence-Score-Pipeline, aber komplett eigenständig (eigene Tabellen,
eigener Cron-Schritt, eigener BH-FDR-Pool):

0. ✅ **Erledigt 12.09.2026:** `atr_14` (Intervall 1h) historisch auf 4 Jahre zurückgerechnet
   (`backfill-history` Edge Function um `computeAtr()` ergänzt, deployed v9, per
   `net.http_post` mit `skipKlines:true` über die volle Historie ausgeführt — 35.266 Zeilen
   neu berechnet, `atr_14` jetzt für 35.252/35.266 Zeilen vorhanden, 2022-09-04 bis heute).
   Kalibrierung auf voller Historie wiederholt und bestätigt (siehe Abschnitt 1).
1. Neue Ereignisquelle: `research_regime_evaluation_events()` — erzeugt die nicht-überlappenden
   4h-Bewertungspunkte mit ATR-skalierten Barrieren-Ausgängen (UP/DOWN/NEUTRAL).
2. Neue Aktivierungstabelle: `research_regime_signal_activation` — Signal-Zustand je
   Bewertungspunkt (analog `research_confluence_signal_activation`).
3. Neue Statistik-/BH-FDR-Tabelle: `research_regime_signal_stats` (eigener Pool, siehe
   Abschnitt 6).
4. Falls mindestens ein Signal übersteht: eigene WOE-Kombination (`research_regime_score_woe`,
   `research_regime_score_tiers`, `research_regime_score()`) — identische Mathematik wie beim
   Setup-Score (Weight-of-Evidence, Terzil-Stufen), aber komplett eigene Gewichte/Faktoren, wie
   in Abschnitt 5 des Struktur-Konzepts festgelegt (niemals gemeinsame Gewichte für
   unterschiedliche Zielgrössen).
5. Wöchentlicher Cron-Schritt, ergänzt zum bestehenden `confluence-score-pipeline-weekly`-Job
   oder als eigener Job — **entspricht "Nexus und der Score sind lernbar"** (Struktur-Konzept
   Abschnitt 0): von Anfang an als sich selbst erweiternder Prozess gebaut, kein einmaliger
   Snapshot-Backtest.

## 9. Explizit NICHT Teil dieser Version

- **Keine Mehrfach-Horizont-Testung** (nur `H=4h` als primäre, vorregistrierte Hypothese) — 1h/1d
  als spätere, separat vorregistrierte Erweiterung möglich, nicht gleichzeitig (würde die
  Testzellenzahl verdrei-/vervierfachen und die BH-Latte verschärfen, ohne dass das primäre
  Ergebnis schon feststeht).
- **Keine Regime-Phase-Aufteilung** (seitwärts/Trend/Chop) — identische Begründung wie
  Confluence-Score-Protokoll Abschnitt 7 (multipliziert Testzellen, drückt n unter MIN_N).
  Anmerkung: das ist eine gewisse Ironie, da dieses Protokoll selbst Regime-Klassifikation zum
  Gegenstand hat — die Vermeidung einer VORAB-Aufteilung nach Regime für den Signal-TEST selbst
  bleibt trotzdem korrekt, das eine hat mit dem anderen nichts zu tun.
- **Keine Paar-Analyse in der ersten Runde** — anders als beim Setup-Score erst NACH den
  Einzelsignal-Ergebnissen entscheiden, ob sich das lohnt (39 Kandidaten ergäben bei voller
  Paar-Kombinatorik bereits >700 zusätzliche Zellen — das treibt die BH-Latte ohne Not in die
  Höhe, solange noch unklar ist, ob überhaupt genug Einzelsignale überleben).
- **Kein Score als Zahl**, solange nicht mindestens ein Signal/Faktor die BH-FDR-Korrektur
  übersteht.
- **Keine KI-berechneten Gewichte** — identisch zur Begründung im Confluence-Score-Protokoll
  Abschnitt 7.

## 10. Entscheidungen — Status

1. ✅ Zielgrösse (Abschnitt 1): `k=1,0×ATR14`, `H=4h` — bestätigt 12.09.2026, Kalibrierung auf
   voller 4-Jahres-Historie final bestätigt (Abweichung von der vorläufigen Kalibrierung nur
   ~3 Prozentpunkte, weit innerhalb der Toleranz).
2. ✅ Kandidatensignale (Abschnitt 2): 31 Basis-Signale + 8 neue Regime-Matrix-Einzelmetriken
   (Bollinger-Breite/Normalized-ATR-Ratio ausgeschlossen, Zirkularitäts-Risiko) — bestätigt
   12.09.2026.
3. ✅ Abschnitt 8 Schritt 0 (`atr_14`-Backfill) — erledigt 12.09.2026.
4. **Nächster Schritt:** Abschnitt 8, Schritte 1-3 (Ereignisquelle, Aktivierungstabelle,
   Statistik-/BH-FDR-Tabelle) — Schritt 4/WOE erst, falls überhaupt etwas die BH-FDR-Korrektur
   übersteht, wie beim Setup-Score auch so gehandhabt.

## Referenzen

- `CONFLUENCE-SCORE-PROTOCOL_2026-09-11.md` — Vorbild für Methodik und Format, Statistik-Engine
  vollständig wiederverwendet.
- `NEXUS-STRUKTUR-KONZEPT_2026-09-12.md` Abschnitt 5 — Begründung für die strikte Trennung
  dieses Protokolls vom Setup-Score.
- `CONFLUENCE-SCORE-PHASE3-RESULTS_2026-09-11.md` Abschnitt 6c — Weight-of-Evidence-Methodik,
  identisch wiederverwendet für Schritt 4 in Abschnitt 8, falls anwendbar.
