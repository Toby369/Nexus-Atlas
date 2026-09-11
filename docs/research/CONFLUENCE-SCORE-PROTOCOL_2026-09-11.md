# Confluence-Score-Protokoll — vorregistriert vor Ergebnis-Ansicht (2026-09-11)

Pre-Registration nach demselben Prinzip wie `PHASE-3-RESEARCH-PROTOCOL.md`: die komplette
Methodik wird hier **vor** dem ersten Blick auf ein Ergebnis festgeschrieben. Nachträgliche
Änderungen an Setup-Definition, Signal-Klassifizierung oder Test-Verfahren sind nach Start
nicht mehr zulässig — nur Erweiterungen (neue Signale, neue Setups über die Zeit), niemals
rückwirkende Korrekturen an bereits klassifizierten/getesteten Elementen.

## 0. Reihenfolge — Schritt 1 zuerst, blockierend

**Bevor irgendetwas anderes beginnt: TradingView-Webhook-Secret fixen.** Aktuell (Stand
10.09., 24h-Check: nur 7 von erwarteten mehreren Dutzend Alarmen kommen durch) blockiert das
ausschließlich die TradingView-Alert-Signale (15 Typen) — alle anderen Signalquellen
(Struktur/Funding/Sentiment/Positionierung/Orderbuch/...) sind davon unabhängig und können
parallel vorbereitet werden. Konkret (Tobys Aufgabe, nicht automatisierbar):
1. Supabase-Dashboard → Edge Functions → Secrets → `TRADINGVIEW_WEBHOOK_SECRET` kopieren.
2. In TradingView jede einzelne Alarm-Instanz (pro Skript UND pro Zeitrahmen) öffnen, im
   Message-Text den Wert hinter `"secret":"..."` ersetzen, speichern.
3. Bestätigung: `tradingview_signals`-Zuwachs über 24h prüfen, muss den erwarteten
   Alarm-Frequenzen der 6 Pine-Skripte entsprechen, nicht nur vereinzelt durchkommen.

## 1. Setup-Definition (exakt, keine Interpretation offen)

**Parameter:** 20x Hebel, SL -10% Marge (-0,5% Kursbewegung), TP +35% Marge (+1,75%
Kursbewegung). CRV 3,5:1, Break-even-Trefferquote 22,2%.

**Entry:** Open der nächsten Kerze nach Signal-Zeitpunkt (kein Lookahead), 15m-Basis.

**Ausgang, als Zustandsautomat pro Setup:**
1. Preis erreicht SL (-0,5% ggü. Entry, LONG; +0,5%, SHORT) → Setup **beendet, Ergebnis SL**.
2. Preis erreicht TP (+1,75%/-1,75%) **bevor** SL erreicht wird → Setup wechselt in Zustand
   **"läuft" (Trailing)**, `peak` wird ab hier laufend auf den bisherigen Extremwert
   (Höchststand LONG / Tiefststand SHORT) seit Entry aktualisiert.
3. Im Zustand "läuft": sobald der Preis **5% Marge vom `peak`** (0,25% Kursbewegung) in die
   Gegenrichtung zurückfällt → **dieses** Setup endet, Ergebnis = tatsächlich erreichter
   MFE-Wert (mind. TP, ggf. mehr). Der Rücksetzer selbst ist NICHT Teil des nächsten Setups.
4. Läuft der Preis nach dem Rücksetzer erneut in ursprüngliche Trendrichtung um mind. die
   TP-Distanz weiter → **neues, eigenständiges Setup**, Entry = erste Kerze nach dem
   5%-Tiefpunkt des Rücksetzers. Kein Bezug zum vorherigen Setup in der Auswertung (jedes
   Setup ist ein eigener Datenpunkt).
5. Max. Haltedauer weiterhin 48h (Timeout) ab Entry, falls weder SL noch TP erreicht wird.

Das zerlegt eine lange Trendbewegung korrekt in eine Kette unabhängiger Swing-Setups (Tobys
Klarstellung vom 10.09.), statt sie als einen einzigen Trade zu behandeln oder beim ersten
TP-Touch abzuschneiden.

**Technisch:** neue SQL-Funktion nötig (bestehende `research_triple_barrier_events()` kennt
nur TP/SL/Timeout, keine Trailing-Fortsetzung) — Umsetzung ist Phase 1 der Implementierung,
nicht Teil dieses Dokuments.

## 2. Signal-Klassifizierung — vor jedem Test, für jeden Signalgeber einzeln

