# Fallstudie: Engine-Divergenz vom 29.08.2026

Dokumentiert einen konkreten, live beobachteten Fall, in dem Market State (14-Faktoren-Engine) und Regime Matrix (5-Säulen-Engine) unterschiedliche Signale lieferten, sowie die daraus abgeleiteten methodischen Konsequenzen. Alle Zahlen unten sind reale, zum genannten Zeitpunkt aus der Produktions-Datenbank (Supabase `cpktesxmbqrzpsurntul`) abgefragte Werte — keine Beispieldaten.

## 1. Rohdaten-Snapshot

**Market State** (`compute-market-state` v8), Zeitstempel 2026-08-29 12:45:01 UTC:

| Feld | Wert |
|---|---|
| overall_state | MIXED |
| score | +2 |
| confidence | 14/100 |
| data_coverage_pct | 85.7% |
| risk_level | LOW |
| MTF-Alignment | 65% (1H=+1 bullisch, 4H=-1 bärisch, 1D=+1 bullisch, dominant: bullisch) |

Einzelfaktoren (12/14 verfügbar):

| Faktor | Wert | Rohbasis |
|---|---|---|
| structure | +1 | bullish, kein BOS, kein CHoCH |
| momentum | 0 | RSI14=37.09, MACD-Hist=+65.46 |
| cvd | +1 | steigend, Delta=+67.44 |
| oi_price | keine Daten | OI-Delta fehlt |
| positioning | +1 | Score=15, Confidence=65 |
| orderbook | -1 | Ø Depth-Imbalance=-0.099, 3 Börsen |
| options | +1 | Put/Call-OI=0.562, Skew=22.91 |
| macro | 0 | Regime "Mixed" (2 Risk-On, 1 Risk-Off) |
| funding | 0 | Ø Rate=0.00843%, Spread=0.00653%, 6 Börsen |
| sentiment | 0 | Fear&Greed=68 ("Greed") |
| trend_strength | -1 | ADX14=35.11, +DI=12.83, -DI=26.22 |
| trend_regime | 0 | Preis=77563.4, EMA50=78413.3, EMA200=76875.8 |
| vwap_position | 0 | VWAP=77636.7, Diff=-0.094% |
| basis | keine Daten | Spot-Preis fehlt |

**Regime Matrix** (1H-Kerze, Zeitstempel 11:00:00 UTC, berechnet 12:15 UTC):

| Feld | Wert |
|---|---|
| regime | TREND_EXPANSION_BEARISH |
| data_coverage_pct | 100% |
| ADX14 / +DI / -DI | 35.11 / 12.83 / 26.22 |
| Regressionssteigung / R² | -3.95 / 0.028 |
| RSI14 | 37.09 |
| Dist-Z SMA20/50/200 | -0.333 / -1.196 / -0.616 |

## 2. Kernbefund: Structure vs. ADX-Expansion

`structure` (+1, "bullish", kein BOS/CHoCH) und `trend_strength` (-1, ADX zeigt starke bärische Trendstärke) widersprechen sich direkt — beide beziehen sich auf denselben 1H-Zeitraum, aber messen fundamental Verschiedenes:

- `structure` ist **swing-basiert** (Break-of-Structure/Change-of-Character auf vorherige Hoch-/Tiefpunkte) — träge per Definition: solange kein neuer Swing-Bruch stattfand, bleibt die zuletzt etablierte Struktur gültig, auch wenn sich der Trend darunter bereits dreht.
- `trend_strength` ist **ADX/DMI-basiert** — reagiert direkt auf die Richtungsdominanz der letzten Kerzen, ohne auf einen diskreten Struktur-Bruch zu warten.

