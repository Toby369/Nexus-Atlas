# Orderflow-4-Schritte-Framework — Entwurf (13.10.2026)

**Status:** Entwurf zur Abstimmung mit Toby. **Noch nicht** vorregistriert, noch
nichts gebaut. Ein vorregistriertes Protokoll (wie
`CONFLUENCE-SCORE-PROTOCOL_2026-09-11.md`) entsteht erst, wenn die offenen Fragen in
Abschnitt 8 beantwortet sind.

**Herkunft:** Video „Trading WORLD CHAMPION Reveals the Orderflow Strategy That Won the
Robbins Cup“ (Chris Creamer). Den Robbins-Cup-Titel konnten wir am 13.10. nicht
unabhängig bestätigen. Das spielt für diesen Entwurf keine Rolle, weil das Framework
ohnehin an unseren eigenen Daten getestet wird und nicht auf Autorität beruht.

---

## 1. Idee in einem Satz

Die vier Schritte aus dem Video (**Umfeld → Ort → Bestätigung → Risiko**) werden als
**vier hintereinander geschaltete, messbare Filter** umgesetzt. Danach wird getestet, ob
jeder Filter **zusätzlich** etwas bringt, und zwar bevor irgendetwas davon im Dashboard
als Signal erscheint.

Das passt zu den README-Prinzipien („keine isolierten Signale aus einer einzelnen
Kennzahl“, „Datenqualität transparent“) und zur bisherigen Research-Kultur
(Pre-Registration, Walk-Forward, Block-Bootstrap).

## 2. Grundsätze für die Übersetzung

1. **Jeder diskretionäre Begriff bekommt eine Formel.** „Absorption“, „Discount“ und
   „Dominanzwechsel“ werden so definiert, dass zwei Personen (oder zwei Programmläufe)
   zum selben Ergebnis kommen. Was sich nicht definieren lässt, fliegt raus.
2. **Bestehende Bausteine wiederverwenden, nichts doppelt rechnen.** Regime, MTF-Ampel,
   VWAPs, Swing-Erkennung und CVD gibt es schon (siehe Abschnitt 3).
3. **Kein neuer 5-Minuten-Cron.** Die Log-Ingestion liegt bei 157 % des
   Free-Kontingents (`DB-INVENTAR_2026-10-12.md`). Alles Live-Relevante wird bei
   Seitenaufruf per RPC aus vorhandenen Tabellen gerechnet, wie bei
   `compute_market_state_matrix_latest`.
4. **Ablation statt Gesamtscore.** Wir messen nicht nur, ob das Gesamtsystem gewinnt,
   sondern was jeder Schritt zum Ergebnis beiträgt. Wenn z. B. das Umfeld-Filter nichts
   bringt, wird es weggelassen, statt aus Überzeugung behalten.

## 3. Was Nexus Atlas schon hat (Datenbasis)

| Baustein | Quelle im Projekt | Brauchbar für |
|---|---|---|
| Regime-Klassifikation (`TREND_EXPANSION_*`, `TREND_FORMING_*`, Range …) | `classify_market_regime()`, `lib/marketRegime.ts`, `market_state_matrix` | Schritt 1 |
| MTF-Ampel (15M/1H/4H/1D/1W) | `lib/mtfSignal.ts` | Schritt 1 |
| Volatilitätskennzahlen (ATR-Ratio, BB-Width, Garman-Klass) | `market_state_matrix` | Schritt 1 (GEX-Ersatz) |
| Funding-Z-Score, OI-Änderung | `market_state_matrix`, `market_snapshots` | Schritt 1 |
| Tages-/Wochen-/Swing-VWAP | `get_anchored_vwap_summary()`, `get_vwap_since()` | Schritt 2 |
| Spot-Volumenprofil (Buy/Sell je Preis-Bucket) | `spot_volume_buckets`, `SpotVolumeProfileChart` | Schritt 2 (POC/Value Area) |
| Swing-Hochs/-Tiefs | `lib/swingDetection.ts` | Schritt 2–4 |
| Taker-Buy-Volumen je Kerze, CVD | `candles.taker_buy_base_vol`, `cvd*`-Felder | Schritt 3 |
| Liquidationen | `liquidation_events` (**nur gesampelt**, ca. 25 s je 5 min) | Schritt 3, nur als Zusatzinfo |
| Optionsdaten | `options_snapshots` (Cron alle 30 min; Inhalt noch zu prüfen) | Schritt 1, optional (GEX) |

