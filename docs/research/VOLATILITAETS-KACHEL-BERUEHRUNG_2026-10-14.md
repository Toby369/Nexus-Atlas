# Volatilitäts-Kachel — Wie oft wird die Spanne berührt? (14.10.2026)

Nachtrag zu `VOLATILITAETS-KACHEL-BACKTEST_RESULTS_2026-10-14.md`. **Beschreibende
Messung, keine vorregistrierte Hypothese.** Auf Wunsch zeigt die Kachel die Werte als
Hinweis an (siehe Nachtrag unten).
Code: `research-python/vol_tile_backtest/touch.py` (Tests: `tests/test_touch.py`),
gleiche Daten und gleicher Zeitraum wie der Hauptbacktest: **05.09.2022 – 13.10.2026,
1'500 Tage**.

**Frage:** Der Hauptbacktest hat geprüft, ob der Kurs *am Ende* des Zeitraums in der
Spanne liegt. Hier wird geprüft, ob er die Spanne *irgendwann unterwegs* berührt, gemessen
an Hoch und Tief der 1h-Kerzen. Start ist jeweils 00:00 UTC mit dem DVOL-Stand von
00:00 UTC.

## Ergebnis

| Zeitraum | Spanne berührt (oben oder unten) | nur oben | nur unten | am Ende drin | nach Berührung wieder drin |
|---|---|---|---|---|---|
| 1 Tag | **42,7 %** (39,4–45,9) | 21,9 % | 22,1 % | 80,0 % | 53 % |
| 7 Tage | **45,5 %** (40,5–50,4) | 23,8 % | 22,2 % | 78,0 % | 52 % |
| 30 Tage | **48,6 %** (40,2–58,0) | 27,6 % | 22,3 % | 72,2 % | 43 % |

In Klammern: 95 %-Bereich (Block-Bootstrap). Beide Seiten im selben Zeitraum: 0,5–1,4 %.
Zum Vergleich das Lehrbuchmodell (Brownsche Bewegung): eine Seite 31,7 %, irgendeine
Seite **62,9 %**.

**Wie weit über die Grenze?** Wird die Spanne berührt, geht der Kurs im Median noch
rund **0,4–0,6 Sigma** weiter. In jedem zehnten Fall sind es 1,6–2 Sigma. Bei 1 Tag und
DVOL 40 (Sigma ≈ 2,1 %) heisst das: im Median rund 1 % über die Grenze hinaus, in jedem
zehnten Fall 3,5 % oder mehr.

## Unterschiede (1 Tag)

| Gruppe | Tage | berührt | am Ende drin |
|---|---|---|---|
| **Mo–Fr** | 1'071 | **53,0 %** | 75,4 % |
| **Sa/So** | 428 | **16,8 %** | 91,6 % |
| DVOL 32–45 | 500 | 42,4 % | 81,0 % |
| DVOL 45–55 | 499 | 43,9 % | 79,0 % |
| DVOL 55–115 | 500 | 41,8 % | 80,0 % |

DVOL rechnet die Schwankung gleichmässig auf alle 365 Tage um. Unter der Woche bewegt
sich BTC aber deutlich mehr als am Wochenende. Die 1-Tages-Spanne ist deshalb
**werktags zu eng und am Wochenende zu breit**. Das DVOL-Niveau selbst macht kaum einen
Unterschied.

## Lesart

- Die Spanne ist eine Aussage über den **Endstand**, nicht über den Weg. Unterwegs wird
  sie an rund 43 % der Tage berührt, werktags an mehr als jedem zweiten.
- Nach einer Berührung kehrt der Kurs etwa in der Hälfte der Fälle bis zum Ende zurück.
- Ein Stopp genau an der Spannengrenze wäre werktags an jedem zweiten Tag erreicht worden.
- Der Kurs berührt die Spanne seltener, als das Modell erwartet (43 % statt 63 %). Das
  passt zur Volatilitäts-Risikoprämie aus dem Hauptbacktest: Die Spanne ist im Mittel
  etwas zu breit.

## Grenzen

- Wochentag und DVOL-Drittel sind nachträglich angeschaut, nicht vorab festgelegt. Sie
  sind ein Hinweis, kein Testergebnis. Der Wochenend-Unterschied ist allerdings so gross
  (53 % gegen 17 %), dass Zufall praktisch ausgeschlossen ist.
- Gemessen wird ab 00:00 UTC. Wer die Kachel zu einer anderen Uhrzeit liest, hat ein
  anderes Fenster. Für 7 und 30 Tage spielt das kaum eine Rolle, für 1 Tag schon (zum
  Beispiel US-Eröffnung im Fenster oder nicht).
- Hoch und Tief stammen aus Binance-Futures. Einzelne Dochte (kurze Ausschläge) zählen als
  Berührung.

## Nachtrag 14.10.2026: Hinweis in der Kachel

Auf Tobys Wunsch zeigt die Kachel die Messung jetzt als Hinweis an
(`lib/volatility.ts::ONE_DAY_BY_DAYTYPE`, `oneDayWindowType`):

- Bei der 1-Tages-Spanne steht die historische Quote „am Ende drin“ je nach Tagesart:
  werktags 75 %, am Wochenende 92 %.
- Unter den Spannen steht eine Zeile: werktags „eher zu eng – unterwegs an 53 % berührt“,
  am Wochenende „eher zu breit – nur an 17 % berührt“.
- Als Wochenende gilt, wenn die Mitte der nächsten 24 h (jetzt + 12 h) auf Samstag oder
  Sonntag UTC fällt.

Die Spanne selbst wird nicht umgerechnet, sie kommt weiterhin unverändert aus dem DVOL.
