# Gesamteinschätzung-Score-Protokoll — Phase 1 Ergebnisse (12.09.2026)

Erste Testrunde nach `GESAMTEINSCHAETZUNG-SCORE-PROTOCOL_2026-09-12.md`: 17 von 39
vorregistrierten Kandidatensignalen (13 mit bereits bewährter Klassifizierungslogik aus dem
Setup-Score-Protokoll, neu interpretiert als reine Leading-Signale ohne Confirming-Fenster, plus
4 der 8 neuen Regime-Matrix-Signale mit voller 4-Jahres-Historie). Ereignisquelle: 8.812
nicht-überlappende 4h-Bewertungspunkte (2022-09-04 bis heute), Ausgang UP/DOWN/NEUTRAL fast
perfekt 33/33/33 verteilt (33,0%/33,5%/33,5%).

## Ergebnis: 14 von 34 testbaren Zellen überleben BH-FDR

| Signal | Hypothese | n (aktiv) | n (Rest) | Trefferquote aktiv | Trefferquote Rest | p (roh) |
|---|---|---|---|---|---|---|
| MTF-Alignment | UP | 1.808 | 7.004 | 41,9% | 30,7% | <0,00001 |
| Struktur 1h | UP | 4.535 | 4.277 | 38,5% | 27,2% | <0,00001 |
| Struktur 4h | DOWN | 4.089 | 4.723 | 37,8% | 29,7% | <0,00001 |
| Struktur 1h | DOWN | 4.277 | 4.535 | 39,0% | 28,2% | <0,00001 |
| MTF-Alignment | DOWN | 1.362 | 7.450 | 43,5% | 31,6% | <0,00001 |
| Struktur 4h | UP | 4.715 | 4.097 | 36,5% | 29,0% | <0,00001 |
| Trendstärke (ADX+DI) | UP | 2.775 | 6.037 | 35,9% | 31,7% | 0,0001 |
| **CVD-Z-Score** | DOWN | 812 | 8.000 | 39,0% | 32,9% | 0,0004 |
| **Regressionssteigung** | DOWN | 4.263 | 4.549 | 35,1% | 31,9% | 0,0014 |
| Momentum-Faktor (RSI+MACD) | DOWN | 2.995 | 5.817 | 35,7% | 32,3% | 0,0014 |
| Trendstärke (ADX+DI) | DOWN | 3.034 | 5.778 | 35,7% | 32,3% | 0,0015 |
| Struktur 1d | UP | 4.698 | 4.114 | 34,4% | 31,4% | 0,0023 |
| **Bollinger %b (Mean-Reversion)** | UP | 1.661 | 7.151 | 36,1% | 32,3% | 0,0028 |
| **CVD-Z-Score** | UP | 867 | 7.945 | 37,1% | 32,6% | 0,0065 |

(Fett = neue Regime-Matrix-Signale, erstmals gegen eine echte Zielgrösse getestet.)

**Knapp nicht signifikant:** Struktur 15m (beide Richtungen), Momentum-Faktor UP.
**Nicht signifikant:** CVD-Richtung (Rohwert-Version — bemerkenswert, siehe unten),
Trend-Regime (EMA50/200), VWAP-Position, Fear & Greed, Orderbuch-Imbalance (n zu klein: 24-30),
Makro-Regime (n klein: 337-445), Distanz-SMA50-Z (Mean-Reversion-Hypothese nicht bestätigt),
Bollinger %b DOWN (Mean-Reversion nur einseitig bestätigt, s.u.), Regressionssteigung UP.

## Direkte Antwort auf die Bollinger-Frage

**Bollinger %b sagt tatsächlich etwas voraus — aber nur einseitig.** Überverkauft (%b ≤ 0,2)
erhöht die Wahrscheinlichkeit einer Aufwärtsbewegung signifikant (36,1% vs. 32,3% Basisrate).
Überkauft (%b ≥ 0,8) zeigt dagegen **keinen** signifikanten Abwärts-Effekt (34,0% vs. 33,3%,
p=0,60) — die Mean-Reversion-Hypothese gilt hier nur nach unten, nicht symmetrisch nach oben.
Das ist ein plausibler, nicht unüblicher Befund (Krypto-Märkte tendieren zu länger anhaltenden
Überkauft-Phasen in Bullenmärkten als Überverkauft-Phasen in Bärenmärkten) und exakt der Grund,
warum Vorregistrierung beide Richtungen getrennt testet statt eine gemeinsame Aussage zu
erzwingen.

## Bemerkenswert: CVD-Richtung (Rohwert) scheitert, CVD-Z-Score besteht

Die bereits im Setup-Score validierte "CVD-Richtung" (einfaches Vorzeichen: rising/falling)
ist hier **nicht** signifikant (p=0,10/0,11) — aber die neue **CVD-Z-Score**-Operationalisierung
(standardisierte Grösse, Schwelle |z|≥1,0) besteht in beiden Richtungen klar. Zeigt: für die
Gesamteinschätzung-Zielgrösse (4h-Horizont, ATR-skaliert) ist die *Stärke* des Orderflows
aussagekräftiger als nur sein Vorzeichen — ein echter Mehrwert der neuen Kandidaten, nicht nur
Redundanz zum Setup-Score.

## Kollinearitäts-Prüfung (12.09.2026)

Pairwise-Korrelation (φ, Pearson auf 0/1-Aktivierung) zwischen den trendbasierten Signalen:

