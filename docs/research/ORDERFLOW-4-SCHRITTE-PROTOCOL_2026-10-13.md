# Orderflow-4-Schritte — Protokoll, vorregistriert vor Ergebnis-Ansicht (13.10.2026)

Pre-Registration nach demselben Prinzip wie `CONFLUENCE-SCORE-PROTOCOL_2026-09-11.md`:
Setup-Definition, Kosten, Datenaufteilung und Test-Verfahren stehen hier **bevor** eine
einzige Zahl ausgewertet wurde. Nachträgliche Änderungen an Regeln oder Parametern sind
nach Start der Implementierung nicht mehr zulässig. Erlaubt sind nur Nachträge, die
**vor** dem ersten Ergebnis-Blick datiert und begründet werden (z. B. ein Bug in der
Datenaufbereitung).

Grundlage: `ORDERFLOW-4-SCHRITTE-ENTWURF_2026-10-13.md`. Entscheidungen Toby (13.10.2026):
**nur Long**, **Tages-VWAP ab US-Börseneröffnung**, **eigene Stop-Logik wie im Entwurf**,
**GEX als optionale Phase behalten**, Zeitrahmen 4h/1h Kontext, 15m Auslöser.

---

## 0. Datenbasis (Phase 0, geprüft am 13.10.2026 in Supabase)

| Quelle | Inhalt | Zeitraum | Befund |
|---|---|---|---|
| `candles` 15m (Binance Futures, BTCUSDT) | OHLCV, `taker_buy_base_vol` | 04.09.2022 – heute | 144'089 Kerzen, **keine Lücken**, Taker-Volumen überall gefüllt |
| `candles` 1h / 4h | dito | 04.09.2022 – heute | 36'022 / 9'005 Kerzen |
| `candles` 1m | dito | nur 14 Tage | für den Backtest unbrauchbar |
| `research_funding_rate_history` | Funding je 8h | 04.09.2022 – 13.09.2026 | 4'412 Einträge; Lücke ab 13.09. (siehe 5.4) |
| `options_snapshots` | ATM-IV, Skew, Put/Call-OI, Max Pain | erst ab 26.08.2026 | **keine Gamma- oder Strike-Daten**, GEX daraus nicht berechenbar (siehe 9) |

## 1. Zeitrahmen und Datenaufteilung

- Auslöser und Ausführung: **15m**. Ort: **15m-Bars, Tages-VWAP und 24h-Profil**.
  Umfeld: **4h** (Regime) und **1h** (Struktur).
- Einlaufzeit 04.09.–30.09.2022 (Indikatoren mit langen Fenstern, z. B. SMA50 auf 4h).
- Zeitlich getrennte Abschnitte (Signalzeitpunkt = Schluss der Bestätigungskerze):

| Abschnitt | Zeitraum | Zweck |
|---|---|---|
| Train | 01.10.2022 – 30.09.2024 | Code-Prüfung, deskriptive Statistik, Sensitivitäts-Raster |
| Validation | 01.10.2024 – 30.09.2025 | zweite Prüfung, ebenfalls ohne Parameteränderung |
| **Test (gesperrt)** | **01.10.2025 – 30.09.2026** | **einmalige** Auswertung für die Entscheidung |

Ein Trade, der in einem Abschnitt beginnt, wird bis zum Ende ausgewertet, auch wenn er in
den nächsten Abschnitt hineinläuft. Der Test-Abschnitt wird erst geöffnet, wenn Code und
Tests fertig und committet sind. Das Öffnen wird mit Commit-Hash im Ergebnis-Bericht
festgehalten.

## 2. Schritt 1 — Umfeld

Ausgewertet am Schluss der **Absorptionskerze** (Abschnitt 4), jeweils mit der letzten
**abgeschlossenen** 4h- bzw. 1h-Kerze (As-of-Join, kein Lookahead).

**4h-Regime** über `research-python/src/regime.py::classify_market_regime` mit den
Standard-Schwellen (`RegimeThresholds()`):

| 4h-Regime | Folge |
|---|---|
| `TREND_EXPANSION_BULLISH`, `TREND_FORMING_BULLISH` | Long erlaubt, Ort-Regel **normal** |
| `VOLA_SQUEEZE_RANGING`, `UNRESOLVED_NEUTRAL`, `HIGH_VOLA_REVERSION` | Long erlaubt, Ort-Regel **streng** |
| `TREND_EXPANSION_BEARISH`, `TREND_FORMING_BEARISH` | **kein** Long |
| fehlende Eingangswerte | **kein** Long |

