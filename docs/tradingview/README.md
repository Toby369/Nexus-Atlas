# TradingView Pine-Script-Alerts für Nexus Atlas Phase 2

Referenz-Pine-Scripts (v5) für die `webhook-tradingview` Edge Function
(siehe `lib/webhookTradingView.ts`, `lib/tradingViewSignal.ts`). Rein
informatives Kontext-Badge in `RegimeMatrixCard.tsx` — fließt nicht in
Score, Confidence oder Regime der 14-Faktoren-Engine (`compute-market-state`)
oder der 5-Säulen-Regime-Matrix ein.

## Dateien

- `nexus-volume-expansion.pine` — Donchian-Breakout mit Volumen-Filter
- `nexus-vwap-stretch.pine` — Session-VWAP-Stddev-Band-Exhaustion
- `nexus-squeeze-breakout.pine` — TTM-Squeeze-Release (Standard-Parameter)
- `nexus-liquidity-sweep.pine` — Stop-Hunt-Erkennung an Swing-High/-Low
- `nexus-rsi-macd-divergence.pine` — Regular Divergence (RSI + MACD-Histogramm getrennt)
- `nexus-order-block-fvg.pine` — Fair Value Gap (3-Kerzen-Luecke) + Order Block (letzte Gegenkerze vor Structure Break)

## Setup (pro Skript identisch)

1. Skript in TradingView unter "Pine-Editor" einfügen, `DEIN_SECRET` durch
   das echte `TRADINGVIEW_WEBHOOK_SECRET` ersetzen.
2. Auf den Chart anwenden, dann "Alarm erstellen" → Bedingung: das Skript
   selbst, Auslöser "Beliebiger alert()-Funktionsaufruf".
3. Unter "Benachrichtigungen" → Webhook-URL → die URL der
   `webhook-tradingview` Edge Function eintragen.
4. **Nie als "Public" veröffentlichen** — das Secret steht im Klartext im
   Skript-Quelltext. Nur privat/invite-only verwenden.

## Fix: Payload-Verschachtelung

Die Edge Function speichert den gesamten Alert-Body (minus `secret`) 1:1 in
die jsonb-Spalte `payload`. Die ursprünglichen Drafts schickten
`"payload":{"price":...}` als verschachteltes Unterobjekt — das wäre in der
DB als `payload.payload.price` gelandet (plus redundante Duplizierung von
`ticker`/`signal_type`/`timeframe` innerhalb der jsonb-Spalte). Alle drei
Skripte schicken `price` jetzt auf oberster Ebene des JSON-Bodys, landet
damit sauber unter `payload.price`. Keine Änderung an der Edge Function
oder `lib/webhookTradingView.ts` nötig.

## Weitere Fixes gegenüber dem ersten Entwurf

- **Volume Expansion**: Ticker hartcodiert auf `"BTCUSDT"` statt
  `syminfo.ticker` (konsistent, unabhängig davon, welches Chart/Exchange
  gerade offen ist).
- **VWAP Stretch**: Bänder nutzen jetzt den 3-Werte-Overload von
  `ta.vwap(source, anchor, stdevMult)` — liefert eine echte, volumen-
  gewichtete Stddev-Band-Berechnung anstelle eines fixen,
  session-unabhängigen `ta.stdev(close, 20)`. Crossover-Test läuft jetzt
  über `close` statt `high`/`low`, damit der gemeldete Preis exakt dem
  auslösenden Wert entspricht. Funktioniert nur auf Intraday-Timeframes
  (TradingView liefert auf 1D+ `na`).
- **Squeeze Breakout**: Bollinger-Multiplikator auf den TTM-Squeeze-
  Standardwert 2.0 korrigiert (vorher 1.5 → deutlich häufigere, weniger
  selektive Signale als üblich); alle Parameter jetzt über `input.*`
  einstellbar; doppelt berechnetes `ma`/`basis` zusammengelegt; Release-
  Bedingung erfordert jetzt explizit eine vorherige Squeeze-Bar
  (`sqzOn[1]`) statt sich allein auf die symmetrische Bandbreite zu
  verlassen.

## Liquidity Sweep / RSI-MACD-Divergenz — Implementierungsnotizen

Beide gemäß der Prioritätsliste unten als Nummer 1 und 2 ausgearbeitet.

**`nexus-liquidity-sweep.pine`**: nutzt `ta.pivothigh`/`ta.pivotlow` zur
Swing-Erkennung (inherent verzögert um `pivotLen` Bars — Standardverhalten,
kein Repainting), vergleicht dann jede neue Kerze gegen das zuletzt
bestätigte Pivot-Level. `LIQUIDITY_SWEEP_HIGH`/`LIQUIDITY_SWEEP_LOW` feuern
nur beim *ersten* Bar, der ein gegebenes Level sweept (`highSwept`/
`lowSwept`-Flags verhindern Alert-Spam bei mehreren Bars in Folge um
dasselbe Level).

