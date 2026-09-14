# Regime-Score Makro-Retest: taegliches Fenster, nur Wochentage (14.09.2026)

Nutzer-Wunsch: "makro höhere Kerzen ... allgemein test erneut laufen lassen, jedoch Wochenende
auslassen (dort wird weniger getradet)". Retest der 8 Makro-Signale aus dem Regime-Score-Protokoll
(GESAMTEINSCHAETZUNG-SCORE-PHASE1-RESULTS_2026-09-12.md, Runde 4/5) auf einer angepassten
Auswertungsbasis.

## Was sich gegenueber dem produktiven Test aendert

Der produktive Regime-Score-Test (`research_regime_evaluation_events()`) bewertet alle 4h, an
jedem Wochentag, ob BTC binnen 4h um 1×ATR(14) auslenkt. Fuer die taeglich aktualisierten
Makro-Snapshots (DXY, Gold, S&P 500, Nasdaq, VIX -- Yahoo-Finance-Symbole) ist das ein Mismatch:

- **Wochenende:** die zugrunde liegenden Maerkte (Aktien, FX, Rohstoffe) sind Samstag/Sonntag
  geschlossen. `macro_snapshots.change_pct` wiederholt dann den Freitagsschluss unveraendert --
  ein Bewertungspunkt am Wochenende testet ein bereits "abgelaufenes" Signal gegen frische
  BTC-Kursbewegung, die mit diesem Signal nichts mehr zu tun hat.
- **4h-Fenster:** die Makro-Snapshots aktualisieren sich hoechstens einmal taeglich -- 6
  Bewertungspunkte pro Tag pruefen effektiv denselben Signalwert sechsmal (Pseudo-Replikation).

Neue Auswertungsbasis (`research_regime_evaluation_events_daily_weekday()`, Migration
`create_regime_evaluation_events_daily_weekday`):

- Ein Bewertungspunkt pro Tag (00:00 UTC) statt sechs.
- Zielfenster 24h statt 4h (weiterhin 1×ATR(14), weiterhin auf Basis der 1h-Kerzen/`atr_14` --
  die 1d-Kerzen haben nur fuer 252/1471 Tage einen `atr_14`-Wert, zu duenn fuer einen robusten
  Test).
- Samstag/Sonntag (UTC) werden als Bewertungspunkt ausgeschlossen.
- Ergebnis: 1.051 Bewertungspunkte (04.09.2022 - 14.09.2026, nur Werktage), Basisrate
  UP 496/1051 ≈ 47,2 %, DOWN 549/1051 ≈ 52,2 % (deutlich hoeher als beim 4h-Test mit ~33 %,
  weil ein 24h-Fenster einen 1×ATR-Ausschlag viel wahrscheinlicher macht).

Aktivierungslogik der 8 Signale (DXY, S&P 500, Nasdaq, Gold, VIX, Net-Liquidity, USD/JPY, M2, CPI,
PCE) ist 1:1 aus `research_regime_extend_activation_round4()`/`_round5()` uebernommen, nur gegen
die neuen Bewertungspunkte statt der produktiven 4h-Basis (`research_regime_macro_retest_daily_weekday()`,
Migration `create_regime_macro_retest_daily_weekday`). Bewusst ein eigener, kleiner BH-FDR-Pool
(13 Signal/Richtung-Zeilen) statt gemeinsam mit den anderen 34 Regime-Score-Kandidaten -- andere
Zielgroesse, waere sonst keine korrekte gemeinsame Korrektur. `Makro-Regime` (das gebuendelte
Risk-On/Off-Signal) ist in diesem Retest nicht enthalten, koennte bei Bedarf ergaenzt werden.

## Ergebnis

