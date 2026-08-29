# Nexus Atlas — Institutional-Grade-Vergleich

Stand: 29.08.2026. Vergleicht Aufbau, Inhalt und Methodik von Nexus Atlas (14-Faktoren Market State + 5-Säulen Regime Matrix) mit vier institutionellen/professionellen Referenzsystemen: Bloomberg MAC3, MSCI Barra (USE3/GEM2), Glassnode und CoinGlass. Basiert auf einer Codebase-Analyse (`compute-market-state` v8, `research-python/src/regime.py`, die SQL-Migration `add_market_state_matrix_engine`) sowie öffentlich dokumentierten Eigenschaften der vier Referenzsysteme (Quellen am Ende). Keine Handelsempfehlung, keine Bewertung "Nexus ist besser/schlechter" ohne Kontext — die Systeme haben unterschiedliche Zielgruppen und Zwecke.

## 1. Zusammenfassung

Nexus Atlas' Faktoren-Anzahl (14) liegt in einer institutionell plausiblen Größenordnung — näher an Bloomberg MAC3 (16 Makro-Faktoren) als an minimalistischen akademischen Modellen (Fama-French, 3–5 Faktoren) oder an den Dutzenden/Hunderten Rohmetriken der reinen Krypto-Datenterminals (CoinGlass, Glassnode). Der methodische Hauptunterschied zu allen vier Referenzsystemen ist nicht die Faktor-Anzahl, sondern:

1. **Diskretisierung**: Nexus reduziert jeden Faktor hart auf {-1, 0, 1}; Barra/Bloomberg MAC3 arbeiten mit kontinuierlichen, meist z-score-normalisierten Exposures.
2. **Kalibrierung**: Nexus' Confidence ist eine unkalibrierte, aus Coverage×Konsens gemischte Zahl; institutionelle Risikomodelle geben statistisch hergeleitete Konfidenzintervalle bzw. kalibrierte Wahrscheinlichkeiten.
3. **Ein-Score-Ambition vs. Rohdaten-Terminal**: CoinGlass und Glassnode verzichten bewusst auf einen einzelnen Gesamt-Score — sie liefern Rohmetriken und vereinzelte, eigenständige Indizes (Fear & Greed, NUPL, MVRV-Z), die Synthese bleibt beim Nutzer. Nexus' Ambition, alles in einen Zustand zu verdichten, ist eher mit Barra/Bloomberg vergleichbar als mit den Krypto-Standardtools.

Dieser Sprint (siehe Abschnitt 5) hat drei der vier identifizierten Lücken angegangen: Faktoren-Gruppierung + Rohwert-Anzeige im UI, Confidence-Aufspaltung (Coverage/Consensus/Signal Strength), und ein Engine-Divergence-Meta-Signal. Die vierte (kontinuierliche statt diskreter Normalisierung) liegt als geprüftes, getestetes Forschungskonzept vor (`research-python/src/features/factor_normalization.py`), ist aber bewusst **nicht** in die Produktion übernommen — konsistent mit der bestehenden Position aus `PHASE-0-RECONCILIATION.md` Abschnitt 5.

## 2. Nexus Atlas — Architektur-Kurzportrait

- **Market State** (`compute-market-state`, Edge Function, v8): 14 unabhängige, hart diskretisierte Faktoren (-1/0/+1), additiv zu einem Score summiert → `BULLISH/BEARISH/NEUTRAL/MIXED/INSUFFICIENT_DATA` mit Confidence, Data Coverage, Risk Level, Pattern-Erkennung, MTF-Alignment.
- **Regime Matrix** (`compute_market_state_matrix_series`, SQL): 5 Feature-Säulen (Trend, Volatilität, Momentum/Mean-Reversion, Mikrostruktur/Derivate, Makro/Sentiment) → eines von 5 Regimes (`TREND_EXPANSION_BULLISH/BEARISH`, `HIGH_VOLA_REVERSION`, `VOLA_SQUEEZE_RANGING`, `UNRESOLVED_NEUTRAL`) über feste ADX-/Bollinger-/Z-Score-Schwellen.
- **Engine Divergence** (neu, dieser Sprint): direkter Richtungsvergleich der beiden obigen Engines als eigenständiges Meta-Signal (`lib/marketStateSummary.ts::computeEngineDivergence`).
- Backend: Supabase/Postgres, alle Schwellen als benannte Konstanten, jeder Faktor mit Rohbasis gespeichert (keine Black Box), striktes "keine Daten ≠ neutral"-Prinzip.

