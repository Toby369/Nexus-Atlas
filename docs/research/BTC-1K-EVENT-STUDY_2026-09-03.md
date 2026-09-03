# Event-Studie: Nexus-Zustand vor $1000-BTC-Bewegungen

Auswertung auf Toby's Anfrage ("evaluieren wo btc in definiertem zeitraum 1k preisbewegung gehabt hat und was nexus davor für signale geliefert hat"). Alle Zahlen unten sind reale, live aus der Produktions-Datenbank (Supabase `cpktesxmbqrzpsurntul`) abgefragte Werte — keine Beispieldaten. Methodik wurde **vor** dem Blick auf die Ergebnisse festgelegt, um Cherry-Picking zu vermeiden.

## 1. Methodik

- **Event-Definition**: BTCUSDT-Kerze (Binance, 4h-Intervall) mit `|close − open| ≥ $1000`.
- **Signal-Fenster**: der Nexus-Zustand (`backtest_states`, `interval='4h'`, `point_in_time_safe=true`) der *unmittelbar vorangehenden* 4h-Kerze (`candle_open_time = event_open − 4h`). Dieses Feld ist genau für lookahead-freie Rekonstruktion gebaut (Purging/Embargo-Logik aus Phase 1) — es enthält nur Daten, die vor dem Event bekannt waren.
- **Zeitraum**: 15.07.–02.09.2026 (7 Wochen) — begrenzt durch die Verfügbarkeit von `backtest_states` mit `point_in_time_safe=true`. Preisdaten (`candles`) reichen zwar weiter zurück (4h seit 04.06.2026), aber ohne rekonstruierten Nexus-Zustand ist eine frühere Auswertung nicht möglich.
- **Stichprobe**: 295 Kerzen, davon 14 Events (4,7% Basisrate) — 9× Aufwärts-, 5× Abwärtsbewegung.

## 2. Events

| Event-Start (UTC) | Netto-Bewegung | Vorheriger Zustand | Score | Confidence |
|---|---|---|---|---|
| 2026-07-27 20:00 | −1238.4 | MIXED | −0.67 | 10 |
| 2026-07-31 12:00 | −1084.0 | MIXED | +0.67 | 10 |
| 2026-08-03 12:00 | +1125.4 | NEUTRAL | −1.00 | 14 |
| 2026-08-19 12:00 | +4044.6 | BULLISH | +2.67 | 38 |
| 2026-08-20 08:00 | +2080.3 | BULLISH | +4.00 | 57 |
| 2026-08-21 00:00 | +1484.1 | BULLISH | +4.00 | 57 |
| 2026-08-21 04:00 | +1827.5 | BULLISH | +4.00 | 57 |
| 2026-08-21 20:00 | +1313.7 | BULLISH | +4.00 | 57 |
| 2026-08-22 04:00 | −1108.3 | BULLISH | +4.00 | 57 |
| 2026-08-23 08:00 | +1275.8 | MIXED | +1.17 | 17 |
| 2026-08-24 08:00 | +1127.6 | BULLISH | +1.67 | 24 |
| 2026-08-25 00:00 | +1504.7 | BULLISH | +2.33 | 33 |
| 2026-08-28 12:00 | −1254.2 | BULLISH | +3.00 | 43 |
| 2026-08-30 20:00 | −1176.3 | BULLISH | +2.17 | 31 |

## 3. Basisraten-Vergleich (der eigentliche Test)

Rohe "10 von 14 waren BULLISH" wäre für sich genommen bedeutungslos — August 2026 war insgesamt eine Bull-Trendphase, in der die meisten Kerzen ohnehin BULLISH lasen. Entscheidend ist der Vergleich mit der unkonditionierten Häufigkeit über alle 295 Kerzen:

| Faktor | Basisrate (alle 295 Kerzen) | Vor den 14 Events | Lift |
|---|---|---|---|
| `structure` = bullisch | 58,3% | 85,7% | +27pp |
| `trend_strength` = stark | 49,2% | 78,6% | +29pp |
| `trend_regime` = im Trend | 55,9% | 71,4% | +16pp |
| `overall_state` = BULLISH | 48,5% | 71,4% | +23pp |
| `cvd` = positiv | 48,1% | 42,9% | ~0 (kein Effekt) |

`weighted_score`-Mittel vor Aufwärts-Events: 2,54. Vor Abwärts-Events: 1,83 — leichter, aber unzuverlässiger Richtungsunterschied (3 der 5 Abwärts-Events liefen ebenfalls aus einem BULLISH-Zustand mit Score ≥ 2,17 heraus).

## 4. Interpretation

**Auffällig, aber Richtungsblind.** Nexus' Trend-/Struktur-Faktoren liefen vor $1000-Bewegungen deutlich häufiger heiß als im Schnitt — das galt aber für **beide Richtungen** gleichermaßen. Order-Flow (`cvd`) zeigte keinen Vorlauf-Effekt.

**Sinnvoll?** Ja — das Muster entspricht Volatility Clustering: große Bewegungen häufen sich in Regimen, die als "trendstark" erkannt werden, unabhängig davon, ob die nächste Kerze mit oder gegen den Trend läuft. Nexus' Trend-Faktoren erkennen dieses Regime korrekt, sagen aber nichts über die Richtung der nächsten einzelnen Kerze.

