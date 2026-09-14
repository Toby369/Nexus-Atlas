# RSI-Extremzone + Gegenbewegung → Triple-Barrier-Backtest von Tobys Setup — 2026-09-14

## 1. Fragestellung

Nutzer-Auftrag: "recherche: 5m, 15m, 1h. rsi überkauft/überverkauft dann gegenbewegung, wie
oft wird mein trade setup valide." Konkret: Wie oft ist der reale Trade (20x Hebel, SL -0,5%/
TP +1,5% Kursbewegung = 3:1 CRV, max. 48h Haltedauer — identische Umrechnung wie in
`TRIPLE-BARRIER-MTF-ALIGNMENT_2026-09-04.md`) profitabel, wenn der Einstieg durch "RSI
überkauft/überverkauft, dann Gegenbewegung" ausgelöst wird — getestet über 5m/15m/1h?

Auf Nachfrage vom Nutzer entschieden:
- Zwei **unabhängige** Signal-Definitionen, getrennt getestet (nicht kombiniert):
  1. **`pattern`** — RSI in der Extremzone UND ein bereits etabliertes Reversal-Kerzenmuster
     (`research_detect_candlestick_patterns()`, siehe `CANDLESTICK-PATTERNS_2026-09-04.md`)
     tritt an derselben Kerze auf.
  2. **`n_confirm`** — RSI erreicht die Extremzone (erster Eintritt), danach 2 aufeinanderfolgende
     Kerzen in Gegenrichtung als Bestätigung.
- Zwei RSI-Schwellenpaare, beide getestet: **70/30** und **80/20**.
- 5m einbeziehen trotz kürzerem Datenfenster, mit Hinweis im Report (siehe Abschnitt 2).

Macht 3 Intervalle × 2 Definitionen × 2 Schwellenpaare = **12 Konfigurationen**, je Long/Short
und je Split (train/validation/test) ausgewertet.

## 2. Datenbasis

- **15m, 1h**: durchgängig 2022-09-04 bis heute (`candles`).
- **5m**: existierte als Intervall nirgends im System und wurde für diese Recherche aus den
  1m-Rohkerzen aggregiert (`date_bin`, neue Funktion `get_resampled_candles()`), einmalig als
  echte `candles`-Zeilen mit `interval='5m'` materialisiert (213.196 Bars, 2024-09-04 bis
  2026-09-14 — Fenster ist auf die verfügbare 1m-Historie beschränkt, ca. 2 statt 4 Jahre).
- **Vorab behobener Datenausfall**: Die 1m-Kerzen-Sammlung war seit ihrem einmaligen
  historischen Backfill am 11.09.2026 nie live weitergelaufen (endete bei 2026-09-04,
  10 Tage veraltet). Vor dieser Recherche wurde `collect-candles` um ein `1m`-Intervall
  erweitert (nur `candles`, bewusst ohne `market_features`, siehe dortiger Code-Kommentar)
  und die Lücke per `backfill-history` nachgeholt — 1m läuft jetzt wieder live im
  15-Minuten-Cron mit.
- RSI(14) wurde für alle drei Intervalle **einheitlich selbst berechnet** (identische
  Wilder-Formel wie `collect-candles/index.ts::computeRsi`), nicht aus `market_features`
  übernommen — eine einzige konsistente Berechnungsquelle über alle Timeframes.

## 3. Methodik

- **Signal → Entry**: Entry am Open der nächsten Kerze nach Signal-Bestätigung (kein
  Lookahead).
- **Richtung**: Verlassen/Auftreten in der Überkauft-Zone → Short; Überverkauft-Zone → Long.
- **Triple-Barrier**: TP bei ±1,5% Kursbewegung, SL bei ∓0,5%, Timeout nach 48h Wall-Clock
  (unabhängig vom Eintritts-Intervall). Tie-Break bei gleichzeitiger Berührung in derselben
  Kerze: SL gewinnt (konservativ, gleiche Konvention wie alle bisherigen Backtests dieser
  Session).
- **Splits**: train (< 2026-01-14), validation (2026-01-14 bis < 2026-05-14), test
  (≥ 2026-05-15) — identisch zur bisherigen Session-Methodik.
