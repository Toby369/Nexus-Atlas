# Mo's Momentum Radar — Bestandsaufnahme, Code-Review & Plan — 2026-10-11

**STATUS: abgeschlossen.** Phase 1 (Pine-Fixes) und Phase 2 (Backtest aller Radar-Signale inkl. Punkt + VWAP-Vector-Level) erledigt, Ergebnis **NO_EDGE**, siehe `MOMENTUM-RADAR-BACKTEST_2026-10-11.md`. Phase 3 entfällt. Keine Production-Änderung. Grundlage:
`momentum_radar.pine` (Pine v5, 1011 Zeilen) und `Anleitung_Mos_Momentum_Radar.pdf`,
beide von Toby am 11.10.2026 geliefert.

Nutzer-Auftrag: "Verbesserungen? Einstellungen? nutzbar für Nexus? Webhook? Backtesting?" —
strukturiert vorgehen und erst prüfen, was im Repo schon dazu steht.

---

## 1. Was der Indikator ist

Ein Timing-Indikator ("wann", nicht "wo"). Er gehört zu Mo's VWAP Vector, der das Level liefert.
Die Bausteine:

| Baustein | Rechnung im Code | Herkunft |
|---|---|---|
| Welle | WaveTrend 9/12/3 auf HLC3 (`f_wt`) | identisch mit VuManChu Cipher B / LazyBear |
| Punkte | `crossover(wt1, wt2)` bei `wt1 <= -50` (Long) bzw. `crossunder` bei `wt1 >= 50` (Short), nur bestätigte Kerze | Cipher-B-"Green/Red Dots" |
| Großer Punkt | ≥ 60 % der Zeitebenen ÜBER dem Chart (plus Geldfluss) stehen in der gleichen Zone (`f_state`: Welle ≤ -35 bzw. ≥ +35) | eigene Logik |
| Raute | Kreuz, nachdem die Welle in den letzten 4 Kerzen jenseits ±100 lag | eigene Logik |
| Geldfluss | `SMA60((close-open)/(high-low) · volume) / SMA60(volume)`, selbstskaliert auf 22 | Cipher-B-ähnlich ("MF"), volumengewichtet |
| Spot vs. Futures | log-Verhältnis Perp-Volumen zu Spot-Volumen gegen den eigenen 200er-Schnitt, Schwelle × 1,5, Haltedauer 3 Kerzen | eigene Logik |
| Panel SWING/DAY | ≥ 2 von D/4h/1h (bzw. 15m+5m) in derselben Zone, keine dagegen | eigene Logik |
| Kontext | Wochen-/Monats-VWAP, 4h-BOS/CHoCH (Pivot 5), EMA50 | nur Anzeige |

## 2. Was im Repo schon dazu vermerkt ist