Das ist die "Timeframe-Dissonanz" im Titel dieses Dokuments: nicht zwei unterschiedliche Zeitfenster, sondern zwei unterschiedliche *Reaktionsgeschwindigkeiten* auf denselben Zeitraum — ADX erkennt eine beginnende bärische Expansion, bevor die trägere Struktur-Definition das als offiziellen Bruch verbucht. Das ist kein Bug in einem der beiden Faktoren, sondern der bewusste Zweck, beide unabhängig zu führen (siehe Kommentar in `compute-market-state`: `trend_strength` ist als "eigenstaendiger Blickwinkel gegenueber structure" dokumentiert) — aber es bedeutet, dass ein einzelner additiver Score diese unterschiedliche Reaktionsgeschwindigkeit nicht abbildet, sondern nur die Summe zeigt.

Die Regime Matrix (rein ADX-/Steigungs-basiert, kein Struktur-Faktor) reagiert entsprechend schneller auf denselben Regimewechsel und meldet bereits `TREND_EXPANSION_BEARISH`, während Market State (mit `structure` als einem von 14 gleichgewichteten Stimmen) den Wechsel noch nicht in der Gesamtrichtung zeigt.

## 3. Confidence-Aufschlüsselung (neu: `computeConfidenceBreakdown`)

Mit der in diesem Sprint eingeführten Zerlegung (`lib/marketStateSummary.ts`) lässt sich die niedrige Confidence (14/100) jetzt in ihre Bestandteile auflösen:

- **Coverage**: 85,7% (12 von 14 Faktoren haben Daten)
- **Signal Strength**: 50,0% (6 von 12 verfügbaren Faktoren zeigen überhaupt eine Richtung — `positiveCount=4`, `negativeCount=2`, 6 sind neutral)
- **Consensus**: 66,7% (von den 6 gerichteten Faktoren stimmen 4 auf die Mehrheitsrichtung überein)

Rechnerische Probe: `Coverage × SignalStrength × |2×Consensus−1| × 100 = 0,857 × 0,50 × 0,333 × 100 ≈ 14` — exakte Reproduktion der gespeicherten Confidence, keine neu erfundene Kennzahl (siehe `lib/marketStateSummary.test.ts` für den Test mit exakt diesen Zahlen).

**Interpretation, die aus der einzelnen Zahl "14" vorher nicht ablesbar war:** Die niedrige Confidence liegt zur Hälfte an echter Uneinigkeit (Consensus 66,7% statt 100%) und zur Hälfte schlicht daran, dass die Hälfte der verfügbaren Faktoren neutral ist (Signal Strength nur 50%) — zwei unterschiedliche Ursachen, die vorher in einer Zahl untrennbar vermischt waren.

## 4. Engine Divergence — warum dieser Fall NOT_COMPARABLE ist

Mit `computeEngineDivergence(overall_state, regime)` ergibt dieser konkrete Fall `NOT_COMPARABLE`, nicht `DIVERGENCE`: Market State ist `MIXED` (keine gerichtete Aussage — `positiveCount>0` UND `negativeCount>0`), nicht `BULLISH`/`BEARISH`. Ein binärer Richtungsvergleich zwischen "keine klare Richtung" und "klar bärisch" wäre kein echter Befund, sondern eine erfundene Aussage — deshalb bewusst `NOT_COMPARABLE` statt einer erzwungenen Kategorisierung.

Das ist eine bewusste Designentscheidung, keine Lücke: der reale, inhaltliche Widerspruch dieses Falls liegt nicht in `overall_state` vs. `regime` (MIXED ist keine Richtung, die man widerlegen könnte), sondern in der MTF-Alignment-Aussage ("dominant bullisch") gegenüber dem 1H-Regime ("TREND_EXPANSION_BEARISH") sowie im `structure`-vs-`trend_strength`-Widerspruch selbst (Abschnitt 2). Ein zukünftiger, feingranularerer Divergenz-Vergleich könnte MTF-Alignment einbeziehen — bewusst nicht in diesem Sprint umgesetzt, um `computeEngineDivergence` als einfachen, auf Ground-Truth-Werten basierenden Vergleich zu belassen (kein dritter, neu interpretierter Wert).

## 5. Externe Validierung

