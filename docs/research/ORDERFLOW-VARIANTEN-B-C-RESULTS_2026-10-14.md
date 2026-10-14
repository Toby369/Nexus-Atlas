# Orderflow Varianten B und C — Ergebnisse (14.10.2026)

Protokolle: `ORDERFLOW-VARIANTE-B-VA-RAND_PROTOCOL_2026-10-14.md`,
`ORDERFLOW-VARIANTE-C-1H_PROTOCOL_2026-10-14.md`. **Beide explorativ**, also auf denselben
Daten wie das Grund-Protokoll (10/2022–09/2026) getestet. Jeder Lauf kam aus einem
sauberen, gepushten Commit (Hash im jeweiligen Rohbericht unten).

## Kurzfassung

1. **Variante B (15m, Ziel am VA-Rand) ist verworfen.** Das Mengenproblem ist gelöst:
   Long-V1 hat jetzt 273 statt 48 Trades. Das Setup verliert aber klar: Long-V4 kommt auf
   −0,67 R je Trade (45 Trades), Short-V4 auf −0,27 R (30 Trades). Long+Short-V4 zusammen
   ergeben −38,4 R, das 95 %-Konfidenzintervall des Tages-R liegt ganz unter null.
2. **Variante C (1h) bleibt zu klein für eine Aussage.** Das volle Framework (V4) hat 0–8
   Trades je Unter-Variante. Alle Hypothesen enden in `INSUFFICIENT_DATA`.
3. **Ein Muster zieht sich durch alle Läufe:** Die Filter aus dem Video (Ort und Umfeld)
   verbessern das Ergebnis nicht. H3 (Ort) ist in keinem Lauf auch nur nominal positiv.
   H4 (Umfeld) ist nominal positiv nur in B, wo alles verliert, und dort unter dem
   Mindest-n.
4. **Einziger Lichtblick, mit Vorbehalt:** Der *ungefilterte* 1h-Auslöser mit Ziel am
   VA-Rand (C2, V1) ist beschreibend positiv, Long +0,10 R (75 Trades), Short +0,45 R
   (61 Trades). Das ist aber genau die Art Ergebnis, die man findet, wenn man genug
   Varianten durchprobiert: 6 Konfigurationen × 4 Varianten × 2 Richtungen. **Kein
   Beleg**, höchstens ein Kandidat für einen Vorwärtstest.

**Folge:** Keine Live-Signale, keine Dashboard-Kachel. Das Orderflow-4-Schritte-Framework
in dieser Form ist mit unseren Daten nicht belegbar, und die Filterschritte aus dem Video
zeigen in keinem Lauf einen Mehrwert.

## Übersicht Gesamtprobe (R je Trade nach Kosten, Trades in Klammern)

| Lauf | V1 Long | V4 Long | V1 Short | V4 Short |
|---|---|---|---|---|
| Grund-Protokoll (15m, VWAP/POC) | −0,49 (48) | +0,51 (2) | −0,42 (59) | −1,24 (5) |
| **B** (15m, VA-Rand) | −0,29 (273) | −0,67 (45) | −0,22 (250) | −0,27 (30) |
| **C1** (1h, VWAP/POC) | +0,01 (23) | – (0) | +0,38 (21) | +1,30 (2) |
| **C2** (1h, VA-Rand) | +0,10 (75) | −0,77 (8) | +0,45 (61) | +0,09 (6) |

Entscheide (Holm je Familie, Mindest-n 100):

- Alle H1 (V4 > 0): `INSUFFICIENT_DATA`.
- **H2 (Auslöser schlägt Zufall)** ist in B Long und B Short formal „bestätigt“ (n ≥ 100,
  p_holm 0,005). Das ist wie im Grund-Protokoll vor allem ein Artefakt der Nulllinie. Die
  Zufallseinstiege mit sehr engem Stop verlieren durch die Kosten rund −0,25 R je Tag. Der
  Auslöser selbst verliert ebenfalls (−0,05 bzw. −0,04 R je Tag), nur weniger.
- **H3 (Ort bringt etwas)** ist in B Long und B Short mit n ≥ 100 auswertbar: **nicht
  bestätigt** (p 0,50 bzw. 0,29).

## Was ist mit C2 V1 (1h, Ziel am VA-Rand, ohne Filter)?

| | Trades | Trefferquote | R je Trade | R Summe | profitable Monate |
|---|---|---|---|---|---|
| Long | 75 | 39 % | +0,10 | +7,4 | 56 % |
| Short | 61 | 36 % | +0,45 | +27,2 | 43 % |
| zusammen | 136 | – | +0,25 | +34,5 | – |

Warum das kein Ergebnis ist, auf das man setzen sollte:

- **Viele Versuche:** Diese Zahl ist die beste von vielen Kombinationen. Bei so vielen
  Versuchen ist ein positives Teilergebnis auch dann zu erwarten, wenn kein Edge existiert.
- **Wenige Trades** über vier Jahre, und der Short-Gewinn hängt an wenigen grossen
  Gewinnern (Trefferquote 36 %, nur 43 % profitable Monate).
- **Keine Bestätigung durch die Filter:** Das Framework sagt, Ort und Umfeld sollten die
  Qualität verbessern. In C2 machen sie das Ergebnis schlechter (Long V4: −0,77 R).

**Wenn überhaupt:** einen Vorwärtstest ab 10/2026 vorregistrieren, nur für genau diese
eine Konfiguration (1h-Absorption, Ziel am VA-Rand, keine Ort-/Umfeld-Filter, Long und
Short), auf Papier und ohne Geld. Auswertung nach 100 Trades, was bei rund 34 Trades pro
Jahr etwa 3 Jahre dauert.

## Gesamtfazit Orderflow-4-Schritte

| Frage | Antwort aus den Daten |
|---|---|
| Liefert das Framework aus dem Video auf BTC-Perps einen Edge? | Nicht nachweisbar. Wo genug Trades zusammenkommen (Variante B), verliert es nach Kosten klar |
| Bringt „Ort“ (Discount/Premium) etwas? | Nein, in keinem Lauf |
| Bringt „Umfeld“ (Regime, Struktur, Funding) etwas? | Kein belastbarer Hinweis. Es reduziert vor allem die Zahl der Trades |
| Ist Taker-Delta pro Kerze ein guter Absorptions-Ersatz? | Offen. Mit echten Footprint-Daten könnte es anders aussehen |
| Nebenprodukt | Lookahead in `market_features.structure_trend` gefunden und behoben (`STRUCTURE-TREND-KAUSAL_2026-10-14.md`) |