**1h-Struktur:** Der Status der MTF-Ampel (`lib/mtfSignal.ts`: `structure_trend` aus der
Swing-Struktur plus ADX ≥ 25) darf nicht `bearish_confirmed` oder `bearish_forming` sein.
Rekonstruktion in Python über `src/swing_structure.py`; die Übereinstimmung mit
`market_features.structure_trend` (1h) wird in Phase 2 geprüft und im Bericht angegeben.

**Funding:** Kein Long, wenn der Funding-Z-Score (`src/features/derivatives.py::
funding_zscore`, Fenster 90 Funding-Perioden ≈ 30 Tage) der letzten veröffentlichten Funding-Rate **> 2,5**
ist (überfüllte Long-Seite).

## 3. Schritt 2 — Ort (Discount)

**Tages-VWAP ab US-Börseneröffnung:**
- Anker: **09:30 America/New_York** an jedem Wochentag Montag bis Freitag (sommer- und
  winterzeitkorrekt, also 13:30 bzw. 14:30 UTC). US-Feiertage werden **nicht**
  ausgenommen (Vereinfachung, im Bericht genannt).
- Am Wochenende und vor 09:30 läuft der VWAP des letzten Ankers weiter (Montagmorgen also
  ab Freitag 09:30).
- Typischer Preis = (H + L + C) / 3, volumengewichtet über alle 15m-Kerzen seit dem
  Anker bis einschliesslich der aktuellen Kerze.
- σ = volumengewichtete Standardabweichung des typischen Preises um den VWAP.
- Mindestens **4 Kerzen** (1 Stunde) seit dem Anker, sonst gilt der Ort als nicht
  erfüllt.

**24h-Volumenprofil (Perp, aus 15m-Kerzen):**
- Fenster: die 96 Kerzen **vor** der aktuellen Kerze (aktuelle Kerze nicht enthalten).
- Bucket-Breite: 0,1 % des Schlusskurses der Vorkerze.
- Das Volumen jeder Kerze wird gleichmässig auf die Buckets zwischen ihrem Tief und Hoch
  verteilt.
- POC = Bucket mit dem meisten Volumen. Value Area = vom POC aus jeweils den grösseren
  Nachbarn hinzufügen, bis 70 % des Volumens erreicht sind. VAL/VAH = Unter-/Obergrenze.

**Regel**, ausgewertet am **Tief der Absorptionskerze**:

| Ort-Regel | Discount erfüllt, wenn |
|---|---|
| normal | Tief ≤ VWAP − 0,5σ **oder** Tief < VAL |
| streng | Tief ≤ VWAP − 1,0σ **oder** Tief < VAL |

## 4. Schritt 3 — Bestätigung (15m)

**Taker-Delta** je Kerze: `delta = 2 · taker_buy_base_vol − volume`
(identisch zu `src/signals/orderflow.py::compute_cvd_delta`).
**Delta-z** = (delta − Mittelwert) / Standardabweichung über die **96 vorherigen** Kerzen.

**A. Absorptionskerze** — alle drei Bedingungen:
1. Tief < tiefstes Tief der **8 vorherigen** Kerzen.
2. Delta-z < **−1,5**.
3. (Schluss − Tief) / (Hoch − Tief) ≥ **0,5**. Kerzen mit Hoch = Tief sind keine Kandidaten.

**B. Dominanzwechsel** — innerhalb der **3 folgenden** Kerzen schliesst eine Kerze
- über dem Hoch der Absorptionskerze **und**
- mit Delta > 0.

Die erste solche Kerze ist die **Bestätigungskerze**. Fällt vorher eine Kerze unter das
Tief der Absorptionskerze, verfällt das Setup.

**Einstieg:** Open der Kerze nach der Bestätigungskerze.

Variante C (Delta-Divergenz) aus dem Entwurf wird **nicht** in diesem Protokoll getestet.
Ein Nachtrag kann sie als eigenen, separat korrigierten Test aufnehmen.

## 5. Schritt 4 — Risiko und Ausstieg

### 5.1 Stop, Ziele, Mindest-CRV

- **Stop** = Tief der Absorptionskerze − 0,1 · ATR(14) auf 15m (Wilder, bis einschliesslich
  der Bestätigungskerze).
- **Ziel 1** = der nähere von Tages-VWAP und POC, der **über** dem Einstieg liegt (Werte
  zum Schluss der Bestätigungskerze). Liegt keiner darüber: **kein Trade**.