| | Struktur 4h | Struktur 1d | MTF-Alignment | Trendstärke | Regressionssteigung |
|---|---|---|---|---|---|
| **Struktur 1h** | 0,21 | 0,07 | 0,49 | 0,29 | 0,54 |
| **Struktur 4h** | — | 0,18 | 0,47 | 0,11 | 0,15 |
| **Struktur 1d** | — | — | 0,48 | 0,04 | — |
| **MTF-Alignment** | — | — | — | 0,20 | — |

**Deutlich schwächer als beim Setup-Score** (dort φ 0,4-0,7 zwischen denselben Struktur-Signalen)
— am 4h-Bewertungsraster dekorrelieren die Zeitrahmen offenbar schneller als in der sequenziellen
Setup-Kette. MTF-Alignment korreliert moderat (0,47-0,49) mit allen drei Struktur-Ebenen — folgt
direkt aus seiner Definition (striktes 3-Way-Match) und ist keine echte zusätzliche Information,
sondern eine nichtlineare Kombination der drei. **Trotzdem Bündelung sinnvoll**, um keine
6-fache Übergewichtung desselben "folgt der Kurs dem Trend"-Kerneffekts im späteren WOE-Modell
zu riskieren: **Trend-Konsens** = Anzahl von {Struktur 1h/4h/1d, MTF-Alignment, Trendstärke,
Regressionssteigung}, die in eine Richtung zeigen (0-6).

**Trennschärfe des Trend-Konsens (In-Sample, UP-Richtung):**

| Konsens | n | Trefferquote UP |
|---|---|---|
| 0 | 940 | 28,0% |
| 1 | 1.729 | 26,6% |
| 2 | 2.047 | 33,7% |
| 3 | 1.499 | 31,6% |
| 4 | 1.078 | 35,0% |
| 5 | 667 | 39,6% |
| 6 | 852 | 44,7% |

Klar diskriminierend (26,6% bei niedrigem Konsens bis 44,7% bei vollem Konsens, Basisrate 33,0%).

## Out-of-Sample-Validierung (Split 2025-09-04, 1 Tag Embargo — 75%/25%)

**Trend-Konsens, 3-stufig gebündelt (niedrig 0-1 / mittel 2-4 / hoch 5-6):**

| Stufe | Train (UP) | Test (UP) | Train (DOWN) | Test (DOWN) |
|---|---|---|---|---|
| Niedrig | 27,2% | 26,6% | 29,0% | 28,9% |
| Mittel | 33,1% | 34,1% | 33,4% | 35,5% |
| Hoch | 42,6% | 42,1% | 43,9% | 45,4% |

Nahezu deckungsgleich zwischen Train und Test in beiden Richtungen — kein Overfitting sichtbar.

**Die drei unabhängigen Faktoren (CVD-Z-Score, Momentum-Faktor, Bollinger %b) einzeln geprüft:**

| Signal | Split | Trefferquote aktiv | n aktiv | Trefferquote inaktiv |
|---|---|---|---|---|
| CVD-Z-Score (UP) | Train / Test | 35,3% / 41,8% | 640 / 225 | 32,8% / 31,9% |
| CVD-Z-Score (DOWN) | Train / Test | 39,1% / 38,9% | 591 / 221 | 32,4% / 34,4% |
| Momentum-Faktor (DOWN) | Train / Test | 35,1% / 37,3% | 2.234 / 758 | 31,9% / 33,6% |
| Bollinger %b (UP) | Train / Test | 36,2% / 35,7% | 1.224 / 434 | 32,3% / 32,2% |

Alle vier halten out-of-sample — teils (CVD-Z UP) sogar stärker im Test als im Training, ein
gutes Zeichen gegen Overfitting-Verdacht.

## Produktiver WOE-Score (12.09.2026)

Identische Methodik wie beim Setup-Score (Weight-of-Evidence, `base_logit + Σ WOE(aktive
Zustände)`, siehe `CONFLUENCE-SCORE-PHASE3-RESULTS_2026-09-11.md` Abschnitt 6c) — **eigene,
komplett unabhängige Gewichte**. Asymmetrische Faktorenliste je Richtung, weil nur verwendet
wird, was für GENAU DIESE Richtung die BH-FDR-Korrektur besteht:

- **UP:** Trend-Konsens (0-6) + CVD-Z-Score + Bollinger %b (Momentum-Faktor UP war nicht
  signifikant, p=0,06 — bewusst weggelassen statt eines schwachen/nicht bestätigten Faktors).
- **DOWN:** Trend-Konsens (0-6) + CVD-Z-Score + Momentum-Faktor (Bollinger %b DOWN war nicht
  signifikant, p=0,60 — ebenfalls bewusst weggelassen).

**Terzil-Grenzen (kombinierter Logit über alle 8.813 Bewertungspunkte):**

| Richtung | Basisrate | Niedrig bis | Mittel bis | Hoch ab |
|---|---|---|---|---|
| UP | 33,0% | ≤30,5% | ≤33,8% | >33,8% (bis 44,7% bei vollem Konsens) |
| DOWN | 33,5% | ≤31,1% | ≤34,7% | >34,7% (bis 46,7% bei vollem Konsens) |

**Out-of-Sample-Bestätigung des fertigen, kombinierten Scores** (nicht nur des Trend-Konsens
allein, siehe oben — hier der volle WOE-kombinierte Score mit allen 3 Faktoren):

| Stufe | UP Train | UP Test | DOWN Train | DOWN Test |
|---|---|---|---|---|
| Niedrig | 27,5% | 26,7% | 29,2% | 31,1% |
| Mittel | 31,4% | 32,1% | 31,2% | 34,5% |
| Hoch | 40,9% | 41,5% | 38,8% | 39,3% |