Für **jeden** Signalgeber (alle 26 Kacheln/14 Engine-Faktoren/8 Divergenz-Paare/15
TradingView-Typen, außer YouTube-Monitor und News) wird **vor** dem ersten Test genau eine
Kategorie fest zugeordnet — keine spätere Umklassifizierung, egal wie das Ergebnis ausfällt.

**Endgültig festgelegt (11.09.2026, mit Toby abgestimmt):**

| Kategorie | Gültiges Fenster relativ zum Setup | Signalgeber |
|---|---|---|
| **Leading** | t-4h bis Entry (t0) — muss VOR dem Setup aktiv gewesen sein | Struktur 15m/1h/4h/1d, MTF-Alignment, CVD-Richtung, Trendstärke (ADX+DI), Trend-Regime (EMA50/200), VWAP-Position, Funding, Fear & Greed, Positionierung (Divergence-Engine-Score), Orderbuch-Imbalance, Optionen (Put/Call), Makro-Regime, Divergenz-Radar (3 gerichtete Paare), Warn-Muster (Distribution Warning/Capitulation/Short Squeeze/Fragile Bullish), TradingView-Event-Signale (Liquidity Sweep, Order Block, Fair Value Gap, Squeeze Breakout, Volume Expansion, VWAP Stretch) |
| **Confirming** | Entry bis Preis +5%-Marge erreicht (Setup läuft noch, aber schon im Plus) | TradingView RSI/MACD-Divergenz, Momentum-Faktor (RSI+MACD-Kombination) |

**Begründung Struktur-Faktoren → Leading** (war der einzige Klärungsbedarf): `structure_trend`
(`collect-candles::computeMarketStructure`) ist ein **Zustandslabel** (HH/HL/LH/LL-Sequenz →
bullish/bearish, per BOS/CHoCH aktualisiert), kein Ereignis-Indikator. Die fraktale
Swing-Erkennung (`SWING_LOOKBACK=5`) bestätigt einen Swing-Punkt zwar erst 5 Kerzen nach seiner
Entstehung — das ist eine **Erkennungsverzögerung relativ zur eigenen Entstehung**, keine
Look-forward-Information relativ zum Entry-Zeitpunkt: der Wert ist immer schon vollständig
verfügbar, bevor ein Setup beginnt (punkt-in-Zeit-sicher, wie bereits in
`research_build_triple_barrier_context` umgesetzt: nur die zuletzt vollständig abgeschlossene
Kerze je Intervall vor Signal-Zeitpunkt). Unterscheidet sich damit grundsätzlich von einer
Divergenz, deren Aussage sich per Definition erst bilden kann, während die Umkehrbewegung
(= das Setup selbst) bereits läuft.

Jeder Signalgeber hat jetzt genau eine Zeile — das ist der Kern der Vorregistrierung, ab hier
nicht mehr änderbar für die laufende Auswertung.

## 3. Pro-Signal-Fenster (kein gemeinsames Fenster)

Jedes Signal wird über **sein eigenes** verfügbares Zeitfenster getestet: von seinem
frühesten Datenpunkt bis heute, gedeckelt auf maximal 2 Jahre. Kein künstliches Zwingen
aller Signale auf den kürzesten gemeinsamen Nenner (das hatte am 10.09. zu einem
unbrauchbaren 7-Tage-Fenster mit 2 Setups geführt). Ergebnis pro Signal: eine individuelle
Anzahl `n` valider, testbarer Setups in seinem Fenster.

## 4. Statistischer Test — exakte Formel

**Pro Signal:** Zweiproportion-Z-Test, Trefferquote unter "Signal war in Trendrichtung aktiv"
vs. Trefferquote unter "Signal war nicht/gegenteilig aktiv":

```
p̄ = (x₁ + x₂) / (n₁ + n₂)
z  = (p̂₁ − p̂₂) / √( p̄ × (1−p̄) × (1/n₁ + 1/n₂) )
p-Wert = 2 × (1 − Φ(|z|))         [Φ = Standardnormalverteilung, research_norm_cdf()]
```

**Zusätzlich zu jeder Prozentzahl: Wilson-Konfidenzintervall** (95%), nicht nur der rohe
Punktschätzer — macht die Aussagekraft bei kleinem n sofort sichtbar (z.B. "100% (20–100%,
n=2)" statt nackt "100%"). Formel:

```
Wilson-Intervall = ( p̂ + z²/2n ± z√(p̂(1−p̂)/n + z²/4n²) ) / (1 + z²/n)
```

