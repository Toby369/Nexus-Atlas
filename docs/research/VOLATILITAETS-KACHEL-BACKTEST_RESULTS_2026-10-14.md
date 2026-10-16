# Volatilitäts-Kachel — Backtest-Ergebnisse (14.10.2026)

Protokoll: `VOLATILITAETS-KACHEL-BACKTEST_PROTOCOL_2026-10-14.md` (Commit `369e047`,
vor jedem Ergebnis). Code und Daten: `research-python/vol_tile_backtest/` (Commit
`3fcfe81`, einmaliger Lauf). Zeitraum **05.09.2022 – 13.10.2026**, 1'500 Tage mit DVOL
und Kurs.

## Kurzfassung

| Aussage der Kachel | Ergebnis | Folge |
|---|---|---|
| Spanne enthält den Kurs in rund 68 % der Fälle | **Nach 1 Tag 80 %, nach 7 Tagen 78 %** (beides signifikant), nach 30 Tagen 72 % (nicht signifikant) | Historische Quote je Zeitraum in der Kachel angezeigt |
| „Sehr ruhig – auf tiefe Volatilität folgt oft eine Ausdehnung“ | **Nicht bestätigt** | Erwartungsaussage gestrichen |
| „Optionen teuer – erwartet wird mehr Bewegung als zuletzt“ (IV − RV > +10) | **Bestätigt**: Danach war die Bewegung deutlich grösser | bleibt, Info-Text nennt die Messung |
| „Optionen billig – der Kurs bewegt sich mehr als eingepreist“ (IV − RV < −5) | **Widerlegt**: Danach war die Bewegung im Mittel 5 Punkte *kleiner* als eingepreist | neutral formuliert: „Optionen billiger als die Bewegung der letzten 30 Tage“ |
| Skew-Pfeil | nicht testbar (keine historischen Daten) | wird seit 14.10.2026 gesammelt, siehe `SKEW-PFEIL-VORWAERTSTEST.md` |

## Ergebnisse im Detail

| Hypothese | Messwert | 95 %-KI | p (Holm) | Entscheid |
|---|---|---|---|---|
| H-A(1): Trefferquote 1 Tag ≠ 68,3 % | 80,0 % | 78,0 – 82,2 % | < 0,001 | bestätigt |
| H-A(7): Trefferquote 7 Tage ≠ 68,3 % | 78,0 % | 73,7 – 81,9 % | < 0,001 | bestätigt |
| H-A(30): Trefferquote 30 Tage ≠ 68,3 % | 72,2 % | 63,5 – 79,7 % | 0,70 | nicht bestätigt |
| H-B: Ausdehnung bei Perzentil < 20 grösser | +0,05 (log) | −0,06 – +0,16 | 0,51 | nicht bestätigt |
| H-C1: Ausdehnung bei IV − RV > +10 grösser | +0,21 (log) | +0,12 – +0,28 | < 0,001 | bestätigt |
| H-C2: Bei IV − RV < −5 ist RV vorwärts > DVOL | −4,97 Punkte | −8,7 – −1,5 | 0,99 | nicht bestätigt (Gegenteil) |

Zusätzlich beschreibend:

- **Volatilitäts-Risikoprämie:** DVOL lag im Mittel 5,8 Punkte über der danach
  tatsächlich realisierten 30-Tage-Volatilität, an 71 % der Tage.
- **Dicke Ränder:** Nach 1 Tag liegen zwar 80 % innerhalb der Spanne, aber das mittlere
  z² ist mit 0,82 nicht so klein, wie 80 % bei einer Normalverteilung nahelegen würden.
  Es gibt also weniger mittelgrosse, dafür mehr sehr grosse Bewegungen als im Modell.
  Ausserhalb der Spanne heisst oft: deutlich ausserhalb.