**Wichtige Einschränkung bei den Daten:** 1m-Kerzen werden nur 14 Tage aufbewahrt
(Cron 40), und 5m-Kerzen werden nicht gesammelt. Für einen Backtest mit genug
Stichprobe kommen deshalb **15m-Kerzen als Auslöser-Zeitrahmen** in Frage (ca. 4 Jahre
Historie in Supabase). Feinere Zeitrahmen bräuchten historische Binance-Daten, und die
waren aus der Sandbox bisher nicht erreichbar (siehe `lsob_backtest/README.md`).

## 4. Die vier Schritte als Regeln

Vorschlag für die Zeitrahmen: **Kontext 4h/1h, Ort 1h, Auslöser 15m.** Alle Parameter
unten sind Startwerte für das Protokoll und noch nicht optimiert.

### Schritt 1 — Umfeld (Erlaubnis-Filter)

Ergebnis je Zeitpunkt: `LONG_ERLAUBT`, `SHORT_ERLAUBT`, `BEIDE` oder `KEINE`.

| Bedingung | Ergebnis |
|---|---|
| 4h-Regime `TREND_*_BULLISH` **und** 1h-Ampel nicht bärisch | nur Long (Rücksetzer kaufen) |
| 4h-Regime `TREND_*_BEARISH` **und** 1h-Ampel nicht bullisch | nur Short |
| Range-Regime | beide Richtungen, aber nur an den Rändern (Schritt 2 strenger) |
| Funding-Z-Score extrem (\|z\| > 2,5) gegen die Handelsrichtung | Richtung sperren (Crowding) |

**Statt GEX ein Volatilitäts-Regime:** `atr_ratio` und `bb_width` geben an, ob der
Markt gerade „gedämpft“ (eher Mean-Reversion, Ausbrüche scheitern) oder „expandierend“
läuft. Das ist genau die Information, die das Video aus GEX ziehen will, nur direkt
gemessen statt aus einem Modell über Dealer-Positionen geschätzt.

**GEX selbst:** Nur als optionale Phase 4 (Abschnitt 7). Für BTC ist das Standard-GEX-
Modell fragwürdig, weil die Annahme „Dealer sind netto short Optionen“ auf Deribit oft
nicht stimmt (Glassnode weist selbst darauf hin), und weil das Optionsvolumen im
Vergleich zum Perp-Volumen klein ist. Zuerst prüfen, was `options_snapshots` überhaupt
enthält.

### Schritt 2 — Ort (Discount / Premium)

Referenz: **Tages-VWAP ab 00:00 UTC** mit Standardabweichungsbändern (σ) und das
**Value-Area-Profil der letzten 24h** (POC, VAH, VAL bei 70 % Volumen).

| Zone | Definition | Erlaubt |
|---|---|---|
| Discount | Preis ≤ VWAP − 0,5σ **oder** Preis unter VAL | Long |
| Premium | Preis ≥ VWAP + 0,5σ **oder** Preis über VAH | Short |
| Mitte | dazwischen | kein neuer Trade |

Im Range-Regime gilt die strengere Variante: ±1σ bzw. ausserhalb der Value Area.

Offene Detailfrage: Das vorhandene Volumenprofil kommt von Spot-Daten. Für Perps
müssten wir es entweder aus 15m-Kerzen nachbauen (grob, Volumen auf die Kerzenspanne
verteilt) oder das Spot-Profil als Näherung nutzen. Beides ist im Backtest
vergleichbar.