- **Purging**: Ein Signal wird verworfen, wenn sein 48h-Ausgang-Fenster über die nächste
  Split-Grenze hinausreicht (verhindert Label-Leckage zwischen den Splits). Der bereits im
  Datum eingebaute 1-Tag-Abstand zwischen Validation-Ende und Test-Beginn dient als Embargo.
  Trades, deren 48h-Fenster über das Ende der verfügbaren Historie hinausreicht, wurden
  ebenfalls verworfen (kein rechtszensierter Ausgang).
- **Signifikanz**: Normalapproximierter Einstichproben-Test der TP-Rate gegen die
  ökonomische Gewinnschwelle bei 3:1 CRV (25,0%), Benjamini-Hochberg-FDR-Korrektur (α=0,05)
  über alle 24 Test-Zellen (12 Konfigurationen × 2 Richtungen) — identische Methode wie
  `research_bh_fdr_patterns()` (`research_norm_cdf`).
- Implementiert als eine einzige, deterministische SQL/PL-pgSQL-Funktion
  (`research_rsi_reversal_backtest`), da diese Session in dieser Sandbox keinen direkten
  Datenexport zu Supabase durchführen konnte (Netzwerk-Policy blockt Zugriffe ausserhalb des
  MCP-Kanals) — RSI-Berechnung, Signal-Erkennung und Triple-Barrier-Simulation laufen
  vollständig serverseitig, nur die aggregierten Kennzahlen wurden zurückgegeben.

## 4. Ergebnisse — Test-Split (pre-registriert, einmaliger Blick)

Sortiert nach unkorrigiertem p-Wert (Rang 1 = stärkster Ausreisser):

| Rang | Intervall | Schwellen | Definition | Richtung | n | TP-Rate | p-Wert | BH-Kritwert | Signifikant? |
|---|---|---|---|---|---|---|---|---|---|
| 1  | 5m  | 70/30 | n_confirm | LONG  | 121 | 14,0% | 0,0054 | 0,0022 | Nein |
| 2  | 15m | 70/30 | pattern   | SHORT | 68  | 11,8% | 0,0117 | 0,0043 | Nein |
| 3  | 15m | 80/20 | pattern   | SHORT | 10  | 0,0%  | 0,0679 | 0,0065 | Nein |
| 3  | 15m | 80/20 | pattern   | LONG  | 10  | 0,0%  | 0,0679 | 0,0065 | Nein |
| 5  | 1h  | 70/30 | pattern   | SHORT | 20  | 10,0% | 0,1213 | 0,0109 | Nein |
| 6  | 15m | 70/30 | n_confirm | LONG  | 46  | 15,2% | 0,1255 | 0,0130 | Nein |
| 7  | 5m  | 80/20 | pattern   | SHORT | 29  | 13,8% | 0,1634 | 0,0152 | Nein |
| 8  | 15m | 80/20 | n_confirm | LONG  | 9   | 44,4% | 0,1779 | 0,0174 | Nein |
| 9  | 1h  | 80/20 | n_confirm | LONG  | 4   | 0,0%  | 0,2482 | 0,0196 | Nein |
| 9  | 1h  | 70/30 | n_confirm | LONG  | 16  | 12,5% | 0,2482 | 0,0196 | Nein |
| 11 | 5m  | 70/30 | pattern   | LONG  | 224 | 21,9% | 0,2801 | 0,0239 | Nein |
| 12 | 1h  | 80/20 | pattern   | SHORT | 2   | 0,0%  | 0,4142 | 0,0261 | Nein |
| 13 | 5m  | 80/20 | n_confirm | LONG  | 25  | 32,0% | 0,4189 | 0,0283 | Nein |
| 14 | 15m | 70/30 | pattern   | LONG  | 90  | 22,2% | 0,5428 | 0,0304 | Nein |
| 15 | 1h  | 80/20 | pattern   | LONG  | 1   | 0,0%  | 0,5637 | 0,0326 | Nein |
| 15 | 1h  | 70/30 | n_confirm | SHORT | 16  | 18,8% | 0,5637 | 0,0326 | Nein |
| 17 | 5m  | 70/30 | pattern   | SHORT | 251 | 26,3% | 0,6357 | 0,0370 | Nein |
| 18 | 15m | 80/20 | n_confirm | SHORT | 6   | 16,7% | 0,6374 | 0,0391 | Nein |
| 19 | 1h  | 70/30 | pattern   | LONG  | 22  | 22,7% | 0,8055 | 0,0413 | Nein |
| 20 | 15m | 70/30 | n_confirm | SHORT | 50  | 26,0% | 0,8703 | 0,0435 | Nein |
| 21 | 5m  | 80/20 | n_confirm | SHORT | 21  | 23,8% | 0,8997 | 0,0457 | Nein |
| 22 | 5m  | 80/20 | pattern   | LONG  | 20  | 25,0% | 1,0000 | 0,0478 | Nein |
| 22 | 5m  | 70/30 | n_confirm | SHORT | 128 | 25,0% | 1,0000 | 0,0478 | Nein |