- **Ziel 2** = letztes bestätigtes 1h-Swing-Hoch über Ziel 1 (`lib/swingDetection.ts::
  detectFractalSwings`, Lookback 20: höher als die 20 Kerzen davor und danach). Ein Pivot
  gilt erst 20 Kerzen nach seiner Entstehung als bestätigt, und nur bestätigte Pivots
  zum Einstiegszeitpunkt zählen. Gibt es keines, wird die ganze Position bei Ziel 1 geschlossen.
- **Mindest-CRV:** (Ziel 1 − Einstieg) ≥ 1,5 · (Einstieg − Stop), sonst **kein Trade**.
- Einstieg ≤ Stop (Kurslücke): **kein Trade**.

### 5.2 Ablauf eines Trades

1. 50 % werden bei Ziel 1 geschlossen. Danach liegt der Stop für den Rest auf dem Einstieg.
2. Der Rest endet bei Ziel 2, beim Einstands-Stop oder nach **24h** (Schluss der Kerze, in
   der die 24h ablaufen).
3. Werden Stop und Ziel **in derselben 15m-Kerze** berührt, gilt **der Stop zuerst**
   (konservativ, 1m-Daten fehlen für die Historie).
4. Ohne Ziel 1 und ohne Stop bis 24h: Ausstieg zum Schlusskurs.

### 5.3 Kettenregeln

- Höchstens **ein** offener Trade zur gleichen Zeit (sequenziell wie im
  Confluence-Protokoll). Signale während eines offenen Trades werden verworfen.
- Neuer Einstieg frühestens in der Kerze nach dem Trade-Ende.
- **Tagesregel (nur Variante V4):** Ein Verlust ist ein Trade, dessen erste Hälfte am
  ursprünglichen Stop endet. Nach **2 Verlusten in Folge** sind neue Einstiege bis zum
  nächsten **US-Anker (09:30 New York, Mo–Fr)** gesperrt. Danach wird der Zähler
  zurückgesetzt.

### 5.4 Kosten

- **Gebühren und Slippage:** 0,05 % Taker-Gebühr plus 0,01 % Slippage je Seite und
  Teilposition, also 0,12 % Rundreise auf den Nominalwert.
- **Funding:** Für jeden Funding-Zeitpunkt (00/08/16 UTC), an dem die Position offen ist,
  wird die tatsächliche Rate abgezogen (positiv = Long zahlt). Fehlt die Rate (Lücke ab
  13.09.2026), wird **0,01 % je 8h** angesetzt. Die Zahl der betroffenen Trades steht im
  Bericht.
- **Ergebnis in R:** R = Nettogewinn in Prozent / ((Einstieg − Stop) / Einstieg). Die
  beiden Hälften werden mit je 0,5 gewichtet.

## 6. Varianten (Ablation)

| Variante | Aktive Regeln |
|---|---|
| **V0** | Zufallseinstieg: zufällige 15m-Kerzen, Stop = tiefstes Tief der 3 vorherigen Kerzen − 0,1·ATR, sonst identische Ziel-, CRV-, Ketten- und Kostenregeln. 1'000 Läufe, Seeds 0–999 |
| **V1** | Schritt 3 + Schritt 4 (ohne Tagesregel) |
| **V2** | V1 + Schritt 2 (Ort, immer Regel „normal“) |
| **V3** | V2 + Schritt 1 (Umfeld, Ort-Regel je nach Regime) |
| **V4** | V3 + Tagesregel = vollständiges Framework |

V0 bekommt pro Lauf so viele Einstiegsversuche, wie V1 im selben Abschnitt Signale hat.

## 7. Statistischer Test

**Messgrösse:** Tägliche R-Reihe je Variante, also die Summe der R aller Trades, die an
diesem UTC-Tag enden. Tage ohne Trade zählen mit 0, damit Varianten mit unterschiedlich
vielen Trades vergleichbar sind und die zeitliche Abhängigkeit erhalten bleibt.

**Hypothesen (alle einseitig, nur auf dem Test-Abschnitt):**

| # | Hypothese | Verfahren |
|---|---|---|
| H1 | Mittleres Tages-R von **V4** > 0 | `moving_block_bootstrap`, L = 14 Tage |
| H2 | V1 > V0 (Auslöser schlägt Zufall) | V1 gegen die Verteilung der 1'000 V0-Läufe (Rang-p-Wert) |
| H3 | V2 > V1 (Ort bringt etwas) | `block_bootstrap_mean_difference`, L = 14 Tage |
| H4 | V3 > V2 (Umfeld bringt etwas) | dito |
| H5 | V4 > V3 (Tagesregel bringt etwas) | dito |