Sauber monoton und stabil zwischen Train/Test in beiden Richtungen — der kombinierte Score
funktioniert, nicht nur seine Einzelteile.

**Live-Snapshot zum Zeitpunkt dieses Berichts** (`research_regime_score_live()`): UP 25,6%
(Niedrig, Trend-Konsens 1/6), DOWN 31,1% (Niedrig, Trend-Konsens 2/6) — aktuell also weder
klar bullisches noch bearishes Signal.

## Runde 2 (12.09.2026): die restlichen 3 testbaren Regime-Matrix-Kandidaten

Die 4. datenknappe Regime-Matrix-Kennzahl, **Liquidation-Cluster-Density**, wurde bewusst
**nicht** getestet: sie ist ein reiner Magnitude-Z-Score (6h-Liquidations-Cluster relativ zur
48h-Basis, siehe `compute_market_state_matrix_series()`), ohne erkennbares Vorzeichen, welche
Seite liquidiert wurde — kein pre-registrierbares Richtungssignal ohne zusätzliche, hier nicht
vorhandene Information.

Die anderen 3 (Funding-Z-Score, Net-Taker-Flow-Ratio, OI-Quadrant — nur die zwei eindeutigen
Buildup-Zustände) wurden getestet: **keiner überlebt BH-FDR**, und die Stichproben sind extrem
klein (n=10-55 pro Zelle) — dieselbe Live-Collector-Limitierung wie bei Funding/OI/Positionierung
im Setup-Score-Protokoll. Ergebnis dokumentiert statt verschwiegen: **20 von 39 Kandidaten jetzt
getestet, weiterhin 14 signifikant** (Pool wuchs von 34 auf 40 testbare Zellen, keine der
bisherigen 14 fiel heraus). Der produktive WOE-Score bleibt unverändert (Abschnitt "Produktiver
WOE-Score" oben) — keiner der 3 neuen Kandidaten hätte ihn ohnehin beeinflusst.

**Die verbleibenden 19 Kandidaten** (18 Original-Signale ohne reproduzierbare
Klassifizierungslogik + Liquidation-Cluster-Density) bleiben aus denselben strukturellen Gründen
offen, die auch im Setup-Score-Protokoll zum dauerhaften Einfrieren von 2 Signalen führten:
TradingView-Signale (8 Typen) haben praktisch keine nutzbare Historie (Webhook erst seit wenigen
Tagen stabil, siehe Confluence-Score-Protokoll Abschnitt 0), Positionierung/Optionen/
Divergenz-Radar (5 Signale) sind auf Live-Collector-Start begrenzt (n bereits im Setup-Score als
zu klein bekannt), und Warn-Muster (4 Signale) erfordern eine mehrteilige Bedingungs-
Rekonstruktion ohne bekannten Geschwindigkeitsvorteil gegenüber den bereits getesteten
Einzelfaktoren. **Kein aktiver Blocker** — der kumulative BH-FDR-Pool nimmt neue Kandidaten
jederzeit auf, sobald genug Historie vorliegt oder sich eine Rekonstruktion lohnt.

## Runde 3 (12.09.2026): Central Pivot Range (CPR) — Vorregistrierung

Neuer Kandidat aus dem Dashboard-Brainstorming (Nutzer-Wunsch "durch pivot [...] wann welches
setup"), auf Nutzer-Entscheidung hin als vollwertiger, vorregistrierter Kandidat statt reiner
Info-Kachel umgesetzt. **Diese Sektion wird VOR Kenntnis der Testergebnisse geschrieben** — exakt
dasselbe Vorgehen wie bei allen bisherigen Kandidaten in diesem Protokoll.

**Datenquelle:** `candles` (1d, BTCUSDT, Binance), 2022-09-04 bis heute (1.469 Tageskerzen) —
dieselbe 4-Jahres-Tiefe wie die restliche Historie in diesem Protokoll.

**CPR-Formel** (Central Pivot Range, institutionelle Standard-Methodik, siehe Recherche im
Brainstorming — Pivot Point (P), Bottom-CPR (BC), Top-CPR (TC) aus H/L/C der VORHERIGEN
abgeschlossenen Tageskerze, kein Lookahead):

```
P  = (High + Low + Close) / 3
BC = (High + Low) / 2
TC = 2×P − BC
Breite-% = (TC − BC) / P × 100
```

**3 Kandidaten, Hypothesen jetzt festgelegt:**

1. **CPR-Position (Preis > Top-CPR) → UP.** Institutionelle Lesart: Ausbruch über die Range gilt
   als Kaufsignal (siehe Brainstorming-Recherche). Bewusst NUR für UP getestet — die
   Gegenhypothese ("Ausbruch über TC = Erschöpfung, daher DOWN") ist eine andere Theorie
   (Mean-Reversion statt Momentum) und wird hier nicht nachträglich mitgetestet, um kein
   Cherry-Picking zwischen zwei Theorien zu betreiben.
2. **CPR-Position (Preis < Bottom-CPR) → DOWN.** Spiegelbildlich zu 1, aus demselben Grund
   NUR für DOWN.
3. **CPR-Breite eng → BEIDE Richtungen.** Institutionelle Lesart: eine enge CPR (relativ zur
   jüngeren eigenen Historie) kündigt einen Trendtag an, eine weite eher Konsolidierung/Pullback.
   Das ist KEINE Richtungsaussage, sondern eine "wird sich heute überhaupt viel bewegen"-Aussage
   — die symmetrische Hypothese lautet daher: enge CPR erhöht die Trefferquote für UP UND für
   DOWN gleichzeitig (weil sie NEUTRAL-Ausgänge verdrängt, nicht weil sie eine Richtung
   vorwegnimmt). "Eng" = unterstes Tertil der Breite-% der 20 vorherigen Tageskerzen (rollierend,
   nicht die Gesamthistorie — CPR-Breite wird relativ zur jüngeren Vergangenheit interpretiert,
   nicht absolut über 4 Jahre, weil sich die absolute BTC-Volatilität über die Jahre stark
   verschoben hat).

**Methodik identisch zum Rest des Protokolls:** dieselben 8.818 nicht-überlappenden
4h-Bewertungspunkte, derselbe BH-FDR-Pool (`research_regime_bh_fdr`, kumulativ), MIN_N=10, Preis
für die CPR-Positions-Kandidaten aus der jüngsten 1h-Kerze zum Bewertungszeitpunkt (point-in-time,
kein Lookahead).

## Runde 3 — Ergebnis: keiner der 3 CPR-Kandidaten überlebt BH-FDR

| Kandidat | Richtung | n (aktiv) | n (Rest) | Trefferquote aktiv | Trefferquote Rest | p (roh) |
|---|---|---|---|---|---|---|
| CPR-Position (Preis < Bottom) | DOWN | 4.119 | 4.697 | 34,4% | 32,6% | 0,069 |
| CPR-Breite eng | DOWN | 3.036 | 5.780 | 34,1% | 33,1% | 0,356 |
| CPR-Position (Preis > Top) | UP | 4.529 | 4.287 | 33,3% | 32,6% | 0,480 |
| CPR-Breite eng | UP | 3.036 | 5.780 | 32,1% | 33,5% | 0,202 |

Alle vier Zellen deutlich über α=0,05 (roh, also erst recht nach BH-Korrektur) — **keine der drei
Hypothesen bestätigt**. Bemerkenswert: "CPR-Breite eng" zeigt für UP sogar eine leichte Abweichung
in die dem Trendtag-Modell entgegengesetzte Richtung (32,1% vs. 33,5% Basisrate) — kein Effekt in
irgendeine Richtung, nicht einmal ein schwacher.

**Plausible Einordnung, warum CPR hier nicht greift:** CPR ist eine Methodik aus Märkten mit
klar definierten Handelssessions (Aktien/Futures, tägliche RTH-Eröffnung/-Schluss) — der
"gestriges H/L/C bestimmt heutige Levels"-Mechanismus ist dort an einen echten Tageswechsel im
Orderfluss gekoppelt. BTC handelt 24/7 ohne Session-Grenze; ein UTC-Kalendertag ist ein
willkürlicher, nicht handelsökonomisch verankerter Cutpoint. Das erklärt plausibel, warum ein in
Aktien/Futures etabliertes Konzept hier keine Vorhersagekraft zeigt — ohne dass das eine
allgemeingültige Aussage über CPR wäre, nur über seine Übertragbarkeit auf 24/7-Krypto-Märkte.

**Konsequenz:** CPR fließt NICHT in den produktiven WOE-Score ein (Abschnitt "Produktiver
WOE-Score" bleibt unverändert). Ergebnis dokumentiert statt verschwiegen, exakt wie bei Runde 2.
**Pool erweitert sich von 39 auf 40 vorregistrierte Kandidaten** (CPR kam nachträglich aus dem
Dashboard-Brainstorming hinzu, war nicht Teil des ursprünglichen Protokoll-Dokuments) — davon
jetzt **21 von 40 getestet** (44 testbare Zellen, weiterhin 14 signifikant). Keine UI-Änderung:
dieselbe Praxis wie bei den 3 gescheiterten Runde-2-Kandidaten — nicht bestätigte Kandidaten
erscheinen nicht in der Live-Kachel.

## Runde 4 (12.09.2026): Cross-Asset-Korrelation — Vorregistrierung

Aus dem Dashboard-Brainstorming ("welche Korrelationen beeinflussen BTC —
DXY, S&P/Nasdaq, Yen, Gold, M2/Liquidität?"). Nutzer-Recherche + eigene
Web-Recherche zur Gegenprüfung ergaben 5 institutionell etablierte
Zusammenhänge (DXY-Invertierung, Aktien-Risk-On-Kopplung, Yen-Carry-Trade,
Fed-Net-Liquidity, Gold) — alle ausdrücklich als INSTABIL/phasenweise
dokumentiert, nicht als Naturgesetz. Genau deshalb hier vorregistriert
gegen die eigene 4h-Zielgröße statt die pauschale Literaturaussage
ungeprüft zu übernehmen.

**Datenquelle:** `macro_snapshots` (bereits vorhanden, 2 Jahre Historie:
S&P 500, Nasdaq, VIX, DXY, Fed-Bilanz/TGA/Reverse-Repo seit 09/2024) + 2
neu ergänzte Yahoo-Finance-Serien (`JPY=X` USD/JPY, `GC=F` COMEX-Gold, per
`collect-macro`/`backfill-macro` v10/v8 nachgerüstet, ebenfalls seit
09/2024 zurückbefüllt — `XAUUSD=X` existiert auf Yahoo nicht, live per
404 verifiziert, `GC=F` funktioniert). Point-in-time-Join wie überall im
Protokoll: jüngste `macro_snapshots`-Zeile mit `timestamp_utc <=
evaluation_time` (gleiches Muster wie das bereits bestehende
`get_macro_regime_asof()`).

**Wichtige Abgrenzung zum bestehenden "Makro-Regime"-Faktor im
Setup-Score:** das ist ein LIVE-ONLY, verdichteter Faktor (Risk-On/Off aus
4 Signalen kombiniert) mit kleiner Stichprobe (n=337-445, weil er nur
vorwärts ab seiner Einführung geloggt wird). Runde 4 hier testet
stattdessen die EINZELNEN Bestandteile (DXY, S&P, Nasdaq, VIX,
Net-Liquidity) rückwirkend gegen die vollen 2 Jahre — granularer, besser
statistisch abgesichert, keine Dopplung.

**7 Kandidaten, Hypothesen jetzt festgelegt** (Schwellenwerte identisch zu
den bereits produktiven `get_macro_regime()`-Grenzen, wo vorhanden — keine
neu erfundenen Werte):

1. **DXY-Bewegung** — DXY fällt (Tagesänderung < -0,3%) → UP; DXY steigt
   (> +0,3%) → DOWN. (Dollar-Schwäche/-Stärke, invers.)
2. **S&P-500-Bewegung** — Tagesänderung > +0,5% → UP; < -0,5% → DOWN.
3. **Nasdaq-Bewegung** — dieselben Schwellen wie S&P, separat getestet
   (Tech-Beta könnte stärker/schwächer sein als Breitmarkt).
4. **VIX erhöht** (> 25) → DOWN NUR (Risk-Off-Hypothese ist einseitig,
   "VIX niedrig → UP" wird bewusst NICHT mitgetestet, keine symmetrische
   Ruhe-Hypothese vorregistriert).
5. **Net-Liquidity steigt** (Fed-Bilanz − TGA − Reverse-Repo,
   Tagesänderung > +0,5%) → UP NUR (Lyn-Alden-Liquiditäts-Framework).
6. **USD/JPY fällt** (Yen stärker, Tagesänderung < -0,3%, Carry-Trade-
   Risiko) → DOWN NUR.
7. **Gold-Bewegung** — Ko-Bewegungs-Hypothese (nicht Safe-Haven-Gegensatz):
   Gold steigt (> +0,5%) → UP; Gold fällt (< -0,5%) → DOWN. Symmetrisch
   wie DXY, aber GLEICHE statt umgekehrte Richtung.

**Methodik identisch zum Rest des Protokolls:** dieselben 8.818
nicht-überlappenden 4h-Bewertungspunkte, derselbe kumulative BH-FDR-Pool,
MIN_N=10.

## Runde 4 — KORRIGIERT: Datenlücke entdeckt und geschlossen

**Wichtiger Nachtrag (12.09.2026, noch am selben Tag):** beim Vorbereiten von Runde 5 fiel auf,
dass `^VIX`/`^GSPC`/`^IXIC`/`DX-Y.NYB`/`WALCL`/`WTREGEN`/`RRPONTSYD` in `macro_snapshots`
ursprünglich nur ab **2024-09-04** zurückbefüllt waren — das Regime-Score-Bewertungsraster reicht
aber bis **2022-09-04** zurück. Für die ÄLTERE HÄLFTE der 8.818 Bewertungspunkte gab es für
diese Kandidaten also GAR KEINE Daten und sie wurden fälschlich als "inaktiv" statt "unbekannt"
gewertet (`coalesce(..., false)`) — dieselbe Fehlerklasse, die schon bei den TradingView-Signalen
in Runde 1 aufgefallen war, hier nur unbemerkt in einem bereits abgeschlossenen Testlauf. Über
einen separaten Backfill (2022-09-04 bis 2024-09-03, `backfill-macro`) geschlossen, Runde 4
komplett neu berechnet. Die ursprüngliche Tabelle unten ist durch die korrigierte ersetzt —
**Ergebnis der Korrektur: 3 der 11 Zellen sind jetzt tatsächlich signifikant**, wo vorher alle elf
knapp scheiterten.

## Runde 4 — Ergebnis (korrigiert): DXY-Bewegung (beide Richtungen) und Gold-Bewegung DOWN am nächsten dran, DXY übersteht BH-FDR

| Kandidat | Richtung | n (aktiv) | n (Rest) | Trefferquote aktiv | Trefferquote Rest | p (roh) | BH-FDR |
|---|---|---|---|---|---|---|---|
| **M2-Wachstum*** | UP | 5.997 | 2.822 | 34,2% | 30,3% | 0,00028 | ✓ signifikant |
| **DXY-Bewegung** | DOWN | 1.858 | 6.961 | 36,6% | 32,6% | 0,00126 | ✓ signifikant |
| **DXY-Bewegung** | UP | 1.884 | 6.935 | 35,5% | 32,3% | 0,0086 | ✓ signifikant |
| Gold-Bewegung | DOWN | 1.262 | 7.557 | 36,1% | 33,0% | 0,030 | ✗ |
| CPI-Anstieg* | DOWN | 8.031 | 788 | 33,2% | 36,3% | 0,077 | ✗ |
| S&P-500-Bewegung | UP | 2.743 | 6.076 | 34,1% | 32,5% | 0,127 | ✗ |
| Gold-Bewegung | UP | 1.767 | 7.052 | 34,5% | 32,6% | 0,139 | ✗ |
| VIX erhöht | DOWN | 678 | 8.141 | 35,8% | 33,3% | 0,172 | ✗ |
| Nasdaq-Bewegung | UP | 3.154 | 5.665 | 33,8% | 32,5% | 0,226 | ✗ |
| PCE-Anstieg* | DOWN | 8.133 | 686 | 33,3% | 35,3% | 0,294 | ✗ |
| Net-Liquidity steigt | UP | 1.779 | 7.040 | 32,0% | 33,2% | 0,343 | ✗ |
| Nasdaq-Bewegung | DOWN | 2.435 | 6.384 | 34,0% | 33,2% | 0,473 | ✗ |
| S&P-500-Bewegung | DOWN | 1.906 | 6.913 | 34,1% | 33,3% | 0,503 | ✗ |
| USD/JPY fällt | DOWN | 1.107 | 7.712 | 32,6% | 33,6% | 0,521 | ✗ |

(\* Runde 5, siehe unten — hier schon mit einsortiert, damit die vollständige, nach p-Wert
sortierte Rangfolge über beide Runden sichtbar ist.)

**DXY-Invertierung jetzt in BEIDEN Richtungen voll bestätigt** (nicht nur "knapp" wie vor der
Korrektur) — DXY fällt→UP und DXY steigt→DOWN übersteigen beide BH-FDR klar. Gold-Bewegung DOWN
bleibt knapp unter α=0,05 roh, übersteht die Korrektur aber weiterhin nicht.

**Yen-Carry-Trade-Hypothese bleibt nicht bestätigt** (USD/JPY war von der Datenlücke nicht
betroffen, hatte schon vorher die volle Historie) — Trefferquote weiterhin unter der Basisrate.
**Nasdaq bleibt schwächer als S&P**, VIX/Net-Liquidity bleiben ohne Effekt.

## Runde 5 (12.09.2026): M2 / CPI / PCE — Ergebnis

| Kandidat | Richtung | n (aktiv) | n (Rest) | Trefferquote aktiv | Trefferquote Rest | p (roh) | BH-FDR |
|---|---|---|---|---|---|---|---|
| M2-Wachstum | UP | 5.997 | 2.822 | 34,2% | 30,3% | 0,00028 | ✓ signifikant |
| CPI-Anstieg | DOWN | 8.031 | 788 | 33,2% | 36,3% | 0,077 | ✗ |
| PCE-Anstieg | DOWN | 8.133 | 686 | 33,3% | 35,3% | 0,294 | ✗ |

**M2-Wachstum übersteht BH-FDR klar** — aber siehe die wichtige Einschränkung im
Out-of-Sample-Check unten, bevor das als "produktionsreif" gilt. **CPI/PCE bestätigen sich
nicht** — bemerkenswert sogar in die dem naiven "hohe Inflation → belastend"-Narrativ
entgegengesetzte Richtung (Trefferquote bei CPI-Anstieg NIEDRIGER als ohne), wenn auch nicht
signifikant. Wie vorab benannt: die Aktivierungsmenge ist extrem schief (CPI 91% aktiv, PCE 92%
aktiv) — inflation steigt auf Monatsbasis fast immer.

## Out-of-Sample-Check der 3 neuen signifikanten Kandidaten — M2 ausgeschlossen, DXY bestätigt

| Kandidat | Split | n (aktiv) | Trefferquote aktiv | n (inaktiv) | Trefferquote inaktiv |
|---|---|---|---|---|---|
| DXY-Bewegung (DOWN) | Train / Test | 1.488 / 369 | 36,4% / 37,4% | 5.078 / 1.878 | 32,0% / 34,5% |
| DXY-Bewegung (UP) | Train / Test | 1.501 / 383 | 35,6% / 35,2% | 5.065 / 1.864 | 32,3% / 32,3% |
| M2-Wachstum (UP) | Train / Test | 3.744 / 2.247 | 35,0% / 32,8% | 2.822 / **0** | 30,3% / **—** |

**DXY-Bewegung hält out-of-sample in beiden Richtungen** — Effekt bleibt in Train und Test
konsistent positiv (+2,9 bis +4,4 Prozentpunkte), fließt daher in den produktiven WOE-Score ein.

**M2-Wachstum wird trotz BH-FDR-Signifikanz NICHT aufgenommen**: im Test-Zeitraum (ab
2025-09-04) war M2 durchgehend positiv — **null inaktive Beobachtungen im Test-Fenster**. Der
"Signifikanz"-Befund stammt ausschließlich aus der Trainings-Periode (2022–2025, inkl. der
QT-Phase mit zeitweise schrumpfender M2), lässt sich im Testfenster aber gar nicht prüfen, weil
dort keine Vergleichsgruppe existiert. Statistisch signifikant ist nicht dasselbe wie
produktionsreif — genau der Grund, warum dieses Protokoll durchgängig BEIDE Prüfungen verlangt.
M2-Wachstum bleibt vorregistrierter, aber nicht produktiver Kandidat; sobald M2 wieder eine
contractive Phase durchläuft, ist eine erneute Prüfung sinnvoll.

**Kollinearitäts-Check für DXY-Bewegung** (φ gegen die bereits verwendeten Faktoren): Struktur 4h
0,04, CVD-Z-Score 0,02, MTF-Alignment 0,04 — praktisch unabhängig. Plausibel: DXY ist ein
eigenständiges Asset, keine BTC-Preisableitung. Deshalb als EIGENER Faktor aufgenommen, nicht in
Trend-Konsens gebündelt.

## Produktiver WOE-Score — Update: DXY-Bewegung als vierter Faktor

**UP:** Trend-Konsens (0-6) + CVD-Z-Score + Bollinger %b + **DXY-Bewegung (neu)**.
**DOWN:** Trend-Konsens (0-6) + CVD-Z-Score + Momentum-Faktor + **DXY-Bewegung (neu)**.

**Neue Terzil-Grenzen (kombinierter Logit über alle 8.819 Bewertungspunkte):**

| Richtung | Basisrate | Niedrig bis | Mittel bis | Hoch ab |
|---|---|---|---|---|
| UP | 33,0% | ≤29,9% | ≤33,9% | >33,9% |
| DOWN | 33,5% | ≤30,2% | ≤34,3% | >34,3% |

**Out-of-Sample-Bestätigung des aktualisierten, kombinierten Scores** (4 Faktoren statt 3):

| Stufe | UP Train | UP Test | DOWN Train | DOWN Test |
|---|---|---|---|---|
| Niedrig | 27,3% | 27,7% | 28,1% | 30,5% |
| Mittel | 32,8% | 32,5% | 31,6% | 35,6% |
| Hoch | 39,5% | 40,0% | 39,6% | 39,3% |

Weiterhin sauber monoton und stabil zwischen Train/Test in beiden Richtungen — der um DXY
erweiterte Score hält, keine Verschlechterung gegenüber der 3-Faktoren-Version.

**Konsequenz:** Pool erweitert sich von 40 auf 47 vorregistrierte Kandidaten (7 Cross-Asset in
Runde 4 + hier mitgezählt) plus 3 weitere aus Runde 5 (M2/CPI/PCE waren im ursprünglichen
Protokoll nicht enthalten) — Pool jetzt **50 Kandidaten, davon 31 getestet** (58 testbare
Zellen, jetzt **17 signifikant** — 14 aus Runden 1-3 + DXY UP/DOWN + M2). Von den 17
signifikanten Zellen fließen 16 in den produktiven Score ein (DXY neu dazu) — M2 bleibt aus dem
genannten OOS-Grund draußen.

## Runde 5 (12.09.2026): M2 / CPI / PCE — Vorregistrierung

Nutzer-Wunsch, die in Runde 4 noch fehlenden Liquiditäts-/Inflationsserien nachzutesten.

**Wichtiger Datenqualitäts-Fund vor dem Test:** `M2SL`/`CPIAUCSL`/`PCEPI` waren in
`macro_snapshots` bisher NICHT wie `WALCL`/`WTREGEN`/`RRPONTSYD` historisch zurückbefüllt — nur
~700 Zeilen aus dem laufenden Live-Collector, alle auf 1-2 tatsächliche Beobachtungsdaten
(Juli/August 2026) verdichtet. Für einen Test gegen die vollen 2 Jahre unbrauchbar (extreme
Uninformativität durch fehlende Historie, dasselbe Muster wie bei den TradingView-Signalen in
Runde 1). Backfill nachgeholt (`backfill-macro` erweitert).

**Zweiter, wichtigerer Fund: Publikations-Verzug (Look-Ahead-Risiko).** Anders als die
wöchentlichen Fed-Serien (WALCL/TGA/RRP, Verzug wenige Tage) werden CPI/PCE/M2 als monatliche
Regierungsstatistik erst WOCHEN nach dem Stichmonat veröffentlicht (CPI ~6 Wochen nach
Monatsbeginn, PCE ~8 Wochen, M2 ~7 Wochen — FRED speichert den Wert unter dem Stichmonat-Datum,
nicht dem Veröffentlichungsdatum). Ein naiver Backfill mit dem FRED-Datum als `timestamp_utc`
würde eine Look-Ahead-Verzerrung einbauen (der Wert wäre im System "bekannt", bevor er real
veröffentlicht wurde) — genau das Gegenteil dessen, was dieses Protokoll durchgängig vermeidet.
Behoben durch einen konservativen, fest hinterlegten Publikations-Verzug je Serie beim Backfill
(CPI +45 Tage, PCE +58 Tage, M2 +49 Tage ab Stichmonat-Beginn) — die Live-Collector-Zeilen
(`collect-macro`) sind davon NICHT betroffen, die fragen FRED live nach dem "aktuellsten
veröffentlichten Wert" ab, was den echten Veröffentlichungszeitpunkt automatisch respektiert.

**3 Kandidaten, Hypothesen jetzt festgelegt** (Richtung aus der bereits im Protokoll zitierten
Interpretation übernommen, siehe `lib/economicCalendar.ts`):

1. **M2-Wachstum** (Vormonatsänderung `change_pct > 0`, jede Zunahme, kein Schwellenwert — bei
   monatlicher, glatter Serie ungeeignet für einen %-Schwellenwert wie bei Tagesdaten) → UP
   (Lyn-Alden-Liquiditäts-Framework).
2. **CPI-Anstieg** (Vormonatsänderung `change_pct > 0`) → DOWN NUR (höhere Inflation → hawkishere
   Fed erwartet → belastend für Risikoassets, wie in `lib/economicCalendar.ts` bereits
   dokumentiert).
3. **PCE-Anstieg** (Vormonatsänderung `change_pct > 0`) → DOWN NUR, gleiche Begründung wie CPI
   (Fed-bevorzugtes Inflationsmaß).

**Bekannte Einschränkung, vorab benannt:** CPI/PCE steigen auf Monatsbasis fast immer (negative
Monatswerte sind historisch selten) — die Aktivierungsmenge wird dadurch sehr groß/schief
verteilt. Das ist kein Fehler, nur vorab transparent gemacht, damit ein spätes "n1 fast so groß
wie n" nicht als Bug missverstanden wird.

**Methodik identisch zum Rest des Protokolls:** dieselben 8.818 nicht-überlappenden
4h-Bewertungspunkte, derselbe kumulative BH-FDR-Pool, MIN_N=10.

## Runde 5 — Ergebnis

## Einordnung — noch nicht die Ebene-1-Bewertung

Wie im Struktur-Konzept (Abschnitt 5) festgehalten: Kollinearitäts-Prüfung, Out-of-Sample-
Validierung und ein produktiver WOE-Score sind jetzt erledigt (siehe oben) — methodisch auf
demselben Stand wie der Setup-Score. **Trotzdem noch nicht Ebene 1**, weil erst 17 von 39
vorregistrierten Kandidaten getestet wurden:

1. Die 22 noch nicht getesteten Kandidaten (18 Original-Signale ohne reproduzierbare
   Klassifizierungslogik + 4 datenknappe neue Regime-Matrix-Signale, siehe Protokoll Abschnitt 2)
   — spätere Erweiterungsrunde. Kumulativer BH-FDR-Pool wächst nur, bestehende Ergebnisse bleiben
   gültig (identisches Prinzip wie beim Setup-Score).
2. Sobald weitere Kandidaten getestet sind: `research_regime_score_refresh()` erneut ausführen
   (überschreibt WOE/Tiers vollständig neu aus dem dann grösseren Signal-Set).

**Wöchentlicher Cron `regime-score-pipeline-weekly`** (Montag 05:30 UTC, 30 Min nach dem
Setup-Score-Job) hält das Ganze von Anfang an lernend statt statisch — direkte Umsetzung von
"Nexus und der Score sind lernbar" (Struktur-Konzept Abschnitt 0).

## Neue DB-Objekte

`research_regime_evaluation_events()` (Ereignisquelle), `research_regime_signal_activation`
(Aktivierung je Bewertungspunkt/Signal/Richtung), `research_regime_signal_stats` +
`research_regime_refresh_stats()` (Statistik, eigener Pool), `research_regime_bh_fdr(alpha)`
(BH-FDR, komplett getrennt von `research_confluence_bh_fdr`), `research_regime_score_woe` +
`research_regime_score_tiers` + `research_regime_score_refresh()` (WOE-Kombination),
`research_regime_score_live()` (Live-Lookup, analog `research_confluence_score_live()`),
Cron-Job `regime-score-pipeline-weekly`. `backfill-history` Edge Function um `computeAtr()`
ergänzt (deployed v9) und einmalig über die volle 1h-Historie ausgeführt.
`research_regime_extend_activation_round2()` (Funding-Z-Score/Net-Taker-Flow-Ratio/OI-Quadrant,
alle nicht signifikant), `research_regime_extend_activation_round3()` (CPR, alle 3 Kandidaten
nicht signifikant, siehe oben), `research_regime_extend_activation_round4()` (7
Cross-Asset-Korrelations-Kandidaten — DXY-Bewegung UP/DOWN, S&P-500-Bewegung UP/DOWN,
Nasdaq-Bewegung UP/DOWN, VIX erhöht, Net-Liquidity steigt, USD/JPY fällt, Gold-Bewegung UP/DOWN),
einmal versehentlich auf einer unvollständigen Datenbasis gelaufen (siehe Korrektur oben) und
nach dem Lücken-Fix erneut ausgeführt, sowie `research_regime_extend_activation_round5()`
(M2-Wachstum, CPI-Anstieg, PCE-Anstieg).

`collect-macro` (v10) und `backfill-macro` (v12) um `JPY=X` (USD/JPY) und `GC=F` (Gold,
COMEX-Future) ergänzt sowie um `M2SL`/`CPIAUCSL`/`PCEPI` (FRED), 2 Jahre zurückbefüllt.
`backfill-macro` zusätzlich um einen `publicationLagDays`-Offset je FRED-Serie erweitert
(CPI +45, PCE +58, M2 +49 Tage; WALCL/WTREGEN/RRPONTSYD +0), damit `timestamp_utc` beim
Backfill den tatsächlichen Publikationszeitpunkt statt des von FRED verwendeten
Referenzmonats abbildet (Lookahead-Bias-Fix für die Asof-Joins, `market_time_utc` behält
weiterhin das echte Referenzdatum). Ausserdem einmalig mit auf `2022-09-04`–`2024-09-03`
begrenztem Zeitraum für VIX/S&P/Nasdaq/DXY/WALCL/WTREGEN/RRPONTSYD nachbefüllt, um die oben
beschriebene Datenlücke zu schliessen.

`add_dxy_factor_to_regime_score` (Migration) — `research_regime_score_refresh()` um den
vierten Faktor `dxy` (aus `DXY-Bewegung`, beide Richtungen) erweitert, sowohl in den
WOE-Einträgen als auch in den Tier-Grenzen-Subqueries beider Richtungen.
`add_dxy_to_regime_score_live` (Migration) — `research_regime_score_live()` neu erstellt
(Spalte `dxy_active` zwischen `bollinger_pctb_active` und `probability` eingefügt), berechnet
DXY-Aktivierung live aus `macro_snapshots` (Symbol `DX-Y.NYB`) und addiert das passende
WOE-Gewicht je Richtung. M2-Wachstum bewusst NICHT in den Live-Score aufgenommen (BH-FDR-
signifikant, aber Out-of-Sample-Check degeneriert, siehe oben).

**Noch offen (nächster Schritt, nicht Teil dieser Umsetzung):** die restlichen 19 noch nicht
getesteten Kandidaten (18 Original-Signale ohne reproduzierbare Klassifizierungslogik + 1
datenknappes neues Regime-Matrix-Signal). UI-Anbindung für DXY ist mit diesem Commit erledigt
(siehe `components/RegimeScoreCard.tsx`); der Score bleibt trotzdem als "in Aufbau"
gekennzeichnet, da das Struktur-Konzept die Gesamteinschätzung erst nach vollständiger
Validierung als abgeschlossene Ebene-1-Kachel vorsieht.
