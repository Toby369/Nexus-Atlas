# Multivariates Modell + On-Chain-Daten — Ergebnisbericht

Auftrag von Toby: "Multivariates Modell probieren, gleiche Sorgfalt wie bisher" +
"On-Chain/andere Datenquellen statt andere Methoden". Beides zusammen umgesetzt:
ein logistisches Regressionsmodell auf kontinuierlichen (statt hart
diskretisierten) Faktoren, einmal mit und einmal ohne On-Chain-Metriken.

## 1. Was neu gebaut wurde

**On-Chain-Backfill.** `onchain_snapshots` hatte bisher nur 9-64 Tage Historie
(Collector erst kürzlich live). Der bestehende `collect-onchain`-Collector ruft
pro Metrik `GET /v1/{metrik}?token=...` bei bitcoin-data.com/BGeometrics auf —
und die Antwort enthält bereits die **komplette** Historie, der Collector nimmt
aber bisher nur den letzten Eintrag. Neue Edge Function `backfill-onchain`
nutzt das volle Array: 7 Metriken, 7 Requests, weit innerhalb des 15/Tag-
Limits. Ergebnis: SOPR/MVRV/Realized-Price/LTH-Net-Position/Stablecoin-Supply/
Whale-Adress-Count jetzt auf ~730 Tage (2024-09-01 bis heute) statt 9 Tage.
STH-Net-Position bleibt bei ~180 Tagen (API selbst hat nicht mehr Historie
für diese Metrik).

**Multivariates Modell** (`research-python/src/multivariate/`), gleiche
Validierungs-Infrastruktur wie alle bisherigen research-python-Module
(`PurgedWalkForwardCV`, `block_bootstrap_hit_rate_difference`, die 4
Decision-Gates aus `decision_framework.py`) — zum ersten Mal überhaupt gegen
ausreichend Daten gelaufen (n≈530 statt n=201 vorher):

- **Kontinuierliche statt diskretisierte Faktoren**: RSI/MACD-Histogramm/ADX/
  ±DI als Rohwert, EMA50/EMA200/VWAP-Abstand in %, Struktur/Makro/Sentiment als
  Ordinalskala — nichts wird mehr hart auf {-1,0,1} gekappt, bevor das Modell
  es sieht. Sentiment bewusst NICHT vorab kontrarisch gedreht (wie in
  Produktion) — das Modell soll sein eigenes Vorzeichen aus den Daten lernen.
- **Zwei Varianten**: `core` (12 Preis-/Derivate-Features) und `core_onchain`
  (+5 On-Chain-Features).
- **Logistische Regression**, 5-Fold Purged-Walk-Forward (Purge+Embargo je 1
  Tag), Ziel: Richtung über 24h (bewusst binär, nicht Rendite-Höhe — deine
  Wahl aus der Rückfrage).

## 2. Ergebnis

| Variante | n (out-of-sample) | Trefferquote | Mehrheits-Baseline | Folds über Baseline | Bootstrap-Differenz | Gate 3 |
|---|---|---|---|---|---|---|
| `core` (12 Features) | 320 | 49.1% | 51.9% | 1 von 5 | −2.8pp (p=0.25) | **FAIL** (falsche Richtung) |
| `core_onchain` (17 Features) | 315 | 49.8% | 53.0% | 2 von 5 | −3.2pp (p=0.26) | **FAIL** (falsche Richtung) |

**Beide Varianten schlagen nicht mal die triviale "immer die häufigere Klasse
raten"-Baseline — sie liegen sogar leicht darunter.** Nicht "kein Vorteil
nachgewiesen", sondern ein numerisch negatives, wenn auch statistisch nicht
signifikantes Ergebnis (Bootstrap-p-Werte 0.25-0.26, weit über α=0.05).

Gate 1 (Power) meldet zusätzlich INSUFFICIENT_DATA (n=320 vs. benötigte ~780
für 80% Power bei 5pp-Effekt) — aber das ist hier zweitrangig: mehr Daten
würden ein Ergebnis, das schon in die falsche Richtung zeigt, nicht retten.

**On-Chain-Daten haben nicht geholfen** (wenn überhaupt marginal schlechter,
im Rauschen).

## 3. Einordnung — was das bedeutet

**Nicht "das Modell war schlecht gebaut"** — dieselbe Validierungs-
Infrastruktur (Purging/Embargo/Block-Bootstrap/Decision-Gates), die in
`research-python/` bereits ausführlich getestet ist, wurde unverändert
wiederverwendet. Das ist ein sauberes, methodisch striktes Ergebnis.

**Es bestätigt, was die ganze bisherige SQL-seitige Recherche schon
nahelegte**: dem Modell die Wahl der Gewichte/Schwellen selbst zu überlassen
(statt der von Hand gewählten Werte der Produktions-Engine) hat **kein
verstecktes Signal freigelegt**. Die zugrundeliegenden Faktoren — überwiegend
Trendfolge-Technicals — tragen bei dieser Datenmenge kaum eigenständige
24h-Richtungsinformation, unabhängig davon, wie man sie kombiniert:
Regelbasiert (bisherige Modelle A-D), Event-basiert (letzte Studie), oder
jetzt gelernt (logistische Regression).

**On-Chain-Metriken sind eine echte NEUE Datenquelle** (SOPR/MVRV/LTH-Flows
sind nicht aus Preis/Volumen ableitbar) — dass sie hier nicht geholfen haben,
ist ein informativeres Ergebnis als "nicht getestet", aber noch nicht das
letzte Wort: 2 Jahre reichen für diese Metriken evtl. nicht (On-Chain-Zyklen
sind oft mehrmonatig/mehrjährig), und die 24h-Richtung ist für langsam
wandelnde On-Chain-Signale womöglich der falsche Zeithorizont — das wäre eine
andere, spezifische Folgefrage, nicht "On-Chain funktioniert nicht".

## 4. Empfehlung

Kein Grund, das multivariate Modell produktiv einzusetzen — es performt
schlechter als der triviale Mehrheits-Baseline. Kein Grund, die On-Chain-
Metriken jetzt ins Dashboard zu integrieren (Datenbasis dafür jetzt aber
vorhanden, für spätere Fragen).

**Ehrliches Gesamtbild nach jetzt fünf unabhängigen Testverfahren**
(Backfill+Revalidierung, Threshold-Sweep, Event-Studie mit Paar-Analyse,
multivariates Modell, On-Chain-Erweiterung): die 14-Faktor-Engine liefert
keinen robusten, methodenunabhängigen 24h-Richtungs-Edge. Das ist jetzt eine
sehr breit abgesicherte Aussage, nicht mehr nur eine Vermutung aus einem
einzelnen Test.

## 5. Was technisch neu ist (Referenz)

- Supabase: Edge Function `backfill-onchain` (deployed, einmalig manuell
  aufgerufen), `onchain_snapshots` jetzt ~730 Tage statt ~9-64 Tage.
- `research-python/src/multivariate/features.py` + `run_benchmark.py`, 8 neue
  Tests (`tests/test_multivariate_features.py`), volle Testsuite weiterhin
  grün (373 Tests).
- `research-python/data/export_multivariate_snapshot.sql` +
  `multivariate_1d_snapshot.csv` (Rohdaten-Export, dokumentiert reproduzierbar).
- `research-python/BENCHMARK_MULTIVARIATE_RESULTS.json` (volles maschinen-
  lesbares Ergebnis).

Keine Production-Änderung, kein Deploy von Dashboard-Code nötig.