## 3. Vergleichstabelle

| Merkmal | Nexus Atlas | Bloomberg MAC3 | MSCI Barra (USE3/GEM2) | Glassnode | CoinGlass |
|---|---|---|---|---|---|
| Zielgruppe | Einzelperson, persönliches Tool | Institutionelle Händler/Portfoliomanager | Quant-Hedgefonds, Asset Manager | On-Chain-Analysten, institutionell + Retail | Derivate-Trader, institutionell + Retail |
| Anzahl Faktoren | 14 (Market State) + 5 Säulen (Regime Matrix) | 16 Makro-Faktoren | 13 Style- + 54 Industrie-Faktoren (USE3); 8 Style + 34 Industrie + 55 Länder (GEM2) | Dutzende Einzelmetriken, keine feste Faktor-Anzahl | Hunderte Rohmetriken über 30+ Börsen |
| Aggregation | Additive Summe (hart diskretisiert) zu einem Gesamtzustand | Korrelationsmatrix-Distanz + Multi-Dimensional-Scaling | Regressionsbasierte Faktor-Loadings, Kovarianz-basiertes Risiko | Kein Gesamt-Score — vereinzelte eigenständige Indizes (NUPL, MVRV-Z, Puell Multiple) | Kein Gesamt-Score — reines Rohdaten-Dashboard |
| Normalisierung | Harte Schwellen → {-1, 0, 1} | Kontinuierlich, korrelationsbasiert | Kontinuierlich, meist z-score-normalisiert | Metrik-abhängig, teils bereits normalisiert (z. B. Z-Scores bei MVRV) | Keine — Rohwerte |
| Confidence/Konfidenz | Unkalibrierte Coverage×Konsens-Zahl (0–100), Aufspaltung neu in diesem Sprint | Statistisch hergeleitete Modell-Konfidenz (Rolling Half-Life ~10–15 Monate) | Kovarianz-basierte Konfidenzintervalle | Keine explizite Konfidenz-Kennzahl je Metrik | Keine |
| Transparenz der Herleitung | Jeder Faktor mit Rohbasis gespeichert, kein Black-Box-Score | Modell-intern, für Kunden nicht Zeile-für-Zeile einsehbar | Modell-intern (Faktor-Exposures teils einsehbar für Kunden) | Metrik-Methodik meist dokumentiert, Rohdaten einsehbar | Rohdaten direkt einsehbar (kein Modell dahinter) |
| Datenbasis | Cross-Exchange (6 Börsen), Ground-Truth in DB gespeichert | Bloomberg-eigene, lizenzierte Marktdaten | Lizenzierte Marktdaten, oft jahrzehntelange Historie | On-Chain-Daten (Blockchain), eigene Pipelines | Cross-Exchange Derivate-Daten (30+ Börsen) |
| "Keine Daten"-Philosophie | Explizit: fehlende Quelle senkt Coverage/Confidence, wird nie stillschweigend neutral | N/A (institutionelle Datenlieferung i. d. R. lückenlos) | N/A | Metrik zeigt üblicherweise "n/a" bei fehlender Historie | Metrik zeigt üblicherweise "n/a" |

## 4. Detaillierte Einzelvergleiche

### 4.1 Bloomberg MAC3

Bloomberg's monatliches globales Risikomodell mit 16 Faktoren über Aktien, Inflation, Rohstoffe, FX, Kredit und Zinsen — die "Haupttransmissionskanäle" globaler Märkte. Kalibrierung auf rollierender Basis mit einer effektiven Halbwertszeit von ca. 10–15 Monaten (für Regime-Dynamik optimiert, nicht für Tages-Rauschen). Regime-Erkennung erfolgt über eine Distanzmessung zwischen Korrelationsmatrizen (euklidische Metrik), projiziert in einen 3D-Raum via Multi-Dimensional Scaling — eine deutlich aufwändigere statistische Methodik als Nexus' additive Faktorsumme, aber mit derselben Grundidee: mehrere unabhängige Signale zu einem Regime-Bild verdichten.

**Relevanter Unterschied für Nexus:** MAC3 arbeitet mit kontinuierlichen Faktor-Exposures und Korrelationsstruktur zwischen den Faktoren selbst (nicht nur additiv), während Nexus' 14 Faktoren als unabhängig behandelt werden (keine explizite Korrelationsmodellierung zwischen z. B. `structure` und `trend_strength`, obwohl beide Trendinformation tragen).

