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

## Konkrete Empfehlung: welche weiteren Alert-Typen als Nächstes?

Rangfolge nach Mehrwert/Lückenfüller-Grad gegenüber den bestehenden 14
Faktoren (`compute-market-state`) und der 5-Säulen-Regime-Matrix:

1. **Liquidity Sweep / Stop-Hunt-Erkennung** (höchste Priorität) — Kerze
   sticht über/unter ein vorheriges Swing-High/-Low hinaus (Wick-Sweep) und
   schließt wieder zurück im vorherigen Range. Echte Lücke: Nexus hat
   nichts, das gezielte Liquiditätsjagden vor einer Umkehr erkennt — die
   14 Faktoren sind alle Zustands-/Trend-orientiert, kein Wick-/
   Struktur-Pattern-Faktor. Bei BTC-Perpetuals (hoher Hebel, viele
   Stop-Cluster um runde Zahlen/vorherige Highs) ein Pattern, das
   institutionelle/Prop-Desks aktiv tracken.
2. **RSI/MACD-Preis-Divergenz** (Momentum-Exhaustion) — Nexus hat RSI und
   MACD zwar bereits als Rohwerte im Momentum-Faktor, aber keine explizite
   Divergenz-Erkennung (Preis macht neues Hoch, Momentum-Indikator nicht).
   Divergenz ist eine andere Dimension als der reine Momentum-Level und
   damit ein echter Zusatz, kein Duplikat.
3. **Order Block / Fair Value Gap (ICT-Methodik)** — verbreitet bei
   Pro-/Prop-Tradern, aber komplexer zu robustem Pine-Code zu bringen
   (viele Interpretationsspielräume, mehr Parameter-Tuning nötig) und
   liefert tendenziell mehr Rauschen als Signal ohne manuelle Kuratierung.
   Sinnvoll als dritter Schritt, nicht als nächster.

**Nicht empfohlen als Ergänzung:** MTF-EMA-Alignment und CVD-Divergenz —
beide inhaltlich bereits von Nexus intern abgedeckt (MTF-Alignment bzw.
Futures-Orderflow/CVD-Faktor), würden nur redundante Badges ohne neue
Information erzeugen.