- **Ausdehnung je Gruppe** (Mittel von ln(RV vorwärts / RV rückwärts)): Perzentil < 20:
  +0,02; Perzentil ≥ 20: −0,03; IV − RV > +10: +0,18; −5 … +10: −0,03; < −5: −0,30.
  Nach sehr bewegten Phasen (IV deutlich unter RV) beruhigt sich der Markt meist.
- **Gruppengrössen:** Perzentil < 20: 573 Tage (2022–2025 fiel DVOL stark, daher
  häufig), IV − RV > +10: 374, −5 … +10: 894, < −5: 172.

## Grenzen

- **Überlappende Fenster:** Bei 30 Tagen sind es effektiv nur rund 50 unabhängige
  Beobachtungen. Das Block-Bootstrap berücksichtigt das, die KIs sind entsprechend
  breit.
- **DVOL statt 30-Tage-ATM-IV:** Für die Vergangenheit gibt es nur DVOL. Die Kachel
  rechnet die Differenz mit der ATM-IV, die meist etwas unter DVOL liegt.
- **Ein Markt, eine Phase:** 2022–2026 BTC, mit stark fallender Volatilität in
  2022–2025. Die Quoten können sich in anderen Phasen verschieben.

## Rohbericht

Zeitraum: 05.09.2022 – 13.10.2026 (1500 Tage mit DVOL und Kurs)

| hypothese   | aussage                                                       |    n |    wert |   ci_unten |   ci_oben |      p | zusatz                              |   n_gruppe |   p_holm | entscheid       |
|:------------|:--------------------------------------------------------------|-----:|--------:|-----------:|----------:|-------:|:------------------------------------|-----------:|---------:|:----------------|
| H-A(1)      | Trefferquote 1 Tag(e) ≠ 68,3 %                                | 1499 |  0.7999 |     0.7799 |    0.8219 | 0.0000 | mittleres z² = 0.820                |       1499 |   0.0000 | bestätigt       |
| H-A(7)      | Trefferquote 7 Tag(e) ≠ 68,3 %                                | 1493 |  0.7803 |     0.7368 |    0.8192 | 0.0000 | mittleres z² = 0.961                |       1493 |   0.0000 | bestätigt       |
| H-A(30)     | Trefferquote 30 Tag(e) ≠ 68,3 %                               | 1470 |  0.7218 |     0.6347 |    0.7966 | 0.3524 | mittleres z² = 1.094                |       1470 |   0.7048 | nicht bestätigt |
| H-B         | Ausdehnung bei DVOL-Perzentil < 20 grösser als sonst          | 1440 |  0.0526 |    -0.0555 |    0.1611 | 0.1693 | Gruppe 573 Tage, Vergleich 867 Tage |        573 |   0.5079 | nicht bestätigt |
| H-C1        | Ausdehnung bei IV−RV > +10 grösser als bei −5…+10             | 1440 |  0.2056 |     0.1174 |    0.2805 | 0.0000 | Gruppe 374 Tage, Vergleich 894 Tage |        374 |   0.0000 | bestätigt       |
| H-C2        | Bei IV−RV < −5: RV vorwärts > DVOL (Optionen waren zu billig) | 1440 | -4.9721 |    -8.7451 |   -1.4611 | 0.9948 | Gruppe 172 Tage                     |        172 |   0.9948 | nicht bestätigt |

Trefferquoten: {1: 0.799866577718479, 7: 0.7803081044876088, 30: 0.7217687074829932}
Volatilitäts-Risikoprämie DVOL − RV vorwärts: Mittel 5.81 Punkte, positiv an 71.2% der Tage
Mittlere Ausdehnung ln(RV vorwärts / RV rückwärts): {'pct<20': 0.024882183107828686, 'pct>=20': -0.027671464037229414, 'spread>10': 0.17816083215797351, 'spread -5..10': -0.02740442586880913, 'spread<-5': -0.3015480401154582}
Gruppengrössen: {'pct<20': 573, 'spread>10': 374, 'spread -5..10': 894, 'spread<-5': 172}