Der Fall wurde unabhängig von einem externen LLM (Grok) anhand desselben Rohdaten-Snapshots analysiert (ohne Zugriff auf diesen Code oder die internen Audits). Kernübereinstimmungen mit der obigen Analyse:

- Korrekte Rekonstruktion der Score-Rechnung (4×(+1) + 2×(−1) = +2) rein aus den gelieferten Rohdaten.
- Unabhängige Identifikation des `structure`-vs-`trend_strength`-Widerspruchs als methodisch interessant, mit derselben Interpretation (unterschiedliche Definitionen/Reaktionsgeschwindigkeit).
- Korrekte Rückrechnung der Regime-Schwellenlogik (`ADX > Schwelle` + negative Steigung → `TREND_EXPANSION_BEARISH`) rein aus den Zahlen, ohne den SQL-Code zu sehen.
- Vorschlag eines "Engine Divergence als Meta-Faktor" — der Kern von Abschnitt 5.3 in `INSTITUTIONAL_COMPARE.md`.

Eine Präzisierung gegenüber der externen Analyse: Grok beschrieb die niedrige Confidence als Ausdruck von "Widerspruch" zwischen den Faktoren — Abschnitt 3 oben zeigt, dass nur die Hälfte davon (Consensus 66,7%) echter Widerspruch ist, die andere Hälfte (Signal Strength 50%) reine Neutralität. Das war ohne die neue Aufschlüsselung nicht unterscheidbar — eine direkte Bestätigung, warum Abschnitt 3 dieses Sprints (Confidence-Aufspaltung) einen echten Mehrwert liefert.

## 6. Konsequenzen — was daraufhin umgesetzt wurde

Siehe `docs/research/INSTITUTIONAL_COMPARE.md` Abschnitt 5 für die vollständige Beschreibung. Kurzfassung:

1. **Confidence-Aufspaltung** (Coverage/Signal Strength/Consensus) im UI — macht genau die in Abschnitt 3/5 gezeigte Unterscheidung sichtbar.
2. **Engine-Divergence-Status** ("Regime Transition / Engine Divergence HIGH") — für zukünftige Fälle, in denen Market State tatsächlich BULLISH/BEARISH zeigt und der Regimatrix widerspricht (dieser konkrete Fall wäre `NOT_COMPARABLE` geblieben, siehe Abschnitt 4, aber der Mechanismus fängt den nächsten echten Fall).
3. **Faktoren-Gruppierung + Rohwerte** im UI — macht den `structure`-vs-`trend_strength`-Widerspruch aus Abschnitt 2 direkt im Dashboard sichtbar, ohne die Rohdaten separat abfragen zu müssen.
4. **Z-Score-Normalisierungskonzept** (`research-python/src/features/factor_normalization.py`) — adressiert den strukturellen Punkt hinter Abschnitt 3: RSI 37,09 (aktueller Wert) und RSI 44,9 (knapp unter der 45er-Schwelle) sind beide "neutral" in der harten Diskretisierung, obwohl deutlich unterschiedlich aussagekräftig. Als Research-Konzept vorhanden, nicht in Produktion übernommen.

## 7. Offene Fragen

- Sollte `computeEngineDivergence` MTF-Alignment als dritte Vergleichsgröße einbeziehen, statt nur `overall_state` vs. `regime`? Aktuell bewusst nicht umgesetzt (Abschnitt 4).
- Ist die Trägheit von `structure` (swing-basiert) im Vergleich zu `trend_strength` (ADX-basiert) empirisch zu quantifizieren (z. B. durchschnittliche Verzögerung in Kerzen zwischen einem ADX-Trendwechsel und dem nächsten Struktur-Bruch)? Bisher nicht gemessen — Research-Kandidat.
- Das Z-Score-Konzept (Abschnitt 6, Punkt 4) ist bewusst nicht produktiv — ein empirischer Vergleich auf VALIDATION/TEST-Daten (Model E, analog zu `PHASE-0-RECONCILIATION.md`) steht noch aus.