**Verständlich?** Ja — die reagierenden Faktoren (`structure`, `trend_strength`, `trend_regime`) sind aus Marktmikrostruktur-Sicht plausibel; kein Blackbox-Ergebnis.

## 5. Statistische Einordnung — warum das kein Handelssignal ist

- **N=14 ist klein.** Für `structure` (12/14 vs. Basisrate 58,3%) ergibt ein einfacher Zweistichproben-Test p≈0,02 — grenzwertig, pro Einzeltest.
- **Multiple-Comparisons-Problem**: 5 Faktoren gleichzeitig getestet, ohne Korrektur. Nach Bonferroni/FDR-Korrektur würden vermutlich nur `structure`/`trend_strength` knapp überleben.
- **Kein Out-of-Sample-Split, kein Bootstrap.** Beides wäre laut Recherche (Abschnitt 6) der nächste nötige Schritt vor jeder Handlungsableitung.
- **Kurzer Zeitraum**: 7 Wochen decken im Wesentlichen eine einzige anhaltende Bull-Trendphase ab — die Ergebnisse sind ggf. regime-spezifisch (Ergebnis könnte in einer Seitwärts- oder Bärenphase anders aussehen) und nicht ohne Weiteres verallgemeinerbar.

## 6. Wie Profis das machen (Recherche-Briefing)

Diese Art Analyse heißt in der Quant-Praxis **Event-Study-Methodik** (Fama et al., 1969), hier als "Pre-Event Signal Analysis" angewendet — bzw. bei kontinuierlicher Anwendung "Regime Detection" / "Precursor-/Leading-Indicator-Analyse".

**Standard-Vorgehen:**
- Event- und Lookback-Fenster **vor** der Analyse fixieren, um Look-Ahead-Bias und nachträgliches Tunen der Schwellenwerte zu vermeiden (in dieser Studie so umgesetzt).
- Immer **Basisrate/unkonditionierte Häufigkeit** neben die "Treffer" stellen, nicht nur Letztere zeigen (Abschnitt 3).
- Bei kleiner Stichprobe: **Bootstrap-Resampling** statt reinem t-Test, da Krypto-Renditen fat-tailed/nicht-normal sind.
- Bei mehreren getesteten Signalen: **False Discovery Rate (FDR)** oder Bonferroni/Šidák-Korrektur; als etablierter Standard zur Korrektur von Selection-Bias bei mehrfachem Testen gilt die **Deflated Sharpe Ratio** (Bailey & López de Prado).
- Validierung über **Walk-Forward/Out-of-Sample-Splits** statt reinem In-Sample-Pattern-Matching.

**Meistgenannte Fallstricke** (genau die, die diese Studie zu vermeiden versucht hat): zu kleine Stichprobe bei seltenen Extremereignissen, Data-Snooping/Cherry-Picking (viele Indikatoren/Schwellen testen und nur die "Treffer" zeigen), Überanpassung an Rauschen, kontaminierte Baseline durch überlappende Events, sowie Survivorship — nur bestätigte Muster zeigen, ohne die Fälle zu nennen, in denen das Signal auftrat, ohne dass eine große Bewegung folgte (in dieser Studie durch den expliziten Basisraten-Vergleich in Abschnitt 3 adressiert).

Quellen (vom Recherche-Agenten gefunden):
- [Event Study Methodology: A Step-by-Step Guide](https://www.eventstudytools.com/introduction-event-study-methodology)
- [The Event Study Methodology Since 1969](https://link.springer.com/article/10.1023/A:1008295500105)
- [Determination of the Appropriate Event Window Length](https://www.researchgate.net/publication/228236118_Determination_of_the_Appropriate_Event_Window_Length_in_Individual_Stock_Event_Studies)
- [The Deflated Sharpe Ratio (Bailey & López de Prado)](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf)
- [A Reality Check For Data Snooping (White)](https://www.researchgate.net/publication/2551052_A_Reality_Check_For_Data_Snooping)
- [Technical Analysis and Discrete False Discovery Rate](https://arxiv.org/pdf/1811.06766)

## 7. Fazit

Kein Trading-Signal, aber ein plausibles, verständliches Muster: Nexus' Trend-/Struktur-Faktoren laufen vor größeren BTC-Bewegungen tendenziell heiß — als **Risiko-/Volatilitäts-Hinweis** ("wir sind in einem Regime, in dem größere Swings wahrscheinlicher sind"), nicht als Richtungs-Prognose für die nächste Kerze. Bei N=14 ist das eine interessante Beobachtung, kein belastbares Ergebnis. Für mehr Robustheit bräuchte es entweder einen längeren Zeitraum (aktuell durch `backtest_states`-Historie auf 7 Wochen begrenzt) oder eine gröbere Event-Schwelle für mehr Samples, plus Bootstrap/FDR-Korrektur nach den in Abschnitt 6 skizzierten Standards.

Kein Automatismus, keine Anlageberatung.