- **Bootstrap:** 10'000 Wiederholungen, Seed 20261013.
- **Mehrfachtest-Korrektur:** Holm über H1–H5, Familien-α = 0,05.
- **Mindestgrösse:** V4 braucht im Test-Abschnitt **≥ 100 Trades**. Sonst ist das
  Ergebnis für H1 `INSUFFICIENT_DATA`, unabhängig vom p-Wert. Für H3–H5 gilt dasselbe für
  die kleinere der beiden verglichenen Varianten.

**Entscheidung:**

| Ergebnis | Folge |
|---|---|
| H1 bestätigt | Framework hat nach Kosten einen positiven Erwartungswert. Dashboard-Kachel (Phase 5) darf gebaut werden, mit den Testzahlen sichtbar |
| H1 nicht bestätigt | Keine Live-Signale. Bericht dokumentiert, welcher Schritt (H2–H5) etwas beiträgt; höchstens eine Checkliste in `/lernen` |
| `INSUFFICIENT_DATA` | Kein Entscheid. Wiederholung, wenn genug neue Daten vorliegen, mit unverändertem Protokoll |

Einzelne bestätigte H3–H5 ohne H1 rechtfertigen **kein** Live-Signal, nur einen
Hinweis für spätere Forschung.

**Zusätzlich berichtet (deskriptiv, nicht entscheidungsrelevant):** Trefferquote,
durchschnittliches R je Trade, Anzahl Trades, maximaler Drawdown in R, Anteil
profitabler Monate, Verteilung der Ausstiegsgründe, Ergebnis je 4h-Regime.

## 8. Sensitivität (nur Train + Validation)

Keine Parameteroptimierung. Zur Einschätzung der Robustheit wird auf Train + Validation ein
Raster gerechnet und **nur beschrieben**:

- Delta-z-Schwelle ∈ {−1,0; −1,5; −2,0}
- σ-Abstand (normal) ∈ {0,25; 0,5; 0,75}
- Lookback für neues Tief ∈ {5; 8; 12}

Das sind 27 Kombinationen für V4. Berichtet werden die Spannweite des Tages-R und
`compute_pbo` (CSCV, 8 Gruppen). Ein hoher PBO-Wert ist ein Warnsignal im Bericht. Er
ändert aber **nicht** die Parameter des Haupttests, die oben festgelegt sind.

## 9. GEX (optionale Phase 4)

Mit den vorhandenen Daten **nicht** umsetzbar: `options_snapshots` speichert nur
Aggregate (ATM-IV, Skew, Put/Call-OI, Max Pain), kein Open Interest und kein Gamma je
Strike. Für GEX bräuchte es:

1. einen neuen Sammler über die öffentliche Deribit-API (kostenlos; OI je Instrument über
   `get_book_summary_by_currency`, Gamma je Instrument über `ticker`), etwa alle 30 min,
2. eine Entscheidung, wie die Dealer-Seite angenommen wird (Standardannahme oder
   Taker-Flow-Schätzung wie bei Glassnode),
3. **6–12 Monate** Sammelzeit, bevor ein Test sinnvoll ist.

Ein neuer Sammler erhöht die Log-Ingestion (zurzeit 157 % des Free-Kontingents). Deshalb
braucht es dafür ein separates OK von Toby. GEX würde dann als **zusätzlicher**
Umfeld-Filter gegen V4 getestet (V5 > V4), mit eigenem Nachtrag zu diesem Protokoll.

## 10. Umsetzung (Phase 2)

- Modul `research-python/orderflow_4step/`, Daten als CSV-Export aus Supabase
  (`candles` 15m/1h/4h, `research_funding_rate_history`).
- Pflicht-Tests vor dem Öffnen des Test-Abschnitts:
  - Lookahead-Test für jedes Merkmal (Kürzen der Zukunft ändert keinen vergangenen Wert)
  - VWAP-Anker an DST-Wechseln (März und November)
  - Value-Area-Berechnung an einem von Hand nachgerechneten Beispiel
  - Trade-Simulation: Stop vor Ziel in derselben Kerze, Teilausstieg, Einstands-Stop,
    Timeout, Tagesregel
  - Übereinstimmung der 1h-Struktur mit `market_features` (Quote im Bericht)
- Bericht: `docs/research/ORDERFLOW-4-SCHRITTE-RESULTS_<Datum>.md`.