| Thema | Wo | Stand / Befund |
|---|---|---|
| **WaveTrend 9/12/3, MTF (1h/4h/D)** | `docs/research/WAVE-ANCHOR-*.md` (11 Dokumente), `research-python/wave_anchor_research/` | Abgeschlossen am 19.09.2026: **NO_INCREMENTAL_EVIDENCE**. 888 Zellen, BH-FDR, 80/20-OOS. Kein Wave-Feature reproduziert OOS. RSI- und Momentum-Baselines schneiden besser ab. |
| ↳ was dort **nicht** getestet wurde | `WAVE-ANCHOR-FEATURE-SPEC.md` TEST 1–12 | Getestet wurden Level-Kreuze bei ±60, Zustand, Slope, Distanz, Dauer und MTF-Konfluenz der ±60-Zustände. **Nicht getestet:** das Kreuz WT1×WT2 in der Zone (die Punkte des Radars), die 60-%-MTF-Stärke, Geldfluss, Spot/Futures. |
| Wiederverwendbare Bausteine | `wave_anchor_research/wavetrend.py`, `mtf_join.py` (`confirmed_asof_join`), `targets.py`, `stats_battery.py`, `baselines.py`, `regime.py` | Getestet und look-ahead-auditiert, direkt nutzbar |
| RSI-Extremzone + Gegenbewegung | `RSI-REVERSAL-TRIPLE-BARRIER_2026-09-14.md` | Gleiche Signalfamilie (überverkauft → dreht). **0 von 24 Test-Zellen** überstehen BH-FDR. |
| Divergenzen (RSI/MACD) | `DIVERGENCE-PATTERN-BACKTEST_2026-09-05.md`, `nexus-rsi-macd-divergence.pine` | Richtung plausibel, aber nicht robust nach Korrektur |
| Momentum-Divergenz (ADX + MACD) | `lib/momentumDivergence.ts`, `TOBY-SETUP-PHASEN-DEFINITION.md` | Vorläufiger Warnhinweis, OOS nicht reproduziert |
| MACD/RSI als Entry-Filter | `lsob_backtest/momentum_filter.py` | Tobys Praxisregel, im LSOB-Backtest verdrahtet |
| VWAP Vector, GUSS, CVD (Mo's Skripte) | `TradingIndicatorsCards.tsx`, `lib/panelInfo.ts`, `src/signals/guss.py` | Schon in Nexus nachgebaut. W-/M-VWAP aus dem Radar-Panel gibt es dort bereits. |
| Echter Geldfluss | `candles.taker_buy_base_vol`, CVD-Footprint (1m) | Nexus hat **echte Aggressor-Daten**. Der Radar schätzt den Geldfluss nur aus der Kerzenform. |
| Webhook-Pipeline | `lib/webhookTradingView.ts`, `lib/tradingViewSignal.ts`, `docs/tradingview/README.md` | Steht. Konventionen: JSON-`alert()`, Secret als Input, `signal_type` auf `_BULLISH`/`_BEARISH`/`_HIGH`/`_LOW` |
| Kerzendaten | Supabase `candles` (binance BTCUSDT) | 5m/15m/1h/4h/1d seit 2022-09, 1m seit 2024-09, 1w seit 2019. Aus dem Container nur über Supabase-MCP erreichbar, die Börsen-APIs sind gesperrt. |

**Abgrenzung zu Wave Anchor (mit Toby geklärt, 11.10.2026):** Der Momentum Radar ist **kein**
Update des Wave Anchor (StormCat1), sondern ein eigenständiger Indikator von Mo. Gemeinsam ist nur
der WaveTrend-Kern (9/12/3, HLC3, MTF 1h/4h/D). Signal-Logik, Zonen und alle Zusatzbausteine sind
anders. Die Wave-Anchor-Ergebnisse gelten deshalb nur für den gemeinsamen Kern, nicht für den Radar
als Ganzes. Wave Anchor dient in Phase 2 als Vergleichsbasis.

**Konsequenz für die Erwartung:** Die zwei nächstverwandten Studien (Wave Anchor, RSI-Reversal)
waren negativ. Für die Punkte des Radars ist deshalb ein skeptischer Prior angebracht. Offen und
damit der eigentliche Forschungswert sind die Bausteine, die Wave Anchor nicht hatte: das
Signalkreuz in der Zone, die MTF-Stärke und der Geldfluss (inkl. Divergenz Fluss vs. Preis).

## 3. Code-Review: Befunde

Repaint-Schutz der höheren Zeitebenen (`[1]` + `lookahead_on`) ist **korrekt** umgesetzt. Das ist
das Standardmuster und deckt sich mit dem `confirmed_asof_join` der Wave-Anchor-Forschung.

### Fehler (Aussage ≠ Rechnung)

1. **Schienen-Divergenzen prüfen die Welle nicht** (Z. 590–599). `f_htf` vergleicht nur den
   Preis (`pLo < prevP`), nicht den Wellenwert. Damit wird eine "DIV"-Linie schon gezogen, wenn
   der Preis zwischen zwei HTF-Signalen ein tieferes Tief macht. Das ist keine Divergenz. Die
   Anleitung nennt genau diese Linie "das schwerste Signal". Fix: `wW/wD/w4/w1h` beim Signal
   mitspeichern und `w > prevW` (Long) bzw. `w < prevW` (Short) verlangen.
2. **Schienen-Divergenz-Fenster skaliert nicht** (Z. 594: `DIV_MAX * 4` = 320 Chart-Kerzen). Im
   15m-Chart sind das 3,3 Tage. Zwei Tagessignale liegen fast nie so nah beieinander, dadurch
   erscheinen Tages-/Wochen-Divergenzen dort praktisch nie. Fix: wie `f_look` mit
   `timeframe.in_seconds(tf) / chartSec` skalieren.
3. **Geldfluss misst etwas anderes als beschrieben** (Z. 194). Der Kommentar sagt "wo in ihrer
   Spanne schließt die Kerze" (Close Location Value = `((C-L)-(H-C))/(H-L)`). Gerechnet wird aber
   `(C-O)/(H-L)`, also Körperrichtung relativ zur Spanne. Eine Kerze, die am Hoch öffnet und in der
   Mitte schließt, ist im Code Abfluss und laut Beschreibung neutral. Entweder Formel oder Text
   angleichen.

### Konzept-Schwächen

4. **"Großer Punkt" = alles überverkauft, nicht "Trend stützt".** HTF-"Unterstützung" heißt im
   Code: die höhere Welle steht ebenfalls in (fast) Long-Zone. In einem starken Abverkauf sind D,
   4h und 1h gleichzeitig überverkauft. Dann zeigt das Panel LONG SUCHEN und die Punkte werden
   groß, also genau im Messer-Fall. Die Anleitung behauptet "das Panel filtert genau diesen Fall".
   Der Code tut das nicht. Der einzige Trendfilter (Struktur, EMA50) ist reine Anzeige.
5. **Wichtigste Beobachtung wird nicht gerechnet.** Laut Anleitung ist "Geldfluss steigt, während
   der Kurs fällt" die wichtigste Beobachtung. Es gibt dafür weder eine Erkennung noch einen
   Alarm, sie ist nur visuell.
6. **Kein Alarm für Divergenzen.** Das "stärkste Setup" (Schienen-Divergenz + großer Punkt) kann
   nicht gemeldet werden.
7. **Divergenz am Kreuz statt am Extrem.** Verglichen wird `wt1` im Moment des Kreuzes, nicht der
   Wellen-Extremwert. Das ist vertretbar, aber ungenauer als die Pivot-Logik in
   `nexus-rsi-macd-divergence.pine`.

### Kleinigkeiten

8. `f_look` ist auf 500 Kerzen gedeckelt. Der Wochen-Rückblick im 15m-Chart umfasst dadurch nur
   ca. 5 Tage statt 5 Wochen.
9. Die BOS-Altersangabe zählt Chart-Kerzen, nicht 4h-Kerzen. Der Tooltip lässt das offen.
10. Spot/Futures-Aufteilung: Bei Binance/Bybit-BTC sind beide in BTC, also vergleichbar. Bei
    Kontrakt-Börsen stimmt die Prozentanzeige nicht (die Anleitung erwähnt das selbst).

## 4. Plan

Reihenfolge nach Nexus-Prinzip: erst prüfen, dann integrieren. Jede Phase endet mit einem
Entscheidungspunkt mit Toby.

### Phase 0 — Klärung (vor jedem Code)

- Fragen an Toby (siehe Abschnitt 5) beantworten lassen.
- Daten prüfen: Ist `candles` binance BTCUSDT Spot oder Perp? Gibt es Spot-Volumen für den
  Spot/Futures-Baustein? Falls nein, wird dieser Baustein zurückgestellt oder ein Datenpfad
  ergänzt (eigener Plan).

### Phase 1 — Pine-Fixes (klein, sofort nutzbar, unabhängig vom Backtest)

Datei: `docs/tradingview/mos-momentum-radar.pine` (Original unverändert daneben als Referenz).

- Befunde 1–3 fixen (Divergenz mit Wellenvergleich, skaliertes Fenster, Geldfluss-Formel bzw.
  -Text).
- Fehlende Alarme ergänzen: Divergenz (Chart-TF + Schiene), Geldfluss-Preis-Divergenz.
- Optionaler Trendfilter `input.bool` (aus, damit das Original-Verhalten Standard bleibt):
  großer Punkt nur in Richtung 4h-EMA50 bzw. letztem BOS. Wird erst nach Phase 2 eingeschaltet,
  wenn die Daten es stützen.
- Rechenwerk bleibt Konstante (Mo's Designentscheidung). Keine Parameter-"Optimierung" nach
  Augenmaß.

### Phase 2 — Backtest (Forschung, `research-python/momentum_radar_research/`)

Protokoll wie Wave Anchor / RSI-Reversal, damit die Ergebnisse vergleichbar sind:

- **Daten:** `candles` 15m/1h/4h/1d (2022-09 bis heute), Export über Supabase-MCP.
- **Reimplementierung:** `wavetrend.py` wiederverwenden, Signale 1:1 nach Pine nachbauen.
  Golden-Value-Abgleich gegen einen TradingView-Export (CSV aus "Daten exportieren") auf mind.
  einer Zeitebene.
- **HTF-Werte** ausschließlich über `confirmed_asof_join`, sonst kein Look-Ahead-Schutz.
- **Pre-registrierte Hypothesen** (vor dem ersten Blick festgelegt, nur Mo's Konstanten):
  - H1 kleiner Punkt (Long/Short) je Chart-TF 15m/1h/4h
  - H2 großer Punkt gegen kleinen Punkt (bringt die MTF-Stärke etwas?)
  - H3 großer Punkt + Panel-Freigabe (SWING/DAY-Status)
  - H4 Raute als Erschöpfungssignal (Gegenrichtung / Rücklauf)
  - H5 Geldfluss-Vorzeichen und Geldfluss-Preis-Divergenz
  - H6 Divergenz (Chart-TF, gefixte Version)
  - H7 optionaler Trendfilter (EMA50/BOS) gegen ungefiltert
  - H8 Spot/Futures-Urteil, nur falls Spot-Daten vorhanden
- **Zielgrößen:** Forward-Return 4/12/24 Kerzen und Triple-Barrier mit Tobys Setup (SL/TP/Haltedauer
  wie in `RSI-REVERSAL-TRIPLE-BARRIER`), nach Kosten.
- **Statistik:** 80/20 chronologisch, OOS nur einmal zur Bestätigung. Gepoolte BH-FDR, Block
  Bootstrap mit `max(10, 2×Horizont)`. Baselines: RSI-Reversal und das Wave-Anchor-±60-Kreuz.
  Regime-Split über `regime.py`.
- **Robustheit, keine Auswahl:** Parameter-Nachbarschaft (z. B. Zone ±40/±60, STR 0,5/0,7) nur zur
  Stabilitätsprüfung.
- **Ergebnis:** `docs/research/MOMENTUM-RADAR-BACKTEST_<Datum>.md` mit einer Klassifikation (wie
  Wave Anchor).

### Phase 3 — Integration in Nexus (nur je nach Ergebnis von Phase 2)

Zwei Wege, die sich nicht ausschließen:

- **A — Webhook (TradingView → Nexus-Badge):** schneller, gleiche Pipeline wie die 6 bestehenden
  Skripte.
  - Neuer Input "Nexus-Webhook" (Secret als `input.string`, Gruppe "Nexus Auth").
  - JSON-`alert()` mit `ticker:"BTCUSDT"`, `timeframe`, `price` flach. `signal_type` z. B.
    `MOMENTUM_RADAR_BIG_BULLISH` / `_BEARISH`, `MOMENTUM_RADAR_DIV_BULLISH` / `_BEARISH`,
    `MOMENTUM_RADAR_EXTREME_HIGH` / `_LOW`. Endungen passen zu `inferSignalDirection`.
  - **Wichtig:** Der bestehende Multi-Alarm nutzt ebenfalls `alert()` mit Klartext. Im
    Webhook-Modus müssen diese Klartext-Alerts unterdrückt werden, sonst bekommt die Edge
    Function Nicht-JSON-Bodies und antwortet mit 400.
  - `TRADINGVIEW_SIGNAL_INFO` und README um den Radar ergänzen.
- **B — Native Berechnung in Nexus:** WaveTrend, Punkte und Geldfluss aus `candles` (Edge
  Function / `compute-market-state`-Umfeld). Vorteile: kein TradingView-Alarm-Limit, kein Secret,
  echte Taker-Daten statt Kerzenform-Schätzung, und es ist backtest-identisch. Nachteil: mehr
  Aufwand und nur sinnvoll, wenn Phase 2 einen Mehrwert zeigt.

Fließt in keinem Fall in Score, Confidence oder Regime der 14-Faktoren-Engine ein. Es bleibt ein
Kontext-Badge, wie bei allen TradingView-Signalen.

### Entscheidungspunkte

| Nach | Entscheidung |
|---|---|
| Phase 0 | Welche Zeitebenen/Setups testen, Spot-Baustein ja/nein |
| Phase 1 | Fix-Version in TradingView einsetzen? |
| Phase 2 | Klassifikation: Mehrwert → Phase 3. Kein Mehrwert → als reines Chart-Werkzeug weiter nutzen, keine Nexus-Integration (wie Wave Anchor). |
| Phase 3 | Weg A, B oder beide |

## 5. Offene Fragen an Toby

1. Auf welchen Zeitebenen nutzt du den Radar wirklich (Entry-Chart: 5m/15m/1h/4h)?
2. Welche Signale handelst du konkret: nur große Punkte, Punkt + Schiene, Divergenz?
3. Welches Trade-Setup soll der Backtest abbilden (SL/TP/Haltedauer, wie bisher 20x, -0,5 %/+1,5 %)?
4. Chart-Symbol in TradingView (BINANCE:BTCUSDT.P oder BYBIT)? Wichtig für den Spot-Abgleich.
5. Soll Phase 1 (Pine-Fixes) schon vor dem Backtest passieren?
6. Webhook jetzt schon als reines Badge (Weg A), oder erst nach dem Backtest?

## 6. Entscheidungen Toby (11.10.2026)

| Frage | Antwort |
|---|---|
| Zeitebenen | 15m, 1h, 4h |
| Signale | große Punkte |
| Trade-Setup | wie bisher (20x, SL -0,5 % / TP +1,5 % Kursbewegung, max. 48 h, siehe `RSI-REVERSAL-TRIPLE-BARRIER_2026-09-14.md`) |
| Symbol | BINANCE:BTCUSDT.P |
| Reihenfolge | Fixes zuerst (Phase 1), dann Backtest |
| Webhook | noch offen, frühestens nach dem Backtest |

**Phase 1 erledigt:** `docs/tradingview/mos-momentum-radar.pine` (Fixes F1–F7, siehe Kopfkommentar
und `docs/tradingview/README.md`), Original unter `docs/tradingview/reference/`. Nicht in
TradingView kompiliert (kein Zugriff aus dem Container). Toby prüft beim Einfügen, ob der
Pine-Editor Fehler meldet.

**Konsequenz für Phase 2:** Primäre Hypothese ist H2/H3 (großer Punkt) je 15m/1h/4h, Long und Short
getrennt. H1 (kleiner Punkt) und das Wave-Anchor-Kreuz laufen als Vergleichsbasis mit. H4–H6 sind
sekundär. H8 (Spot/Futures) entfällt vorerst, weil `candles` nur ein Binance-Symbol enthält.

**Phase 2 erledigt (11.10.2026):** `MOMENTUM-RADAR-BACKTEST_2026-10-11.md`. Große Punkte auf
15m/1h: **NO_EDGE** (TP-Rate 20–23 % gegen 25 % Gewinnschwelle, nicht besser als kleine Punkte,
nicht besser als "immer im Markt"). Auf 4h treten große Punkte praktisch nie auf (1 in 4 Jahren).
Der Trendfilter lässt fast keine großen Punkte übrig, was Befund 4 bestätigt. Phase 3
(Nexus-Integration) entfällt damit für die großen Punkte.

**Folge-Backtest erledigt (11.10.2026):** Punkt + VWAP-Vector-Level, Raute, Divergenz,
Geldfluss-Divergenz, siehe `MOMENTUM-RADAR-BACKTEST_2026-10-11.md` Teil 2. Ebenfalls NO_EDGE.
Raute und 1h-Divergenz sind als Einstieg schlechter als Zufall.