**`nexus-rsi-macd-divergence.pine`**: folgt der etablierten "Divergence
Indicator"-Pivot-Vergleichslogik (Oszillator-Pivot vs. `ta.valuewhen` des
vorherigen Pivots, plus Bar-Abstandsfenster `rangeLower`/`rangeUpper` gegen
zu nah/weit auseinanderliegende Pivots). RSI und MACD-Histogramm werden
**unabhängig voneinander** ausgewertet (vier Signal-Typen:
`RSI_BULLISH_DIVERGENCE`, `RSI_BEARISH_DIVERGENCE`,
`MACD_BULLISH_DIVERGENCE`, `MACD_BEARISH_DIVERGENCE`) statt künstlich zu
einer Blackbox-Kombination zusammengeführt — so bleibt im Badge sichtbar,
welcher Oszillator die Divergenz zeigt.

## Order Block / Fair Value Gap — Implementierungsnotizen

Als Nummer 3 der Prioritätsliste umgesetzt, in einem Skript kombiniert
(gleiche Begründung wie bei RSI+MACD: werden in der Praxis fast immer
zusammen betrachtet).

**Fair Value Gap** (`FAIR_VALUE_GAP_BULLISH`/`FAIR_VALUE_GAP_BEARISH`): rein
mechanischer 3-Kerzen-Vergleich (`low > high[2]` bzw. `high < low[2]`, mit
einstellbarer Mindest-Lückengröße `minGapPct` gegen Rauschen aus winzigen
Lücken). Kein Pivot, keine Verzögerung über den Bar-Close hinaus, kein
Interpretationsspielraum.

**Order Block** (`ORDER_BLOCK_BULLISH`/`ORDER_BLOCK_BEARISH`): nutzt
dieselbe `ta.pivothigh`/`ta.pivotlow`-Erkennung wie `nexus-liquidity-
sweep.pine` für einen bestätigten Structure Break (Schlusskurs durchbricht
das zuletzt bestätigte Pivot), sucht dann rückwärts innerhalb `obLookback`
Bars die letzte entgegengesetzt gefärbte Kerze — deren Bereich gilt als
Order-Block-Zone. Es gibt keine einheitliche "offizielle" ICT-Definition
für Order Blocks; diese Variante ist bewusst mechanisch und konservativ
gehalten (fester Lookback statt unbegrenzter Rücksuche, `bosUpFired`/
`bosDownFired`-Flags gegen Alert-Spam wie bei Liquidity Sweep) statt eine
einzelne "beste" Interpretation vorzutäuschen — wer eine andere Definition
bevorzugt, kann `obLookback`/`pivotLen` anpassen oder die Order-Block-Logik
im Skript ersetzen, ohne die FVG-Hälfte zu berühren.

## Priorisierung der Alert-Typen (Begründung)

Rangfolge nach Mehrwert/Lückenfüller-Grad gegenüber den bestehenden 14
Faktoren (`compute-market-state`) und der 5-Säulen-Regime-Matrix:

1. **Liquidity Sweep / Stop-Hunt-Erkennung** ✅ umgesetzt — Kerze sticht
   über/unter ein vorheriges Swing-High/-Low hinaus (Wick-Sweep) und
   schließt wieder zurück im vorherigen Range. Echte Lücke: Nexus hat
   nichts, das gezielte Liquiditätsjagden vor einer Umkehr erkennt — die
   14 Faktoren sind alle Zustands-/Trend-orientiert, kein Wick-/
   Struktur-Pattern-Faktor. Bei BTC-Perpetuals (hoher Hebel, viele
   Stop-Cluster um runde Zahlen/vorherige Highs) ein Pattern, das
   institutionelle/Prop-Desks aktiv tracken.
2. **RSI/MACD-Preis-Divergenz** ✅ umgesetzt (Momentum-Exhaustion) — Nexus
   hat RSI und MACD zwar bereits als Rohwerte im Momentum-Faktor, aber
   keine explizite Divergenz-Erkennung (Preis macht neues Hoch,
   Momentum-Indikator nicht). Divergenz ist eine andere Dimension als der
   reine Momentum-Level und damit ein echter Zusatz, kein Duplikat.
3. **Order Block / Fair Value Gap (ICT-Methodik)** ✅ umgesetzt — Fair Value
   Gap ist eine rein mechanische 3-Kerzen-Lücke ohne Interpretations-
   spielraum. Order Block dagegen bewusst konservativ als "letzte Gegenkerze
   vor einem bestätigten Structure-Break" definiert, mit einstellbarem
   Lookback-Fenster — es gibt keine "offizielle" ICT-Definition, andere
   Varianten sind möglich, aber diese ist mechanisch nachvollziehbar statt
   eine einzelne "beste" Interpretation vorzutäuschen.

**Nicht empfohlen als Ergänzung:** MTF-EMA-Alignment und CVD-Divergenz —
beide inhaltlich bereits von Nexus intern abgedeckt (MTF-Alignment bzw.
Futures-Orderflow/CVD-Faktor), würden nur redundante Badges ohne neue
Information erzeugen.