### Schritt 3 — Bestätigung (Auslöser auf 15m)

Hier wird „Absorption“ messbar gemacht. Long-Fall (Short spiegelbildlich):

**A. Absorptionskerze** (alle drei Bedingungen):
1. Das Tief der Kerze unterschreitet das tiefste Tief der letzten 8 Kerzen
   (neues lokales Tief, d. h. Verkäufer drücken).
2. Taker-Delta der Kerze (`2·taker_buy − volume`) liegt bei z < −1,5 gegenüber den
   letzten 96 Kerzen (= 24h): Es wurde aggressiv verkauft.
3. Schlusskurs liegt in der oberen Hälfte der Kerzenspanne: Der Verkaufsdruck kam
   nicht durch, jemand hat ihn aufgenommen.

**B. Dominanzwechsel** (innerhalb der nächsten 3 Kerzen):
- Eine Kerze schliesst über dem Hoch der Absorptionskerze **und** hat positives
  Taker-Delta.
- Einstieg: Open der Folgekerze (kein Lookahead, wie im Confluence-Protokoll).

**Variante C (alternativer Auslöser, separat getestet): Delta-Divergenz.** Neues
tieferes Tief, aber das kumulierte Delta dieses Schwungs ist schwächer als beim
vorherigen Tief (Verkäufer werden müde). Gibt es in ähnlicher Form schon im
Divergenz-Radar.

**Ehrliche Grenze:** Echte Absorption sieht man im Footprint (Trades je Preisstufe,
dazu das Orderbuch). Das Taker-Delta einer 15m-Kerze ist nur eine grobe Näherung. Wenn
die Näherung im Test nichts bringt, heisst das nicht zwingend, dass die Idee falsch ist,
sondern vielleicht nur, dass unsere Daten zu grob sind. Das muss im Ergebnis so stehen.

Liquidationsspitzen wären ein schönes Zusatzsignal (Kapitulation), werden aber nur
gesampelt erfasst und kommen deshalb **nicht** als Pflichtbedingung in Frage.

### Schritt 4 — Risiko & Ausstieg

| Element | Regel |
|---|---|
| Stop | Tief der Absorptionskerze − 0,1·ATR(14, 15m) |
| Ziel 1 | Tages-VWAP bzw. POC (je nachdem, was näher liegt) |
| Ziel 2 | Letztes Swing-Hoch (`swingDetection`, 1h) |
| Mindest-CRV | Distanz zu Ziel 1 ≥ 1,5 × Stop-Distanz, sonst **kein** Trade |
| Ausstieg | 50 % bei Ziel 1, Stop auf Einstand, Rest bis Ziel 2 oder Timeout 24h |
| Tagesregel | Nach 2 Verlusten in Folge keine neuen Trades bis 00:00 UTC |
| Kosten | 2 × 0,05 % Taker-Gebühr + 0,02 % Slippage je Trade, plus Funding über die Haltedauer |

Die Tagesregel wird im Backtest als Zustand der Trade-Kette umgesetzt (sequenziell,
höchstens ein aktiver Trade je Richtung, wie im Confluence-Protokoll Punkt 6). So sieht
man auch, ob die Regel selbst Wert hat oder nur Trades wegfiltert.

## 5. Testplan

**Ort:** neues Modul `research-python/orderflow_4step/`, analog zu `lsob_backtest/`.
Daten: 15m/1h/4h-Kerzen mit Taker-Volumen als CSV-Export aus Supabase, dazu
Funding-Historie.

**Ablation (das Herzstück):** Dieselbe Periode, dieselben Kosten, fünf Varianten:

| Variante | Filter aktiv |
|---|---|
| V0 | Zufälliger Einstieg mit gleicher Stop-/Ziel-Logik (Nulllinie) |
| V1 | nur Schritt 3 (Auslöser) |
| V2 | Schritt 2 + 3 |
| V3 | Schritt 1 + 2 + 3 |
| V4 | V3 + Tagesregel |