### 4.2 MSCI Barra (USE3/GEM2)

Der Quant-Hedgefonds-Standard für Aktien-Risikomodelle: USE3 nutzt 13 Style-Faktoren (Value, Momentum, Size, Volatility, etc.) plus 54 Industrie-Faktoren; GEM2 (global) 8 Style- + 34 Industrie- + 55 Länder-Faktoren. Jeder Faktor wird über eine Cross-Sectional-Regression pro Zeitpunkt geschätzt, die Faktor-Exposures sind kontinuierlich und typischerweise z-score-normalisiert relativ zum Anlage-Universum zum jeweiligen Zeitpunkt. Risiko wird über die volle Kovarianzmatrix der Faktoren aggregiert, nicht additiv.

**Relevanter Unterschied für Nexus:** Barra normalisiert relativ zum Cross-Section (z. B. "wie extrem ist dieser RSI-Wert *heute*, verglichen mit allen anderen gehandelten Assets"), Nexus normalisiert (implizit, über feste Schwellen) relativ zu einer festen historischen Erwartung (RSI>55 gilt immer als bullisch, unabhängig vom aktuellen Marktregime). `factor_normalization.py` (Abschnitt 5.3) ist ein erster Schritt in Richtung einer zeitlich rollierenden (nicht cross-sektionalen — Nexus hat nur ein Asset) Normalisierung.

### 4.3 Glassnode

Spezialisiert auf On-Chain-Analytik: aus Blockchain-Rohdaten (nicht Orderbuch-/Derivate-Daten) werden Metriken wie NUPL, MVRV-Z-Score, Puell Multiple, Realized Cap abgeleitet. Kein einzelner Gesamt-Score — jede Metrik ist eigenständig, mit eigener Methodik-Dokumentation, teils bereits als Z-Score oder Perzentil-Rang dargestellt (z. B. MVRV-Z-Score ist explizit ein Z-Score). Nutzer kombinieren mehrere Metriken selbst zu einer Einschätzung, meist visuell über ein "Workbench"-Dashboard mit mehreren Charts nebeneinander.

**Relevanter Unterschied für Nexus:** Glassnode verzichtet bewusst auf Aggregation — die Verantwortung für "was bedeutet das in Summe" bleibt beim (meist erfahrenen) Nutzer. Nexus' Ambition, das explizit zu automatisieren (`overall_state`), ist ambitionierter und nützlicher für einen schnellen Blick, erfordert aber genau deshalb höhere Sorgfalt bei Kalibrierung und Kommunikation der Unsicherheit — der Kern der in diesem Sprint umgesetzten Änderungen.

### 4.4 CoinGlass

Derivate-Datenterminal: Open Interest, Funding Rates, Liquidations-Heatmaps, Long/Short-Ratio, Orderbuch-Tiefe über 30+ Börsen, Options- und ETF-Daten. Wie Glassnode: reines Rohdaten-Dashboard, kein Gesamt-Score. Deckt inhaltlich einen erheblichen Teil dessen ab, was Nexus' `Mikrostruktur & Derivate`-Säule und die Live-Preis-/OI-/Funding-Kacheln zeigen — aber ohne die zusätzliche Synthese-Schicht.

**Relevanter Unterschied für Nexus:** CoinGlass' Stärke ist Breite und Rohdaten-Tiefe (viele Börsen, viele Instrumente); Nexus' Stärke ist die zusätzliche, nachvollziehbare Verdichtung auf einen Zustand — beide Ansätze sind komplementär, kein Ersatz füreinander (siehe bereits etablierte Empfehlung "CoinGlass für Derivate + Glassnode für On-Chain + eigene Synthese" aus der professionellen Praxis).

## 5. Was dieser Sprint konkret geändert hat

### 5.1 Sprint A — Faktoren-Gruppierung + Rohwerte (`components/MarketStateCard.tsx`)