## Rohberichte


### b_long

Commit: `c62c0847ef82a5206a85f340bf64d3925e7c8766` · Richtung: **long** · Ziel-1-Modus: **va_edge**

1h-Struktur: 36022 Kerzen verglichen. Port des Originals vs. gespeichert: 100.0% (bestätigt den Port). Übereinstimmung kausal vs. gespeichert: 87.8%. Kausal um 5 Kerzen vorgezogen vs. gespeichert: 87.6%.

#### Bestätigungsprobe

##### Gesamt 10/2022–09/2026

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 562 | 273 | 28.9% | -0.288 | -78.49 | -0.0537 | 80.74 | 25% |
| V2 | 436 | 252 | 27.4% | -0.311 | -78.35 | -0.0536 | 80.60 | 25% |
| V3 | 102 | 46 | 21.7% | -0.690 | -31.75 | -0.0217 | 30.51 | 19% |
| V4 | 102 | 45 | 22.2% | -0.673 | -30.29 | -0.0207 | 29.05 | 19% |

V0 (Zufall, 1000 Läufe): R je Tag Mittel -0.2588, 5–95 %: -0.3390 bis -0.1694

Ausstiegsgründe V4: {'stop': 35, 't1_then_breakeven': 4, 'timeout': 2, 't1_then_t2': 2, 't1_full': 1, 't1_then_timeout': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_EXPANSION_BULLISH': {'count': 23, 'mean': -0.862}, 'TREND_FORMING_BULLISH': {'count': 5, 'mean': 0.275}, 'UNRESOLVED_NEUTRAL': {'count': 7, 'mean': -0.926}, 'VOLA_SQUEEZE_RANGING': {'count': 10, 'mean': -0.537}}

| hypothese   | vergleich   |   differenz_r_je_tag |   ci_unten |   ci_oben |      p |   n_trades_min |   p_holm | entscheid         |
|:------------|:------------|---------------------:|-----------:|----------:|-------:|---------------:|---------:|:------------------|
| H1          | V4 > 0      |              -0.0207 |    -0.0314 |   -0.0081 | 1.0000 |             45 |   1.0000 | INSUFFICIENT_DATA |
| H2          | V1 > V0     |               0.2051 |   nan      |  nan      | 0.0010 |            273 |   0.0050 | bestaetigt        |
| H3          | V2 > V1     |               0.0001 |    -0.0115 |    0.0109 | 0.5012 |            252 |   1.0000 | nicht bestaetigt  |
| H4          | V3 > V2     |               0.0319 |    -0.0023 |    0.0642 | 0.0262 |             46 |   0.1048 | INSUFFICIENT_DATA |
| H5          | V4 > V3     |               0.0010 |     0.0000 |    0.0030 | 0.2619 |             45 |   0.7857 | INSUFFICIENT_DATA |

#### Zeitabschnitte (beschreibend)

##### train

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 292 | 123 | 30.9% | -0.341 | -41.93 | -0.0574 | 44.17 | 12% |
| V2 | 225 | 109 | 29.4% | -0.381 | -41.56 | -0.0568 | 43.80 | 12% |
| V3 | 59 | 23 | 13.0% | -0.989 | -22.75 | -0.0311 | 21.51 | 6% |
| V4 | 59 | 22 | 13.6% | -0.968 | -21.30 | -0.0291 | 20.06 | 6% |

Ausstiegsgründe V4: {'stop': 19, 't1_then_breakeven': 2, 't1_full': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_EXPANSION_BULLISH': {'count': 11, 'mean': -1.036}, 'TREND_FORMING_BULLISH': {'count': 1, 'mean': -1.322}, 'UNRESOLVED_NEUTRAL': {'count': 3, 'mean': -1.243}, 'VOLA_SQUEEZE_RANGING': {'count': 7, 'mean': -0.692}}

##### validation

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 133 | 71 | 31.0% | -0.177 | -12.59 | -0.0345 | 18.38 | 42% |
| V2 | 96 | 65 | 29.2% | -0.166 | -10.80 | -0.0296 | 16.86 | 42% |
| V3 | 23 | 12 | 41.7% | +0.090 | +1.08 | +0.0030 | 5.06 | 50% |
| V4 | 23 | 12 | 41.7% | +0.090 | +1.08 | +0.0030 | 5.06 | 50% |

Ausstiegsgründe V4: {'stop': 7, 't1_then_t2': 2, 't1_then_timeout': 1, 'timeout': 1, 't1_then_breakeven': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_EXPANSION_BULLISH': {'count': 5, 'mean': -0.333}, 'TREND_FORMING_BULLISH': {'count': 2, 'mean': 1.686}, 'UNRESOLVED_NEUTRAL': {'count': 4, 'mean': -0.687}, 'VOLA_SQUEEZE_RANGING': {'count': 1, 'mean': 2.117}}

##### test

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 137 | 79 | 24.1% | -0.303 | -23.97 | -0.0657 | 30.42 | 33% |
| V2 | 115 | 78 | 23.1% | -0.333 | -26.00 | -0.0712 | 32.44 | 33% |
| V3 | 20 | 11 | 18.2% | -0.916 | -10.07 | -0.0276 | 8.79 | 14% |
| V4 | 20 | 11 | 18.2% | -0.916 | -10.07 | -0.0276 | 8.79 | 14% |

Ausstiegsgründe V4: {'stop': 9, 't1_then_breakeven': 1, 'timeout': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_EXPANSION_BULLISH': {'count': 7, 'mean': -0.965}, 'TREND_FORMING_BULLISH': {'count': 2, 'mean': -0.338}, 'VOLA_SQUEEZE_RANGING': {'count': 2, 'mean': -1.321}}

#### Sensitivität V4 (Gesamtprobe, beschreibend)

|   delta_z |   sigma |   lookback |   trades |   r_je_tag |   r_summe |
|----------:|--------:|-----------:|---------:|-----------:|----------:|
|   -1.0000 |  0.2500 |     5.0000 |  45.0000 |    -0.0207 |  -30.2944 |
|   -1.0000 |  0.2500 |     8.0000 |  43.0000 |    -0.0189 |  -27.6387 |
|   -1.0000 |  0.2500 |    12.0000 |  42.0000 |    -0.0192 |  -28.0494 |
|   -1.0000 |  0.5000 |     5.0000 |  45.0000 |    -0.0207 |  -30.2944 |
|   -1.0000 |  0.5000 |     8.0000 |  43.0000 |    -0.0189 |  -27.6387 |
|   -1.0000 |  0.5000 |    12.0000 |  42.0000 |    -0.0192 |  -28.0494 |
|   -1.0000 |  0.7500 |     5.0000 |  44.0000 |    -0.0219 |  -31.9644 |
|   -1.0000 |  0.7500 |     8.0000 |  42.0000 |    -0.0201 |  -29.3087 |
|   -1.0000 |  0.7500 |    12.0000 |  41.0000 |    -0.0203 |  -29.7194 |
|   -1.5000 |  0.2500 |     5.0000 |  18.0000 |    -0.0038 |   -5.5610 |
|   -1.5000 |  0.2500 |     8.0000 |  17.0000 |    -0.0030 |   -4.3612 |
|   -1.5000 |  0.2500 |    12.0000 |  16.0000 |    -0.0033 |   -4.7720 |
|   -1.5000 |  0.5000 |     5.0000 |  18.0000 |    -0.0038 |   -5.5610 |
|   -1.5000 |  0.5000 |     8.0000 |  17.0000 |    -0.0030 |   -4.3612 |
|   -1.5000 |  0.5000 |    12.0000 |  16.0000 |    -0.0033 |   -4.7720 |
|   -1.5000 |  0.7500 |     5.0000 |  18.0000 |    -0.0038 |   -5.5610 |
|   -1.5000 |  0.7500 |     8.0000 |  17.0000 |    -0.0030 |   -4.3612 |
|   -1.5000 |  0.7500 |    12.0000 |  16.0000 |    -0.0033 |   -4.7720 |
|   -2.0000 |  0.2500 |     5.0000 |  12.0000 |    -0.0012 |   -1.8200 |
|   -2.0000 |  0.2500 |     8.0000 |  11.0000 |    -0.0004 |   -0.6203 |
|   -2.0000 |  0.2500 |    12.0000 |  10.0000 |    -0.0007 |   -1.0310 |
|   -2.0000 |  0.5000 |     5.0000 |  12.0000 |    -0.0012 |   -1.8200 |
|   -2.0000 |  0.5000 |     8.0000 |  11.0000 |    -0.0004 |   -0.6203 |
|   -2.0000 |  0.5000 |    12.0000 |  10.0000 |    -0.0007 |   -1.0310 |
|   -2.0000 |  0.7500 |     5.0000 |  12.0000 |    -0.0012 |   -1.8200 |
|   -2.0000 |  0.7500 |     8.0000 |  11.0000 |    -0.0004 |   -0.6203 |
|   -2.0000 |  0.7500 |    12.0000 |  10.0000 |    -0.0007 |   -1.0310 |

PBO (CSCV, 8 Gruppen): 0.2

### b_short

Commit: `59e0a3c29e68a138b2d474de791417e7edaaa88e` · Richtung: **short** · Ziel-1-Modus: **va_edge** · Zeitrahmen: **15m**

1h-Struktur: 36022 Kerzen verglichen. Port des Originals vs. gespeichert: 100.0% (bestätigt den Port). Übereinstimmung kausal vs. gespeichert: 87.8%. Kausal um 5 Kerzen vorgezogen vs. gespeichert: 87.6%.

#### Bestätigungsprobe

##### Gesamt 10/2022–09/2026

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 489 | 250 | 30.0% | -0.223 | -55.69 | -0.0381 | 67.72 | 38% |
| V2 | 390 | 236 | 29.7% | -0.224 | -52.98 | -0.0363 | 65.02 | 38% |
| V3 | 70 | 32 | 31.2% | -0.148 | -4.74 | -0.0032 | 8.37 | 39% |
| V4 | 70 | 30 | 30.0% | -0.270 | -8.11 | -0.0055 | 11.73 | 35% |

V0 (Zufall, 1000 Läufe): R je Tag Mittel -0.2501, 5–95 %: -0.3298 bis -0.1714

Ausstiegsgründe V4: {'stop': 19, 't1_then_timeout': 3, 't1_then_t2': 3, 'timeout': 3, 't1_then_breakeven': 2}

V4 je 4h-Regime (Anzahl, mittleres R): {'HIGH_VOLA_REVERSION': {'count': 1, 'mean': 3.53}, 'TREND_EXPANSION_BEARISH': {'count': 11, 'mean': -0.933}, 'TREND_FORMING_BEARISH': {'count': 3, 'mean': -0.152}, 'UNRESOLVED_NEUTRAL': {'count': 4, 'mean': -0.378}, 'VOLA_SQUEEZE_RANGING': {'count': 11, 'mean': 0.053}}

| hypothese   | vergleich   |   differenz_r_je_tag |   ci_unten |   ci_oben |      p |   n_trades_min |   p_holm | entscheid         |
|:------------|:------------|---------------------:|-----------:|----------:|-------:|---------------:|---------:|:------------------|
| H1          | V4 > 0      |              -0.0055 |    -0.0182 |    0.0067 | 0.7822 |             30 |   1.0000 | INSUFFICIENT_DATA |
| H2          | V1 > V0     |               0.2120 |   nan      |  nan      | 0.0010 |            250 |   0.0050 | bestaetigt        |
| H3          | V2 > V1     |               0.0019 |    -0.0069 |    0.0093 | 0.2857 |            236 |   0.8571 | nicht bestaetigt  |
| H4          | V3 > V2     |               0.0330 |    -0.0017 |    0.0699 | 0.0391 |             32 |   0.1564 | INSUFFICIENT_DATA |
| H5          | V4 > V3     |              -0.0023 |    -0.0097 |    0.0028 | 0.7755 |             30 |   1.0000 | INSUFFICIENT_DATA |

#### Zeitabschnitte (beschreibend)

##### train

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 245 | 115 | 33.9% | -0.011 | -1.22 | -0.0017 | 15.06 | 46% |
| V2 | 208 | 111 | 33.3% | -0.026 | -2.90 | -0.0040 | 16.74 | 46% |
| V3 | 39 | 18 | 33.3% | -0.114 | -2.04 | -0.0028 | 7.87 | 43% |
| V4 | 39 | 17 | 35.3% | -0.040 | -0.69 | -0.0009 | 6.51 | 43% |

Ausstiegsgründe V4: {'stop': 10, 't1_then_t2': 3, 't1_then_timeout': 2, 'timeout': 1, 't1_then_breakeven': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_EXPANSION_BEARISH': {'count': 6, 'mean': -1.228}, 'TREND_FORMING_BEARISH': {'count': 1, 'mean': 2.069}, 'UNRESOLVED_NEUTRAL': {'count': 3, 'mean': -0.104}, 'VOLA_SQUEEZE_RANGING': {'count': 7, 'mean': 0.703}}

##### validation

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 100 | 49 | 26.5% | -0.442 | -21.65 | -0.0593 | 24.36 | 25% |
| V2 | 74 | 47 | 25.5% | -0.469 | -22.06 | -0.0604 | 24.78 | 25% |
| V3 | 9 | 5 | 40.0% | +0.779 | +3.90 | +0.0107 | 2.96 | 67% |
| V4 | 9 | 4 | 25.0% | -0.206 | -0.83 | -0.0023 | 4.35 | 33% |

Ausstiegsgründe V4: {'stop': 3, 't1_then_timeout': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'HIGH_VOLA_REVERSION': {'count': 1, 'mean': 3.53}, 'VOLA_SQUEEZE_RANGING': {'count': 3, 'mean': -1.452}}

##### test

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 144 | 86 | 26.7% | -0.382 | -32.82 | -0.0899 | 47.87 | 33% |
| V2 | 108 | 78 | 26.9% | -0.359 | -28.02 | -0.0768 | 41.99 | 33% |
| V3 | 22 | 9 | 22.2% | -0.733 | -6.60 | -0.0181 | 6.50 | 17% |
| V4 | 22 | 9 | 22.2% | -0.733 | -6.60 | -0.0181 | 6.50 | 17% |

Ausstiegsgründe V4: {'stop': 6, 'timeout': 2, 't1_then_breakeven': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_EXPANSION_BEARISH': {'count': 5, 'mean': -0.578}, 'TREND_FORMING_BEARISH': {'count': 2, 'mean': -1.263}, 'UNRESOLVED_NEUTRAL': {'count': 1, 'mean': -1.198}, 'VOLA_SQUEEZE_RANGING': {'count': 1, 'mean': 0.019}}

#### Long + Short V4 kombiniert (beschreibend)

Long-V4 neu gerechnet: 45 Trades, identisch mit dem Long-Lauf.
Kombiniert: 75 Trades, R je Tag -0.0263 (95 %-KI -0.0425 bis -0.0090), einseitiges p 0.9993, R Summe -38.40.

#### Sensitivität V4 (Gesamtprobe, beschreibend)

|   delta_z |   sigma |   lookback |   trades |   r_je_tag |   r_summe |
|----------:|--------:|-----------:|---------:|-----------:|----------:|
|   -1.0000 |  0.2500 |     5.0000 |  33.0000 |    -0.0083 |  -12.0954 |
|   -1.0000 |  0.2500 |     8.0000 |  32.0000 |    -0.0075 |  -10.9435 |
|   -1.0000 |  0.2500 |    12.0000 |  31.0000 |    -0.0089 |  -13.0126 |
|   -1.0000 |  0.5000 |     5.0000 |  30.0000 |    -0.0055 |   -8.1083 |
|   -1.0000 |  0.5000 |     8.0000 |  29.0000 |    -0.0048 |   -6.9565 |
|   -1.0000 |  0.5000 |    12.0000 |  28.0000 |    -0.0062 |   -9.0255 |
|   -1.0000 |  0.7500 |     5.0000 |  30.0000 |    -0.0055 |   -8.1083 |
|   -1.0000 |  0.7500 |     8.0000 |  29.0000 |    -0.0048 |   -6.9565 |
|   -1.0000 |  0.7500 |    12.0000 |  28.0000 |    -0.0062 |   -9.0255 |
|   -1.5000 |  0.2500 |     5.0000 |   9.0000 |     0.0020 |    2.8806 |
|   -1.5000 |  0.2500 |     8.0000 |   8.0000 |     0.0028 |    4.0325 |
|   -1.5000 |  0.2500 |    12.0000 |   8.0000 |     0.0028 |    4.0325 |
|   -1.5000 |  0.5000 |     5.0000 |   9.0000 |     0.0020 |    2.8806 |
|   -1.5000 |  0.5000 |     8.0000 |   8.0000 |     0.0028 |    4.0325 |
|   -1.5000 |  0.5000 |    12.0000 |   8.0000 |     0.0028 |    4.0325 |
|   -1.5000 |  0.7500 |     5.0000 |   9.0000 |     0.0020 |    2.8806 |
|   -1.5000 |  0.7500 |     8.0000 |   8.0000 |     0.0028 |    4.0325 |
|   -1.5000 |  0.7500 |    12.0000 |   8.0000 |     0.0028 |    4.0325 |
|   -2.0000 |  0.2500 |     5.0000 |   5.0000 |     0.0021 |    3.1122 |
|   -2.0000 |  0.2500 |     8.0000 |   4.0000 |     0.0029 |    4.2640 |
|   -2.0000 |  0.2500 |    12.0000 |   4.0000 |     0.0029 |    4.2640 |
|   -2.0000 |  0.5000 |     5.0000 |   5.0000 |     0.0021 |    3.1122 |
|   -2.0000 |  0.5000 |     8.0000 |   4.0000 |     0.0029 |    4.2640 |
|   -2.0000 |  0.5000 |    12.0000 |   4.0000 |     0.0029 |    4.2640 |
|   -2.0000 |  0.7500 |     5.0000 |   5.0000 |     0.0021 |    3.1122 |
|   -2.0000 |  0.7500 |     8.0000 |   4.0000 |     0.0029 |    4.2640 |
|   -2.0000 |  0.7500 |    12.0000 |   4.0000 |     0.0029 |    4.2640 |

PBO (CSCV, 8 Gruppen): 1.0

### c1_long

Commit: `96b90a966bc8d648a71930e963d3cce9a558cf09` · Richtung: **long** · Ziel-1-Modus: **vwap_poc** · Zeitrahmen: **1h**



#### Bestätigungsprobe

##### Gesamt 10/2022–09/2026

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 131 | 23 | 34.8% | +0.010 | +0.23 | +0.0002 | 6.53 | 44% |
| V2 | 105 | 22 | 31.8% | -0.028 | -0.62 | -0.0004 | 7.38 | 40% |
| V3 | 20 | 0 | – | – | – | – | – | – |
| V4 | 20 | 0 | – | – | – | – | – | – |

V0 (Zufall, 1000 Läufe): R je Tag Mittel -0.0143, 5–95 %: -0.0325 bis +0.0092

Ausstiegsgründe V4: {}

V4 je 4h-Regime (Anzahl, mittleres R): {}

| hypothese   | vergleich   |   differenz_r_je_tag |   ci_unten |   ci_oben |      p |   n_trades_min |   p_holm | entscheid         |
|:------------|:------------|---------------------:|-----------:|----------:|-------:|---------------:|---------:|:------------------|
| H1          | V4 > 0      |               0.0000 |     0.0000 |    0.0000 | 1.0000 |              0 |   1.0000 | INSUFFICIENT_DATA |
| H2          | V1 > V0     |               0.0145 |   nan      |  nan      | 0.1279 |             23 |   0.6394 | INSUFFICIENT_DATA |
| H3          | V2 > V1     |              -0.0006 |    -0.0018 |    0.0000 | 0.9183 |             22 |   1.0000 | INSUFFICIENT_DATA |
| H4          | V3 > V2     |               0.0004 |    -0.0114 |    0.0110 | 0.4747 |              0 |   1.0000 | INSUFFICIENT_DATA |
| H5          | V4 > V3     |               0.0000 |     0.0000 |    0.0000 | 1.0000 |              0 |   1.0000 | INSUFFICIENT_DATA |

#### Zeitabschnitte (beschreibend)

##### train

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 68 | 9 | 33.3% | +0.004 | +0.03 | +0.0000 | 4.91 | 43% |
| V2 | 58 | 9 | 33.3% | +0.004 | +0.03 | +0.0000 | 4.91 | 43% |
| V3 | 15 | 0 | – | – | – | – | – | – |
| V4 | 15 | 0 | – | – | – | – | – | – |

Ausstiegsgründe V4: {}

V4 je 4h-Regime (Anzahl, mittleres R): {}

##### validation

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 31 | 3 | 33.3% | +0.002 | +0.00 | +0.0000 | 1.05 | 33% |
| V2 | 21 | 3 | 33.3% | +0.002 | +0.00 | +0.0000 | 1.05 | 33% |
| V3 | 2 | 0 | – | – | – | – | – | – |
| V4 | 2 | 0 | – | – | – | – | – | – |

Ausstiegsgründe V4: {}

V4 je 4h-Regime (Anzahl, mittleres R): {}

##### test

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 32 | 11 | 36.4% | +0.017 | +0.19 | +0.0005 | 5.92 | 50% |
| V2 | 26 | 10 | 30.0% | -0.066 | -0.66 | -0.0018 | 4.83 | 40% |
| V3 | 3 | 0 | – | – | – | – | – | – |
| V4 | 3 | 0 | – | – | – | – | – | – |

Ausstiegsgründe V4: {}

V4 je 4h-Regime (Anzahl, mittleres R): {}

#### Sensitivität V4 (Gesamtprobe, beschreibend)

|   delta_z |   sigma |   lookback |   trades |   r_je_tag |   r_summe |
|----------:|--------:|-----------:|---------:|-----------:|----------:|
|   -1.0000 |  0.2500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.0000 |  0.2500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.0000 |  0.2500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.0000 |  0.5000 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.0000 |  0.5000 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.0000 |  0.5000 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.0000 |  0.7500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.0000 |  0.7500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.0000 |  0.7500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.2500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.2500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.2500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.5000 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.5000 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.5000 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.7500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.7500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.7500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.2500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.2500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.2500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.5000 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.5000 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.5000 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.7500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.7500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.7500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |

PBO (CSCV, 8 Gruppen): 1.0

### c1_short

Commit: `7f6269b947228dd87b2d61506e00902b150ab05b` · Richtung: **short** · Ziel-1-Modus: **vwap_poc** · Zeitrahmen: **1h**



#### Bestätigungsprobe

##### Gesamt 10/2022–09/2026

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 99 | 21 | 42.9% | +0.377 | +7.91 | +0.0054 | 5.49 | 50% |
| V2 | 80 | 20 | 40.0% | +0.296 | +5.93 | +0.0041 | 5.49 | 47% |
| V3 | 19 | 2 | 50.0% | +1.297 | +2.59 | +0.0018 | 0.00 | 50% |
| V4 | 19 | 2 | 50.0% | +1.297 | +2.59 | +0.0018 | 0.00 | 50% |

V0 (Zufall, 1000 Läufe): R je Tag Mittel -0.0140, 5–95 %: -0.0313 bis +0.0091

Ausstiegsgründe V4: {'stop': 1, 't1_then_timeout': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_EXPANSION_BEARISH': {'count': 1, 'mean': -1.094}, 'UNRESOLVED_NEUTRAL': {'count': 1, 'mean': 3.688}}

| hypothese   | vergleich   |   differenz_r_je_tag |   ci_unten |   ci_oben |      p |   n_trades_min |   p_holm | entscheid         |
|:------------|:------------|---------------------:|-----------:|----------:|-------:|---------------:|---------:|:------------------|
| H1          | V4 > 0      |               0.0018 |    -0.0022 |    0.0076 | 0.2485 |              2 |   0.9940 | INSUFFICIENT_DATA |
| H2          | V1 > V0     |               0.0194 |   nan      |  nan      | 0.0799 |             21 |   0.3996 | INSUFFICIENT_DATA |
| H3          | V2 > V1     |              -0.0014 |    -0.0041 |    0.0000 | 0.9190 |             20 |   1.0000 | INSUFFICIENT_DATA |
| H4          | V3 > V2     |              -0.0023 |    -0.0131 |    0.0072 | 0.6858 |              2 |   1.0000 | INSUFFICIENT_DATA |
| H5          | V4 > V3     |               0.0000 |     0.0000 |    0.0000 | 1.0000 |              2 |   1.0000 | INSUFFICIENT_DATA |

#### Zeitabschnitte (beschreibend)

##### train

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 38 | 7 | 42.9% | +0.282 | +1.98 | +0.0027 | 2.17 | 33% |
| V2 | 28 | 6 | 33.3% | -0.002 | -0.01 | -0.0000 | 2.17 | 20% |
| V3 | 6 | 1 | 0.0% | -1.094 | -1.09 | -0.0015 | 0.00 | 0% |
| V4 | 6 | 1 | 0.0% | -1.094 | -1.09 | -0.0015 | 0.00 | 0% |

Ausstiegsgründe V4: {'stop': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_EXPANSION_BEARISH': {'count': 1, 'mean': -1.094}}

##### validation

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 24 | 4 | 25.0% | +0.083 | +0.33 | +0.0009 | 3.36 | 33% |
| V2 | 20 | 4 | 25.0% | +0.083 | +0.33 | +0.0009 | 3.36 | 33% |
| V3 | 5 | 1 | 100.0% | +3.688 | +3.69 | +0.0101 | 0.00 | 100% |
| V4 | 5 | 1 | 100.0% | +3.688 | +3.69 | +0.0101 | 0.00 | 100% |

Ausstiegsgründe V4: {'t1_then_timeout': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'UNRESOLVED_NEUTRAL': {'count': 1, 'mean': 3.688}}

##### test

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 37 | 10 | 50.0% | +0.561 | +5.61 | +0.0154 | 2.26 | 71% |
| V2 | 32 | 10 | 50.0% | +0.561 | +5.61 | +0.0154 | 2.26 | 71% |
| V3 | 8 | 0 | – | – | – | – | – | – |
| V4 | 8 | 0 | – | – | – | – | – | – |

Ausstiegsgründe V4: {}

V4 je 4h-Regime (Anzahl, mittleres R): {}

#### Long + Short V4 kombiniert (beschreibend)

Long-V4 neu gerechnet: 0 Trades, identisch mit dem Long-Lauf.
Kombiniert: 2 Trades, R je Tag +0.0018 (95 %-KI -0.0022 bis +0.0076), einseitiges p 0.2485, R Summe +2.59.

#### Sensitivität V4 (Gesamtprobe, beschreibend)

|   delta_z |   sigma |   lookback |   trades |   r_je_tag |   r_summe |
|----------:|--------:|-----------:|---------:|-----------:|----------:|
|   -1.0000 |  0.2500 |     5.0000 |   2.0000 |     0.0018 |    2.5943 |
|   -1.0000 |  0.2500 |     8.0000 |   2.0000 |     0.0018 |    2.5943 |
|   -1.0000 |  0.2500 |    12.0000 |   2.0000 |     0.0018 |    2.5943 |
|   -1.0000 |  0.5000 |     5.0000 |   2.0000 |     0.0018 |    2.5943 |
|   -1.0000 |  0.5000 |     8.0000 |   2.0000 |     0.0018 |    2.5943 |
|   -1.0000 |  0.5000 |    12.0000 |   2.0000 |     0.0018 |    2.5943 |
|   -1.0000 |  0.7500 |     5.0000 |   2.0000 |     0.0018 |    2.5943 |
|   -1.0000 |  0.7500 |     8.0000 |   2.0000 |     0.0018 |    2.5943 |
|   -1.0000 |  0.7500 |    12.0000 |   2.0000 |     0.0018 |    2.5943 |
|   -1.5000 |  0.2500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.2500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.2500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.5000 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.5000 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.5000 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.7500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.7500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.7500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.2500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.2500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.2500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.5000 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.5000 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.5000 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.7500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.7500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.7500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |

PBO (CSCV, 8 Gruppen): 0.7857142857142857

### c2_long

Commit: `24a95b116ac0cf71dac0f9e855cb627f5de3f380` · Richtung: **long** · Ziel-1-Modus: **va_edge** · Zeitrahmen: **1h**



#### Bestätigungsprobe

##### Gesamt 10/2022–09/2026

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 131 | 75 | 38.7% | +0.098 | +7.35 | +0.0050 | 11.69 | 56% |
| V2 | 105 | 69 | 37.7% | +0.072 | +4.99 | +0.0034 | 10.60 | 52% |
| V3 | 20 | 8 | 12.5% | -0.773 | -6.18 | -0.0042 | 5.13 | 14% |
| V4 | 20 | 8 | 12.5% | -0.773 | -6.18 | -0.0042 | 5.13 | 14% |

V0 (Zufall, 1000 Läufe): R je Tag Mittel -0.0256, 5–95 %: -0.0545 bis +0.0083

Ausstiegsgründe V4: {'stop': 7, 't1_then_timeout': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_EXPANSION_BULLISH': {'count': 4, 'mean': -0.429}, 'TREND_FORMING_BULLISH': {'count': 1, 'mean': -1.128}, 'UNRESOLVED_NEUTRAL': {'count': 3, 'mean': -1.112}}

| hypothese   | vergleich   |   differenz_r_je_tag |   ci_unten |   ci_oben |      p |   n_trades_min |   p_holm | entscheid         |
|:------------|:------------|---------------------:|-----------:|----------:|-------:|---------------:|---------:|:------------------|
| H1          | V4 > 0      |              -0.0042 |    -0.0083 |    0.0006 | 0.9815 |              8 |   1.0000 | INSUFFICIENT_DATA |
| H2          | V1 > V0     |               0.0307 |   nan      |  nan      | 0.0729 |             75 |   0.3646 | INSUFFICIENT_DATA |
| H3          | V2 > V1     |              -0.0016 |    -0.0075 |    0.0032 | 0.7372 |             69 |   1.0000 | INSUFFICIENT_DATA |
| H4          | V3 > V2     |              -0.0076 |    -0.0267 |    0.0102 | 0.7884 |              8 |   1.0000 | INSUFFICIENT_DATA |
| H5          | V4 > V3     |               0.0000 |     0.0000 |    0.0000 | 1.0000 |              8 |   1.0000 | INSUFFICIENT_DATA |

#### Zeitabschnitte (beschreibend)

##### train

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 68 | 39 | 38.5% | +0.076 | +2.96 | +0.0040 | 8.26 | 59% |
| V2 | 58 | 37 | 37.8% | +0.080 | +2.96 | +0.0040 | 7.13 | 53% |
| V3 | 15 | 6 | 16.7% | -0.643 | -3.86 | -0.0053 | 3.30 | 20% |
| V4 | 15 | 6 | 16.7% | -0.643 | -3.86 | -0.0053 | 3.30 | 20% |

Ausstiegsgründe V4: {'stop': 5, 't1_then_timeout': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_EXPANSION_BULLISH': {'count': 3, 'mean': -0.194}, 'TREND_FORMING_BULLISH': {'count': 1, 'mean': -1.128}, 'UNRESOLVED_NEUTRAL': {'count': 2, 'mean': -1.075}}

##### validation

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 31 | 16 | 50.0% | +0.456 | +7.30 | +0.0200 | 4.42 | 62% |
| V2 | 21 | 13 | 46.2% | +0.296 | +3.85 | +0.0106 | 3.49 | 50% |
| V3 | 2 | 1 | 0.0% | -1.186 | -1.19 | -0.0032 | 0.00 | 0% |
| V4 | 2 | 1 | 0.0% | -1.186 | -1.19 | -0.0032 | 0.00 | 0% |

Ausstiegsgründe V4: {'stop': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'UNRESOLVED_NEUTRAL': {'count': 1, 'mean': -1.186}}

##### test

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 32 | 20 | 30.0% | -0.145 | -2.90 | -0.0079 | 7.78 | 44% |
| V2 | 26 | 19 | 31.6% | -0.096 | -1.81 | -0.0050 | 7.78 | 50% |
| V3 | 3 | 1 | 0.0% | -1.136 | -1.14 | -0.0031 | 0.00 | 0% |
| V4 | 3 | 1 | 0.0% | -1.136 | -1.14 | -0.0031 | 0.00 | 0% |

Ausstiegsgründe V4: {'stop': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_EXPANSION_BULLISH': {'count': 1, 'mean': -1.136}}

#### Sensitivität V4 (Gesamtprobe, beschreibend)

|   delta_z |   sigma |   lookback |   trades |   r_je_tag |   r_summe |
|----------:|--------:|-----------:|---------:|-----------:|----------:|
|   -1.0000 |  0.2500 |     5.0000 |   9.0000 |    -0.0027 |   -3.9811 |
|   -1.0000 |  0.2500 |     8.0000 |   9.0000 |    -0.0027 |   -3.9811 |
|   -1.0000 |  0.2500 |    12.0000 |   9.0000 |    -0.0027 |   -3.9811 |
|   -1.0000 |  0.5000 |     5.0000 |   8.0000 |    -0.0042 |   -6.1817 |
|   -1.0000 |  0.5000 |     8.0000 |   8.0000 |    -0.0042 |   -6.1817 |
|   -1.0000 |  0.5000 |    12.0000 |   8.0000 |    -0.0042 |   -6.1817 |
|   -1.0000 |  0.7500 |     5.0000 |   8.0000 |    -0.0042 |   -6.1817 |
|   -1.0000 |  0.7500 |     8.0000 |   8.0000 |    -0.0042 |   -6.1817 |
|   -1.0000 |  0.7500 |    12.0000 |   8.0000 |    -0.0042 |   -6.1817 |
|   -1.5000 |  0.2500 |     5.0000 |   4.0000 |    -0.0030 |   -4.3273 |
|   -1.5000 |  0.2500 |     8.0000 |   4.0000 |    -0.0030 |   -4.3273 |
|   -1.5000 |  0.2500 |    12.0000 |   4.0000 |    -0.0030 |   -4.3273 |
|   -1.5000 |  0.5000 |     5.0000 |   4.0000 |    -0.0030 |   -4.3273 |
|   -1.5000 |  0.5000 |     8.0000 |   4.0000 |    -0.0030 |   -4.3273 |
|   -1.5000 |  0.5000 |    12.0000 |   4.0000 |    -0.0030 |   -4.3273 |
|   -1.5000 |  0.7500 |     5.0000 |   4.0000 |    -0.0030 |   -4.3273 |
|   -1.5000 |  0.7500 |     8.0000 |   4.0000 |    -0.0030 |   -4.3273 |
|   -1.5000 |  0.7500 |    12.0000 |   4.0000 |    -0.0030 |   -4.3273 |
|   -2.0000 |  0.2500 |     5.0000 |   1.0000 |    -0.0007 |   -1.0498 |
|   -2.0000 |  0.2500 |     8.0000 |   1.0000 |    -0.0007 |   -1.0498 |
|   -2.0000 |  0.2500 |    12.0000 |   1.0000 |    -0.0007 |   -1.0498 |
|   -2.0000 |  0.5000 |     5.0000 |   1.0000 |    -0.0007 |   -1.0498 |
|   -2.0000 |  0.5000 |     8.0000 |   1.0000 |    -0.0007 |   -1.0498 |
|   -2.0000 |  0.5000 |    12.0000 |   1.0000 |    -0.0007 |   -1.0498 |
|   -2.0000 |  0.7500 |     5.0000 |   1.0000 |    -0.0007 |   -1.0498 |
|   -2.0000 |  0.7500 |     8.0000 |   1.0000 |    -0.0007 |   -1.0498 |
|   -2.0000 |  0.7500 |    12.0000 |   1.0000 |    -0.0007 |   -1.0498 |

PBO (CSCV, 8 Gruppen): 0.44285714285714284

### c2_short

Commit: `677e5bb2a327c6ea9df5723b47adbb3b78dbf6b9` · Richtung: **short** · Ziel-1-Modus: **va_edge** · Zeitrahmen: **1h**



#### Bestätigungsprobe

##### Gesamt 10/2022–09/2026

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 99 | 61 | 36.1% | +0.446 | +27.18 | +0.0186 | 11.22 | 43% |
| V2 | 80 | 57 | 35.1% | +0.358 | +20.41 | +0.0140 | 11.22 | 42% |
| V3 | 19 | 6 | 33.3% | +0.091 | +0.54 | +0.0004 | 2.21 | 33% |
| V4 | 19 | 6 | 33.3% | +0.091 | +0.54 | +0.0004 | 2.21 | 33% |

V0 (Zufall, 1000 Läufe): R je Tag Mittel -0.0193, 5–95 %: -0.0479 bis +0.0193

Ausstiegsgründe V4: {'stop': 4, 't1_then_t2': 2}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_EXPANSION_BEARISH': {'count': 2, 'mean': -1.089}, 'UNRESOLVED_NEUTRAL': {'count': 3, 'mean': 1.325}, 'VOLA_SQUEEZE_RANGING': {'count': 1, 'mean': -1.253}}

| hypothese   | vergleich   |   differenz_r_je_tag |   ci_unten |   ci_oben |      p |   n_trades_min |   p_holm | entscheid         |
|:------------|:------------|---------------------:|-----------:|----------:|-------:|---------------:|---------:|:------------------|
| H1          | V4 > 0      |               0.0004 |    -0.0049 |    0.0065 | 0.4245 |              6 |   1.0000 | INSUFFICIENT_DATA |
| H2          | V1 > V0     |               0.0379 |   nan      |  nan      | 0.0539 |             61 |   0.2697 | INSUFFICIENT_DATA |
| H3          | V2 > V1     |              -0.0046 |    -0.0169 |    0.0029 | 0.7978 |             57 |   1.0000 | INSUFFICIENT_DATA |
| H4          | V3 > V2     |              -0.0136 |    -0.0384 |    0.0073 | 0.8695 |              6 |   1.0000 | INSUFFICIENT_DATA |
| H5          | V4 > V3     |               0.0000 |     0.0000 |    0.0000 | 1.0000 |              6 |   1.0000 | INSUFFICIENT_DATA |

#### Zeitabschnitte (beschreibend)

##### train

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 38 | 22 | 31.8% | +0.096 | +2.11 | +0.0029 | 5.61 | 31% |
| V2 | 28 | 20 | 30.0% | +0.088 | +1.76 | +0.0024 | 5.61 | 29% |
| V3 | 6 | 2 | 0.0% | -1.174 | -2.35 | -0.0032 | 1.25 | 0% |
| V4 | 6 | 2 | 0.0% | -1.174 | -2.35 | -0.0032 | 1.25 | 0% |

Ausstiegsgründe V4: {'stop': 2}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_EXPANSION_BEARISH': {'count': 1, 'mean': -1.094}, 'VOLA_SQUEEZE_RANGING': {'count': 1, 'mean': -1.253}}

##### validation

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 24 | 16 | 31.2% | +0.388 | +6.21 | +0.0170 | 9.08 | 33% |
| V2 | 20 | 16 | 31.2% | +0.388 | +6.21 | +0.0170 | 9.08 | 33% |
| V3 | 5 | 2 | 50.0% | +0.729 | +1.46 | +0.0040 | 1.12 | 50% |
| V4 | 5 | 2 | 50.0% | +0.729 | +1.46 | +0.0040 | 1.12 | 50% |

Ausstiegsgründe V4: {'t1_then_t2': 1, 'stop': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'UNRESOLVED_NEUTRAL': {'count': 2, 'mean': 0.729}}

##### test

| Variante | Signale | Trades | Trefferquote | R je Trade | R Summe | R je Tag | Max-DD (R) | profitable Monate |
|---|---|---|---|---|---|---|---|---|
| V1 | 37 | 23 | 43.5% | +0.820 | +18.85 | +0.0517 | 6.18 | 70% |
| V2 | 32 | 21 | 42.9% | +0.593 | +12.44 | +0.0341 | 6.18 | 70% |
| V3 | 8 | 2 | 50.0% | +0.717 | +1.43 | +0.0039 | 0.00 | 50% |
| V4 | 8 | 2 | 50.0% | +0.717 | +1.43 | +0.0039 | 0.00 | 50% |

Ausstiegsgründe V4: {'stop': 1, 't1_then_t2': 1}

V4 je 4h-Regime (Anzahl, mittleres R): {'TREND_EXPANSION_BEARISH': {'count': 1, 'mean': -1.084}, 'UNRESOLVED_NEUTRAL': {'count': 1, 'mean': 2.517}}

#### Long + Short V4 kombiniert (beschreibend)

Long-V4 neu gerechnet: 8 Trades, identisch mit dem Long-Lauf.
Kombiniert: 14 Trades, R je Tag -0.0039 (95 %-KI -0.0103 bis +0.0037), einseitiges p 0.8857, R Summe -5.64.

#### Sensitivität V4 (Gesamtprobe, beschreibend)

|   delta_z |   sigma |   lookback |   trades |   r_je_tag |   r_summe |
|----------:|--------:|-----------:|---------:|-----------:|----------:|
|   -1.0000 |  0.2500 |     5.0000 |   6.0000 |     0.0004 |    0.5445 |
|   -1.0000 |  0.2500 |     8.0000 |   6.0000 |     0.0004 |    0.5445 |
|   -1.0000 |  0.2500 |    12.0000 |   6.0000 |     0.0004 |    0.5445 |
|   -1.0000 |  0.5000 |     5.0000 |   6.0000 |     0.0004 |    0.5445 |
|   -1.0000 |  0.5000 |     8.0000 |   6.0000 |     0.0004 |    0.5445 |
|   -1.0000 |  0.5000 |    12.0000 |   6.0000 |     0.0004 |    0.5445 |
|   -1.0000 |  0.7500 |     5.0000 |   6.0000 |     0.0004 |    0.5445 |
|   -1.0000 |  0.7500 |     8.0000 |   6.0000 |     0.0004 |    0.5445 |
|   -1.0000 |  0.7500 |    12.0000 |   6.0000 |     0.0004 |    0.5445 |
|   -1.5000 |  0.2500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.2500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.2500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.5000 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.5000 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.5000 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.7500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.7500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -1.5000 |  0.7500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.2500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.2500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.2500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.5000 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.5000 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.5000 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.7500 |     5.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.7500 |     8.0000 |   0.0000 |     0.0000 |    0.0000 |
|   -2.0000 |  0.7500 |    12.0000 |   0.0000 |     0.0000 |    0.0000 |

PBO (CSCV, 8 Gruppen): 0.6571428571428571
