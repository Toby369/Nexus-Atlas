# Push-Qualität: Marktaussagen bei 1–4 h (15.11.2026)

Frage: Wie tragfähig sind die Marktaussagen-Pushes (`pattern`, `state_change`, `entry_filter`)
bei einem Horizont von 1–4 Stunden? Nur lesende Abfragen, nichts in der Datenbank verändert.

## Methode

- **Ereignisse:** Neueintritt eines Musters bzw. Wechsel des Gesamtzustands in `market_states`
  (Vorzeile hatte es nicht), Mindestabstand 4 h je Name. Push kommt ca. 3 min nach dem Zustand.
- **Einstieg:** Schlusskurs der letzten abgeschlossenen 15-m-Kerze (BTCUSDT, Binance) vor dem Zeitstempel.
- **Ergebnis:** Log-Rendite nach 1, 2, 4 h in Basispunkten (bps), Trefferquote in Pushrichtung.
- **Vergleich:** alle Zeitpunkte desselben Zeitraums (Baseline). Richtung der Muster laut `lib/patternDirection.ts`.
- **Streuung:** Rendite-Standardabweichung seit 26.08.: ±40 bps (1 h), ±78 bps (4 h).

## Ergebnis A: reale Zeit seit 26.08.2026 (market_states, 7.794 Zeilen)

| Signal (Erwartung) | Ereignisse | Treffer 1 h / 2 h / 4 h | Ø bps 1 h / 4 h |
|---|---|---|---|
| Bullish Confirmation (↑) | 40 | 58 / 53 / 56 % | +8,8 / +0,9 |
| Fragile Bullish (↓) | 100 | 57 / 52 / 46 % | −0,1 / −0,4 |
| Distribution Warning (↓) | 18 | 61 / 61 / 56 % | +3,1 / +1,8 |
| Capitulation (↓) | 5 | 80 / 80 / 60 % | −30 / +5 |
| Short Squeeze (↑) | 10 | 70 / 60 / 40 % | +15 / +29 |
| Zustand → Bärisch (↓) | 93 | 46 / 52 / 48 % | −3,2 / −8,7 |
| Zustand → Bullisch (↑) | 104 | 51 / 49 / 51 % | +3,4 / −2,2 |
| Baseline | 7.830 | 50 % ↑ | −0,9 / −3,8 |

Messfehler der Ø-Rendite bei n=40: ca. ±6 bps (1 h), ±12 bps (4 h). Fast alle Werte liegen darin.

## Ergebnis B: Fragile Bullish über 4 Jahre (market_features, 1 h, seit 09/2022)

Regel nachgebaut: `structure_trend = bullish` und `cvd_trend = falling`.
Diese beiden Faktoren liegen seit 2022 vor. Der OI-Faktor nur für ca. 1.600 h,
deshalb ist Bullish Confirmation nicht über lange Zeit nachrechenbar.

| Jahr | Ereignisse | Treffer ↓ 1 h / 2 h / 4 h | Ø bps 4 h |
|---|---|---|---|
| 2022 | 127 | 43 / 46 / 57 % | −0,9 |
| 2023 | 454 | 44 / 47 / 50 % | +2,0 |
| 2024 | 492 | 47 / 51 / 48 % | +1,3 |
| 2025 | 458 | 47 / 48 / 52 % | −2,3 |
| 2026 | 367 | 55 / 51 / 51 % | −7,1 |
| **Alle** | **1.898** | **47 / 49 / 51 %** | **−1,1 (±2,1)** |
| Baseline | 36.807 | 49 % ↓ | +1,3 (±0,5) |

Nach 1 h fällt der Kurs sogar seltener als sonst (47 % statt 49 %). Der Unterschied zur Baseline nach 4 h
beträgt −2,4 bps bei einem Messfehler von ca. ±2,2: kein belastbarer Effekt.

## Ergebnis C: Fragile Bullish nach Marktphase (16.11.2026)

Regime je Stunde aus `market_state_matrix` (1 h), zu vier Gruppen zusammengefasst. Gleiche 1.898 Ereignisse
wie in B, jeweils gegen die Baseline derselben Marktphase.

| Marktphase | Ereignisse | Treffer ↓ 1 h / 2 h / 4 h | Baseline ↓ 4 h | Ø bps 4 h (Baseline) |
|---|---|---|---|---|
| Trend bullisch | 846 | 49 / 51 / 51 % | 52 % | −1,3 (+2,9) |
| Range / Squeeze | 617 | 48 / 48 / 51 % | 49 % | −1,7 (+0,4) |
| Hohe Vola / unklar | 264 | 43 / 47 / 47 % | 48 % | +5,6 (+2,6) |
| Trend bärisch | 172 | 43 / 48 / 50 % | 47 % | −8,4 (+0,1) |

In keiner Marktphase liegt die Trefferquote nennenswert über der Baseline (Unterschied höchstens 3 Prozentpunkte).
Der größte Ausschlag (Trend bärisch, −8,4 bps nach 4 h) liegt bei einem Messfehler von ca. ±6,8 bps bei rund
1,2 Standardabweichungen und damit im Bereich des Zufalls. Bei vier Gruppen wäre so ein Wert auch ohne Effekt zu erwarten.
**Fragile Bullish ist also auch nicht in einer bestimmten Marktphase brauchbar.**

## Befunde

1. **Fragile Bullish hat keinen Vorhersagewert** bei 1–4 h. 1.898 Ereignisse über 4 Jahre, Trefferquote ≈ Münzwurf.
   Es ist mit 23 von 50 Muster-Pushes die größte Rauschquelle.
2. **Bullish Confirmation:** leichte Tendenz nach oben (58 % nach 1 h), aber n=40, nach 4 h verpufft.
   Weder bestätigt noch widerlegt.
3. **Zustandswechsel (Bullisch/Bärisch):** kein Unterschied zur Baseline.
4. **Distribution Warning, Capitulation, Short Squeeze:** n=18 / 5 / 10, keine Aussage möglich.
   Short Squeeze feuert seit 06.10. nicht mehr.

## Grenzen / nicht geprüft

- Einstiegsfilter: nur 9 Pushes, nicht ausgewertet.
- Marktphasen-Aufteilung nur für Fragile Bullish gemacht (Ergebnis C); für die übrigen Muster sind die Stichproben zu klein.
- Zeitraum der echten Pushes nur ca. 4 Wochen, der Markt seitwärts bis leicht abwärts.
- Ereignisse aus `market_states`, nicht aus den exakten Push-Zeitstempeln (Versatz ca. 3 min, für 1–4 h unerheblich).
- Keine Kosten, kein Handelsansatz bewertet. Auswertung beschreibt nur, ob die Richtung stimmt.

## Empfehlungen (zur Entscheidung durch Toby)

1. Fragile Bullish nicht mehr als Push senden, als stille Anzeige im Lagebild behalten.
2. Bullish Confirmation beibehalten und weiter beobachten, bis ca. 150 Ereignisse vorliegen.
3. Zustandswechsel-Pushes als reine Information einstufen (Zustandsbeschreibung, keine Prognose).
4. Den OI-Faktor länger historisieren (nur 1.600 h), um Bullish Confirmation sauber prüfen zu können.