Die eigentliche Frage ist nicht „ist V4 profitabel?“, sondern „ist jede Stufe besser als
die vorherige, und zwar mehr als der Zufall erklären kann?“.

**Kennzahlen:** Erwartungswert in R nach Kosten, Trefferquote, Anzahl Trades, maximaler
Drawdown in R, Anteil profitabler Monate.

**Statistik (vorhandene Module wiederverwenden):**
- Train/Validation/Test zeitlich getrennt, Test-Zeitraum erst ganz am Schluss öffnen
- Unsicherheitsbereich per `block_bootstrap.py`
- Falls mehrere Parametervarianten (z. B. z-Schwelle −1,5 / −2,0) getestet werden:
  `compute_pbo` gegen Overfitting
- Entscheidung über `decision_framework.py` (PASS / FAIL / INSUFFICIENT_DATA)

**Erwartete Stichprobe:** Mit 15m-Kerzen über ca. 4 Jahre dürften es mehrere hundert
Trades sein. Das ist deutlich mehr als bei den Tagesdaten (n=201), aber nach der
Filterkaskade kann es trotzdem knapp werden. Das muss das Protokoll vorab festlegen
(Mindest-n je Variante).

## 6. Dashboard — erst nach bestandenem Test

Falls der Test besteht: eine Kachel **„4-Schritte-Check“** im Reiter „Preis, Orderflow
& Makro“:

```
Umfeld        ● Long erlaubt   (4h Trend bullisch, Funding neutral)
Ort           ● Discount       (−0,8σ unter Tages-VWAP)
Bestätigung   ○ wartet         (keine Absorption in den letzten 3 Kerzen)
Risiko        —                (erst bei Auslöser: Stop / Ziel / CRV)
```

- Rein lesend, per RPC bei Seitenaufruf berechnet, kein neuer Cron.
- Mit Hinweis auf die Testergebnisse (Erwartungswert und n), nicht als „Kaufsignal“.
- Registrierung in `lib/dashboardTiles.ts` und `lib/dashboardTabs.ts`.

Falls der Test **nicht** besteht: Ergebnis dokumentieren, eventuell nur die
Checkliste als Lernkarte in `/lernen` aufnehmen (Prozess-Disziplin hat auch ohne
statistischen Edge Wert), aber kein Live-Signal.

## 7. Phasen

| Phase | Inhalt | Ergebnis |
|---|---|---|
| 0 | Offene Fragen klären (Abschnitt 8), `options_snapshots` und Kerzen-Historie prüfen | Entscheidungen |
| 1 | Protokoll vorregistrieren (Parameter fix, Testzeitraum gesperrt) | `ORDERFLOW-4-SCHRITTE-PROTOCOL_….md` |
| 2 | Python-Modul + Tests (Lookahead-Tests wie bei den bisherigen Features) | `research-python/orderflow_4step/` |
| 3 | Ablation V0–V4 auf Train/Validation, danach einmal auf Test | Ergebnis-Bericht |
| 4 (optional) | GEX aus `options_snapshots` als zusätzlicher Umfeld-Filter testen | Zusatzbericht |
| 5 | Nur bei PASS: Live-RPC + Dashboard-Kachel | PR |

## 8. Offene Fragen an Toby

1. **Zeitrahmen:** 4h/1h Kontext und 15m Auslöser einverstanden? Feiner (5m/1m) geht
   nur mit externen Daten.
2. **Richtung:** Erst nur Long testen (weniger Varianten, sauberere Statistik) oder von
   Anfang an beide Richtungen?
3. **Session-Anker:** Tages-VWAP ab 00:00 UTC oder ab US-Eröffnung (14:30 UTC)?
4. **Stop/CRV:** Eigene Stop-Logik wie oben oder deine bestehenden Setup-Parameter
   (20x, SL −0,5 %, TP +1,75 % aus dem Confluence-Protokoll) übernehmen, damit die
   Ergebnisse vergleichbar sind?
5. **GEX:** Phase 4 überhaupt, oder gleich streichen?