Die 14 Faktoren werden im aufgeklappten Detail jetzt nach inhaltlicher Nähe gruppiert (Struktur/Trend, Momentum, Orderflow/Derivate, Positionierung, Optionen, Makro/Sentiment) statt als flache Liste — dieselbe Kategorisierung, mit der die Faktoren im Code bereits konzeptionell unterschieden werden. Zusätzlich zum -1/0/+1-Ampel-Signal wird der reale Rohwert angezeigt (z. B. "RSI 37.1", "ADX 35.1", "P/C 0.56") — macht sichtbar, *wie stark* ein Signal ist, nicht nur *in welche Richtung*, ohne die bestehende, ökonomisch begründete Diskretisierung selbst zu verändern.

### 5.2 Confidence-Aufspaltung (`lib/marketStateSummary.ts::computeConfidenceBreakdown`)

Die bestehende Confidence-Formel (`Coverage × |Score|/n_verfügbar × 100`) wird mathematisch exakt in drei unabhängig interpretierbare Anteile zerlegt: **Coverage** (wie viele Faktoren haben Daten), **Signal Strength** (welcher Anteil der verfügbaren Faktoren zeigt überhaupt eine Richtung, statt neutral zu sein) und **Consensus** (von den gerichteten Faktoren, wie viele stimmen überein). Keine neue Kennzahl — dieselbe gespeicherte Confidence bleibt Ground Truth, die Zerlegung macht nur sichtbar, *warum* eine Zahl niedrig oder hoch ist. Direkt motiviert durch die Fallstudie in `METHODIC_DIVERGENCE_2026-08-29.md`.

### 5.3 Engine Divergence (`lib/marketStateSummary.ts::computeEngineDivergence`, `engineDivergenceStatusLabel`)

Vergleicht die Richtungsaussage von Market State und Regime Matrix direkt anhand ihrer gespeicherten Ground-Truth-Werte. Bei tatsächlichem Widerspruch (beide Engines liefern eine klare, aber entgegengesetzte Richtung) wird der feste UI-Status **"Regime Transition / Engine Divergence HIGH"** in `RegimeMatrixCard.tsx` angezeigt. Uneinigkeit zwischen unabhängigen Modellen ist in der quantitativen Praxis selbst ein Signal (sinngemäß "Meta-Labeling", López de Prado) — siehe `METHODIC_DIVERGENCE_2026-08-29.md` für die auslösende Fallstudie.

### 5.4 Z-Score-Normalisierung — Konzept, nicht Produktion (`research-python/src/features/factor_normalization.py`)

Rollierende, kausale Z-Score-Transformation (`rolling_zscore`) plus eine kontinuierliche [-1, 1]-Soft-Diskretisierung (`soft_discretize`) als Nachfolger-Konzept zur harten Schwellenwert-Diskretisierung — mit vollständiger Lookahead-Bias-Testabdeckung (17 neue Tests), aber **explizit nicht in Produktion übernommen**. Konsistent mit der bestehenden Position: die aktuellen Schwellen (RSI 55/45, ADX 20) sind ökonomisch motiviert, nicht willkürlich, und eine Ablösung braucht einen empirischen Vergleich auf VALIDATION/TEST-Daten (Model E, siehe `PHASE-0-RECONCILIATION.md` Abschnitt 5), keinen automatischen Ersatz.

## 6. Was (bewusst) nicht angerührt wurde

- `compute-market-state` (Edge Function) selbst — bleibt unverändert, Ground Truth für die Backtest-Pipeline.
- Die produktiven Schwellenwerte (RSI 55/45, ADX 20, etc.) — nicht ersetzt, nur um eine Rohwert-Anzeige ergänzt.
- Die 40%-Coverage-Schwelle — unverändert, siehe `PHASE-0-RECONCILIATION.md` Abschnitt 7 für die Begründung.
- Keine Kalibrierung (Isotonic/Platt) der Confidence-Zahl selbst — die Aufspaltung macht die Formel transparent, kalibriert sie aber nicht neu.

## Quellen (Web-Recherche)

- Bloomberg: [A correlation-based framework for market regime detection using Bloomberg MAC3](https://www.bloomberg.com/professional/insights/risk/a-correlation-based-framework-for-market-regime-detection-using-bloomberg-mac3/)
- CoinGlass: [Crypto Data and Metrics Dashboard](https://www.coinglass.com/pro)
- Coin Bureau: [Best Crypto Analysis Tools 2026](https://coinbureau.com/review/crypto-research-tools)
- MSCI Barra USE3/GEM2 Faktor-Struktur (13/54 bzw. 8/34/55) — öffentlich dokumentierte Modellbeschreibung, Stand allgemeines Fachwissen zum Modell.