(1h/80-20/n_confirm/SHORT hatte n=0 im Test-Split und wurde aus der Rangliste ausgeschlossen.)

**Keine der 24 Test-Zellen übersteht die BH-FDR-Korrektur** (kein p-Wert liegt unter seinem
rangabhängigen kritischen Wert). Auffälliger noch: die meisten
TP-Raten liegen **unter** der 25%-Gewinnschwelle (viele im Bereich 10-22%), nicht nur "nicht
signifikant besser" — der stärkste Ausreisser (5m/n_confirm/LONG, p=0,0054 unkorrigiert) zeigt
mit 14,0% eine TP-Rate, die deutlich **schlechter** als der Zufallswert ist.

Vollständige Rohdaten (alle 72 Zellen inkl. train/validation) liegen in der DB-Tabelle
`research_rsi_reversal_results` (nicht produktiv, nur für diese Recherche).

## 5. Einordnung über alle Splits

Das Bild ist über train/validation/test hinweg konsistent instabil: TP-Raten schwanken pro
Zelle zwischen 0% und 50%, meist im 15-27%-Band um die Gewinnschwelle herum, ohne dass sich
in der Trainingsphase ein Muster zeigt, das sich in der Validierung oder im Test bestätigt.
Das ist das erwartete Bild für ein Signal ohne echten Vorhersagewert — reines Rauschen um die
Zufallslinie, nicht (wie bei einer echten Kante) ein train→validation→test durchgängig
erhöhter Wert.

## 6. Antwort auf die Fragestellung

**Dein Trade-Setup wird durch "RSI überkauft/überverkauft, dann Gegenbewegung" — egal in
welcher der getesteten Definitionen (Reversal-Kerzenmuster oder 2-Kerzen-Bestätigung), egal ob
70/30 oder 80/20, egal auf 5m/15m/1h — statistisch NICHT öfter valide als der Zufallswert bei
deinem 3:1 CRV (25%).** In den meisten Konfigurationen liegt die tatsächliche TP-Rate sogar
darunter. Es gibt keine Kombination, die nach Mehrfachvergleichs-Korrektur eine echte Kante
zeigt.

## 7. Limitationen

- 5m nur ~2 statt ~4 Jahre Historie (1m-Rohdaten-Limit) — bei mehr Historie könnten die
  ohnehin kleinen Zellen (teils n<10 im Test-Split) etwas stabiler werden, das Gesamtbild
  (keine Kante) würde sich aber mit an Sicherheit grenzender Wahrscheinlichkeit nicht drehen,
  da train/validation dasselbe Rauschmuster zeigen.
- `n_confirm=2` war die einzige getestete Bestätigungslänge (Nutzer nannte "2-3 Kerzen" als
  Beispiel) — 3 Kerzen wurden nicht separat getestet, da die 2-Kerzen-Variante bereits klar
  keine Kante zeigt und eine strengere Bestätigung die (ohnehin kleinen) Stichproben weiter
  verkleinert hätte.
- Gebühren/Funding/Slippage sind nicht modelliert (wie bei allen bisherigen Backtests dieser
  Session) — ein bereits am Bruttoergebnis fehlender Vorteil wird dadurch nur schlechter.