| Signal | Richtung | n aktiv | n inaktiv | Trefferquote aktiv | Trefferquote inaktiv | p (roh) | BH-FDR |
|---|---|---|---|---|---|---|---|
| Gold-Bewegung | DOWN | 146 | 905 | 59,6 % | 51,0 % | 0,055 | nein |
| M2-Wachstum | UP | 715 | 336 | 49,1 % | 43,2 % | 0,072 | nein |
| VIX erhöht | DOWN | 83 | 968 | 43,4 % | 53,0 % | 0,092 | nein |
| USD/JPY fällt | DOWN | 131 | 920 | 46,6 % | 53,0 % | 0,165 | nein |
| DXY-Bewegung | UP | 231 | 820 | 50,6 % | 46,2 % | 0,234 | nein |
| S&P-500-Bewegung | DOWN | 229 | 822 | 48,9 % | 53,2 % | 0,254 | nein |
| Nasdaq-Bewegung | UP | 370 | 681 | 44,9 % | 48,5 % | 0,265 | nein |
| Nasdaq-Bewegung | DOWN | 295 | 756 | 49,5 % | 53,3 % | 0,266 | nein |
| Gold-Bewegung | UP | 202 | 849 | 50,5 % | 46,4 % | 0,296 | nein |
| PCE-Anstieg | DOWN | 969 | 82 | 52,6 % | 47,6 % | 0,377 | nein |
| S&P-500-Bewegung | UP | 315 | 736 | 45,4 % | 48,0 % | 0,445 | nein |
| DXY-Bewegung | DOWN | 227 | 824 | 52,9 % | 52,1 % | 0,831 | nein |
| CPI-Anstieg | DOWN | 956 | 95 | 52,2 % | 52,6 % | 0,935 | nein |
| Net-Liquidity steigt | UP | 212 | 839 | 47,2 % | 47,2 % | 0,994 | nein |

**Keines der 8 Makro-Signale ist unter dieser Auswertung BH-FDR-signifikant** -- nicht einmal die
beiden groessten rohen Effekte (Gold DOWN, M2 UP) reissen die BH-FDR-Schwelle (kritischer Wert bei
Rang 1 nur 0,0036).

## Wichtigster Befund: DXY verliert seine Signifikanz

Im produktiven 4h/alle-Tage-Test war **DXY-Bewegung** das einzige der 8 Makro-Signale, das den
BH-FDR-Test bestand (beide Richtungen signifikant, p=0,0013/0,0086, Trefferquote 36,6 % vs. 32,6 %
DOWN bzw. 35,5 % vs. 32,3 % UP -- siehe Bericht vom 14.09.2026 weiter oben im Chat). Unter dieser
bereinigten Auswertung (taeglich, nur Werktage) zeigt DXY praktisch **keine** Differenzierung mehr:
52,9 % vs. 52,1 % (DOWN), 50,6 % vs. 46,2 % (UP, groesster verbleibender Unterschied, aber weit von
Signifikanz entfernt bei p=0,234).

Plausibelste Erklaerung: der urspruengliche 4h-Test enthielt Pseudo-Replikation -- derselbe
DXY-Tageswert wurde bis zu 6× (und am Wochenende sogar mehrfach mit demselben "abgelaufenen" Wert)
gegen unterschiedliche 4h-Fenster getestet. Das kann einen echten, aber schwachen Tages-Effekt
statistisch aufblasen, weil die Stichprobe weniger unabhaengige Beobachtungen enthaelt, als die
rohe Zeilenzahl suggeriert (n=1.858/6.961 im 4h-Test vs. tatsaechlich nur ~verteilt auf ~1.470
Kalendertage). Nach Bereinigung auf echte, unabhaengige Tagesbeobachtungen bleibt vom Effekt nichts
mehr uebrig.

## Einordnung / Empfehlung

- **Der bisherige DXY-Befund im produktiven Regime-Score sollte kritisch hinterfragt werden.**
  Er ist der einzige Makro-Faktor, der aktuell aktiv in die Score-Berechnung einfliesst (siehe
  `components/RegimeScoreCard.tsx`) -- unter der methodisch saubereren Auswertung haelt er nicht
  stand.
- Empfehlung: DXY-Bewegung testweise mit derselben taeglichen/werktags-Logik auch gegen den
  **produktiven** 4h-Zielgroesse re-testen (nicht nur das 24h-Fenster hier), um zu pruefen, ob das
  Problem am Zielfenster (4h vs. 24h) oder an der Pseudo-Replikation (6× taeglich vs. 1×) liegt --
  aktuell sind beide Aenderungen gleichzeitig passiert, nicht sauber getrennt.
- Kein Signal hier ist stark genug, um es in den Regime-Score aufzunehmen. Vorschlag: DXY vorerst
  NICHT automatisch aus dem Score entfernen (das waere eine weitere Aenderung ohne sauberen A/B-Test),
  aber bei der naechsten Score-Ueberarbeitung diesen Befund beruecksichtigen.
- Reproduzierbar jederzeit via `select * from research_regime_macro_retest_daily_weekday(0.05);`
  (Supabase-Projekt `cpktesxmbqrzpsurntul`).