**Mindeststichprobe:** `MIN_N = 10` (identisch zur bestehenden `signal_stats_results`-Regel).
Darunter: kein p-Wert, kein Signifikanz-Flag, nur "n zu klein für Aussage" — auch wenn die
rohe Trefferquote beeindruckend aussieht.

## 5. Signal-Paare — Häufigkeit + bedingte Trefferquote, keine Vollkombinatorik

Für jedes Paar (A,B) zwei getrennte Kennzahlen:
- **Prevalence:** wie oft treten A und B gleichzeitig auf (in Bezug auf die Gesamtzahl der
  Setups im jeweils kürzeren der beiden Signal-Fenster)?
- **Bedingte Trefferquote:** wenn A UND B gleichzeitig aktiv sind, wie oft war das Setup
  gewinnbringend? — mit demselben MIN_N=10-Gate und Wilson-Intervall wie Einzelsignale.

Keine Auswertung "alle Paare gleichzeitig" (das wurde am 10.09. mit 9 Signalen getestet und
war bei n=164 kombinatorisch leer) — nur paarweise, das hält n pro Zelle handhabbar.

## 6. Multiple-Testing-Korrektur — kumulativ, EIN Pool

BH-FDR über **alle** Zellen zusammen (alle Einzelsignale + alle Paare), kumulativ über die
gesamte Laufzeit des Projekts — jeder neue Lauf fügt seine Zellen zum bestehenden Pool hinzu
und rechnet die Korrektur über den **gesamten** Pool neu (analog `research_bh_fdr_patterns`),
nicht pro Lauf zurückgesetzt. Bewusste Konsequenz: ein heute signifikantes Signal kann später
wieder herausfallen, wenn der Pool wächst — das ist korrektes Verhalten, kein Fehler.

## 7. Explizit NICHT Teil dieser Version

- **Keine Regime-Phase-Aufteilung** (seitwärts/Trend/Chop) — bewusst zurückgestellt. Grund:
  jede zusätzliche Aufteilungsdimension multipliziert die Zahl der Testzellen (Signal ×
  Regime × Richtung), was die BH-Latte weiter verschärft, während n pro Zelle gleichzeitig
  sinkt — bei den aktuellen Stichprobengrößen (teils n=2-45 pro Signal) würde das fast jede
  Zelle unter MIN_N drücken. Nachholbar als Erweiterung, sobald genug Signale genug Volumen
  über MIN_N hinaus haben.
- **Kein Confluence-Score als Zahl**, solange nicht mindestens ein Signal/Paar die BH-FDR-
  Korrektur übersteht — Gewichtung vor gesichertem Rohbefund wäre Kür vor Pflicht.
- **Keine KI-berechneten Gewichte.** Die gesamte Mathematik (n, Trefferquote,
  Wilson-Intervall, p-Wert, BH-FDR-Flag, Paar-Prevalence) ist deterministisches SQL. Die
  KI-Rolle (wöchentlich, sobald die Pipeline läuft) beschränkt sich auf Prosa-Zusammenfassung
  bereits fertiger Zahlen — identisch zur bestehenden Signal-Review-Kachel ("liest
  ausschließlich `signal_stats_results`, erfindet keine eigene Bewertung").

## 8. Architektur — laufender Prozess statt Einmal-Backtest

Kein neues Repo/Modul. Erweiterung der bestehenden `signal_outcomes` →
`signal_stats_results` → wöchentlicher-Cron-Pipeline um: (a) die neue Swing-Setup-Definition
aus Abschnitt 1 als Ereignisquelle, (b) die Leading/Confirming-Klassifizierung aus Abschnitt 2
als Metadaten-Spalte, (c) Paar-Auswertung aus Abschnitt 5 als zusätzliche Tabelle, (d)
kumulative statt fenster-zurückgesetzte BH-FDR für diesen speziellen Zellen-Pool.

## Referenzen

- `SIGNAL-RECALL-AUDIT_2026-09-10.md` — Vorarbeit (9-Signal- und 14-Signal-Screen,
  gemeinsames-Fenster-Test), Ursprung der meisten hier festgeschriebenen Lehren.
- `PHASE-3-RESEARCH-PROTOCOL.md` — Vorbild für das Vorregistrierungs-Format.
- `SIGNAL-REVIEW-PHASE2_2026-09-10.md` — wiederverwendetes Statistik-/Cron-Muster.
