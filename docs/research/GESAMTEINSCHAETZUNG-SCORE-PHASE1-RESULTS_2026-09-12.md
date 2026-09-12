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

## Einordnung — noch nicht die Ebene-1-Bewertung

Wie im Struktur-Konzept (Abschnitt 5) festgehalten: dies ist Zwischenstand einer laufenden
Validierung, kein fertiger Score. **Noch ausstehend, bevor eine Gesamteinschätzung-Score-Zahl
entstehen kann:**

1. Out-of-Sample-Validierung (Train/Test-Split mit Embargo, wie beim Setup-Score dreifach
   gemacht) — bisher nur In-Sample-Ergebnis.
2. Kollinearitäts-Prüfung: Struktur 1h/4h/1d, MTF-Alignment, Trendstärke sind vermutlich wieder
   stark korreliert (derselbe "folgt der Kurs dem Trend"-Kern-Effekt wie beim Setup-Score) —
   Konsens-Bündelung nötig, bevor eine WOE-Kombination sinnvoll ist.
3. Die 22 noch nicht getesteten Kandidaten (18 Original-Signale ohne reproduzierbare
   Klassifizierungslogik + 4 datenknappe neue Regime-Matrix-Signale, siehe Protokoll Abschnitt 2)
   — spätere Erweiterungsrunde, ändert nichts an den hier festgehaltenen Ergebnissen (kumulativer
   BH-FDR-Pool wächst nur).
4. Score-Architektur-Entscheidung erst nach Punkt 1+2, analog zum Setup-Score-Vorgehen.

## Neue DB-Objekte

`research_regime_evaluation_events()` (Ereignisquelle), `research_regime_signal_activation`
(Aktivierung je Bewertungspunkt/Signal/Richtung), `research_regime_signal_stats` +
`research_regime_refresh_stats()` (Statistik, eigener Pool), `research_regime_bh_fdr(alpha)`
(BH-FDR, komplett getrennt von `research_confluence_bh_fdr`). `backfill-history` Edge Function
um `computeAtr()` ergänzt (deployed v9) und einmalig über die volle 1h-Historie ausgeführt.
