-- Exportiert aus supabase_migrations.schema_migrations (20260915134022 seed_quiz_cards_nexus_mechanik)

-- Nutzer-Wunsch 15.09.2026: Lernkarten-Inhalt fuer die bereits bestehende
-- Leitner-Infrastruktur (lib/leitner.ts, /api/quiz/*, /lernen -- alles schon
-- gebaut, nur quiz_cards war leer). Karten 1:1 aus dem geprueften Anhang-1-
-- Kartenset, gegen den Live-Code von compute-market-state verifiziert.
-- ZWEI Korrekturen gegenueber der Vorlage (siehe Chat-Feedback 15.09.2026):
--  - Makro-Regime 5. Referenzwert: KEINE US10Y-Rendite (die wird in Nexus
--    gar nicht getrackt), sondern die abgeleitete Net-Liquidity
--    (Fed-Bilanz minus TGA minus Reverse-Repo) -- siehe get_macro_regime().
--  - Risk-Level-Frage: Code hat 5 einzelne Risikoquellen (funding_crowding
--    und basis_crowding sind getrennte Flags), nicht 4 gebuendelte.
insert into quiz_cards (question, answer, explanation, category) values
-- 1. Marktstruktur
('Welche vier Grundelemente bilden die Marktstruktur-Analyse?', 'HH (Higher High), HL (Higher Low), LH (Lower High), LL (Lower Low)', null, 'Marktstruktur'),
('Was bedeutet BOS im Kontext von NEXUS?', 'Break of Structure — Bruch der bisherigen Struktur in Trendrichtung', null, 'Marktstruktur'),
('Was bedeutet CHoCH?', 'Change of Character — erstes Anzeichen eines möglichen Trendwechsels', null, 'Marktstruktur'),
('Woher bezieht der Struktur-Faktor seinen Wert?', 'Aus structure_trend in market_features (bullish/bearish/ranging)', null, 'Marktstruktur'),
-- 2. Momentum
('Welche zwei Indikatoren müssen für ein Momentum-Signal übereinstimmen?', 'RSI(14) und MACD-Histogramm', null, 'Momentum'),
('Ab welchem RSI-Wert gilt Momentum als bullisch (bei positivem MACD-Histogramm)?', 'RSI > 55', null, 'Momentum'),
('Ab welchem RSI-Wert gilt Momentum als bearisch (bei negativem MACD-Histogramm)?', 'RSI < 45', null, 'Momentum'),
('Was passiert, wenn RSI und MACD-Histogramm sich widersprechen?', 'Momentum-Faktor wird neutral (0) gewertet', null, 'Momentum'),
-- 3. CVD / Orderflow
('Wofür steht CVD?', 'Cumulative Volume Delta', null, 'CVD / Orderflow'),
('Welche drei Zustände kann cvd_trend annehmen?', 'rising, falling, flat', null, 'CVD / Orderflow'),
('Was zeigt eine Divergenz zwischen bullischer Struktur und fallendem CVD an?', 'Mögliche Schwäche der Aufwärtsbewegung trotz optisch bullischer Struktur ("Fragile Bullish")', null, 'CVD / Orderflow'),
-- 4. Open Interest vs. Preis
('Welcher Schwellenwert muss das 1H-OI-Delta überschreiten, damit es als Faktor zählt?', '0,3 %', null, 'Open Interest vs. Preis'),
('Wie wird die Richtung des OI-Preis-Faktors bestimmt?', 'Über den Vergleich Schlusskurs vs. EMA20 (oberhalb = bullisch, unterhalb = bearisch)', null, 'Open Interest vs. Preis'),
('Was zeigt oi_volume_ratio zusätzlich an, ohne selbst ein Faktor zu sein?', 'Wie „echt" der OI-Aufbau relativ zum Handelsvolumen ist', null, 'Open Interest vs. Preis'),
-- 5. Positioning
('Ab welchem Score gilt Positioning als bullisch?', 'Score > 10 (Divergence-Engine-Score)', null, 'Positioning'),
('Welche drei Bedingungen definieren ein Short-Squeeze-Setup in NEXUS?', 'Retail-Trader short, Top-Trader long, Open Interest steigend', null, 'Positioning'),
('Wie alt darf ein Positioning-Signal höchstens sein, um noch zu zählen?', '30 Minuten', null, 'Positioning'),
-- 6. Orderbook-Imbalance
('Wie wird depth_imbalance berechnet?', '(bid_depth_usd − ask_depth_usd) / (bid_depth_usd + ask_depth_usd)', null, 'Orderbook-Imbalance'),
('Ab welchem Imbalance-Wert gilt das Orderbook als bullisch?', '> 0,08', null, 'Orderbook-Imbalance'),
('Über wie viele Börsen wird die Orderbook-Imbalance gemittelt?', 'Bis zu 3 (letzter gemeinsamer Tick, Sicherheitsmarge von 9 Zeilen)', null, 'Orderbook-Imbalance'),
-- 7. Optionen
('Welches Put/Call-OI-Verhältnis gilt als bullisch?', 'Unter 0,7', null, 'Optionen'),
('Welches Put/Call-OI-Verhältnis gilt als bearisch?', 'Über 1,1', null, 'Optionen'),
('Was ist Max Pain?', 'Der Strike-Preis mit dem minimalen Gesamt-Auszahlungsbetrag zur nächsten Verfallsperiode', null, 'Optionen'),
('Warum fliesst IV Rank aktuell nicht in die Faktor-Wertung ein?', 'Noch nicht genug historische Daten für einen aussagekräftigen Rank', null, 'Optionen'),
-- 8. Makro-Regime
('Welche zwei Regime unterscheidet NEXUS makroökonomisch?', 'Risk-On und Risk-Off', null, 'Makro-Regime'),
('Welche Referenzwerte fliessen ins Makro-Regime ein?', 'S&P 500, Nasdaq Composite, VIX, US-Dollar-Index (DXY) sowie die abgeleitete Net-Liquidity (Fed-Bilanz minus TGA minus Reverse-Repo)', 'Korrigiert 15.09.2026: NICHT die 10-jaehrige US-Treasury-Rendite (wird in Nexus nirgends getrackt) -- der 5. Faktor ist Net-Liquidity, siehe get_macro_regime().', 'Makro-Regime'),
('Woher stammen die Makro-Daten?', 'Über die inoffizielle Yahoo-Finance-Chart-API (kein Key nötig, aber nicht formal garantiert)', null, 'Makro-Regime'),
-- 9. Funding Rate
('Ab welchem Wert gilt Funding als "extrem"?', '0,05 % (0,0005 als Dezimalwert)', null, 'Funding Rate'),
('Warum wird eine stark positive Funding Rate bearisch gewertet?', 'Sie zeigt Long-Crowding — Risiko für Long-Liquidationskaskaden, daher bewusst konträr gewertet', null, 'Funding Rate'),
('Über wie viele Börsen wird die Funding Rate gemittelt?', 'Cross-Exchange-Durchschnitt (exchange_count in der Basis dokumentiert)', null, 'Funding Rate'),
-- 10. Sentiment (Fear & Greed)
('Wie wird "Extreme Fear" im Market-State gewertet?', 'Bullisch (+1) — konträr, als potenzieller Boden interpretiert', null, 'Sentiment (Fear & Greed)'),
('Wie wird "Extreme Greed" gewertet?', 'Bearisch (−1) — konträr, als potenzielle Spitze interpretiert', null, 'Sentiment (Fear & Greed)'),
('Wie oft wird der Fear & Greed Index aktualisiert?', 'Stündlich abgefragt, aber täglicher Index-Wert (alternative.me)', null, 'Sentiment (Fear & Greed)'),
-- 11. Trend-Staerke (ADX)
('Was misst der ADX — Richtung oder Stärke?', 'Nur Stärke, keine Richtung', null, 'Trend-Stärke (ADX)'),
('Unter welchem ADX-Wert gilt ein Trend als zu schwach für eine Richtungsaussage?', 'ADX < 20 (Wilder-Konvention)', null, 'Trend-Stärke (ADX)'),
('Wie wird die Richtung bei ausreichendem ADX bestimmt?', '+DI vs. −DI Vergleich', null, 'Trend-Stärke (ADX)'),
-- 12. Trend-Regime (EMA-Ribbon)
('Welche Bedingung muss für ein bullisches Trend-Regime erfüllt sein?', 'Preis > EMA50 > EMA200 (alle in gleicher Reihenfolge)', null, 'Trend-Regime (EMA-Ribbon)'),
('Warum reicht ein einzelner EMA-Crossover nicht für ein Signal?', 'NEXUS verlangt eine vollständige Ausrichtung von Preis, EMA50 und EMA200, kein isolierter Crossover', null, 'Trend-Regime (EMA-Ribbon)'),
('Wie viele EMAs nutzt das produktive NEXUS-Trend-Regime, und welche?', 'Genau zwei: EMA50 und EMA200 — keine EMA20 oder EMA13 darin (EMA20 wird nur beim OI-Preis-Faktor genutzt, nicht bei trend_regime)', 'Korrigiert 15.09.2026 -- Vorlage sprach faelschlich von "20/50/200".', 'Trend-Regime (EMA-Ribbon)'),
-- 13. VWAP-Position
('Wie breit ist das Neutralband um den VWAP?', '±0,15 %', null, 'VWAP-Position'),
('Warum gibt es ein Neutralband statt einer scharfen Schwelle?', 'Um Rauschen bei Preis ≈ VWAP nicht als Richtungssignal zu werten', null, 'VWAP-Position'),
-- 14. Basis / Perpetual Premium
('Ab welcher Abweichung gilt die Basis als "extrem"?', '±0,15 %', null, 'Basis / Perpetual Premium'),
('Warum wird eine hohe positive Basis bearisch gewertet?', 'Hohe Perpetual-Prämie = Long-Crowding-Risiko, analog zur Funding-Rate-Logik', null, 'Basis / Perpetual Premium'),
('Wie wurde der Basis-Schwellenwert kalibriert?', 'An der historisch beobachteten Normalbasis von ca. −0,03 % bis −0,06 %', null, 'Basis / Perpetual Premium'),
-- 15. Spot-Pressure
('Woher stammen taker_buy_vol/taker_sell_vol?', 'Direkt aus der Binance-Spot-Kline, exakt (keine Schätzung)', null, 'Spot-Pressure'),
('Warum wird bewusst nur Binance für Spot-Pressure genutzt?', 'Einzige öffentliche Spot-Route mit Taker-Buy/Sell-Split je Kerze (Bybit/OKX liefern das nicht)', null, 'Spot-Pressure'),
('Was zeigt taker_buy_sell_ratio an?', 'Verhältnis von aktivem Kauf- zu Verkaufsdruck auf dem Spot-Markt', null, 'Spot-Pressure'),
-- 16. On-Chain
('Welche On-Chain-Kennzahlen erfasst NEXUS?', 'SOPR, MVRV, Realized Price, LTH/STH-Aktivität, Miner-Flows, Stablecoin-Supply', null, 'On-Chain'),
('Wie oft werden On-Chain-Daten erfasst?', 'Einmal täglich (Datengranularität ist ohnehin täglich)', null, 'On-Chain'),
('Woher stammen die On-Chain-Daten?', 'BGeometrics/bitcoin-data.com, kostenloser Tier (10 Req/h, 15/Tag)', null, 'On-Chain'),
-- 17. Liquidationen
('Ab welchem Liquidations-vs-OI-Verhältnis gilt ein Capitulation-Pattern als möglich?', 'Über 3 % (in Kombination mit RSI < 30 und fallendem CVD)', null, 'Liquidationen'),
('Welche Seiten unterscheidet liquidation_events.side?', 'long, short, unknown', null, 'Liquidationen'),
('Über welches Zeitfenster wird die Liquidations-Intelligence für Capitulation berechnet?', 'Letzte 6 Stunden, in 15-Minuten-Buckets', null, 'Liquidationen'),
-- 18. Aggregation (Market-State-Score)
('Ab welchem Score gilt der Gesamtzustand als BULLISH?', 'Score ≥ 3', null, 'Aggregation (Market-State-Score)'),
('Ab welchem Score gilt der Gesamtzustand als BEARISH?', 'Score ≤ −3', null, 'Aggregation (Market-State-Score)'),
('Welche Mindest-Datenabdeckung ist nötig, damit der State nicht INSUFFICIENT_DATA ist?', '40 % der 14 Faktoren', null, 'Aggregation (Market-State-Score)'),
('Wie wird Confidence berechnet?', 'Data-Coverage × Einigkeit der verfügbaren Faktoren (|Score| relativ zur Anzahl verfügbarer Faktoren)', null, 'Aggregation (Market-State-Score)'),
('Warum zählt ein fehlender Faktor nicht als "neutral"?', 'Damit Datenlücken nicht als false Neutralität verschleiert werden — sie senken stattdessen die Coverage', null, 'Aggregation (Market-State-Score)'),
-- 19. Patterns
('Welche 3 Bedingungen ergeben "Bullish Confirmation"?', 'Struktur, CVD und OI-Preis-Faktor alle gleichzeitig bullisch (+1)', null, 'Patterns'),
('Was kennzeichnet "Fragile Bullish"?', 'Struktur bullisch, aber CVD fällt — eine Divergenz-Warnung', null, 'Patterns'),
('Was kennzeichnet "Distribution Warning"?', 'Preis nahe 20-Perioden-Hoch, aber CVD fällt', null, 'Patterns'),
('Was löst "Short Squeeze" als Pattern aus?', 'Positioning-Divergence-Engine erkennt Retail short + Top-Trader long + steigenden OI', null, 'Patterns'),
-- Bonus: MTF-Alignment & Risk-Level
('Wie werden die Zeitrahmen 1H/4H/1D im MTF-Alignment gewichtet?', '1H = 0,2 / 4H = 0,35 / 1D = 0,45 (höhere Zeitrahmen zählen stärker)', null, 'MTF-Alignment & Risk-Level'),
('Ab welchem MTF-Alignment-Wert gilt die Ausrichtung als "niedrig" (Risikofaktor)?', 'Unter 60 %', null, 'MTF-Alignment & Risk-Level'),
('Welche Risikoquellen können das Risk-Level erhöhen?', 'Warnende Patterns, niedriges MTF-Alignment, Funding-Crowding, Basis-Crowding, erhöhte Volatilität (ATR > 1,0 % vom Preis) — 5 einzelne Quellen', 'Korrigiert 15.09.2026: Funding- und Basis-Crowding sind im Code zwei GETRENNTE Risikofaktoren (funding_crowding, basis_crowding), nicht ein gebuendelter Punkt -- macht 5 statt 4.', 'MTF-Alignment & Risk-Level'),
('Ab wie vielen Risikofaktoren gilt Risk-Level als HIGH?', 'Ab 3 gleichzeitig erfüllten Risikofaktoren', null, 'MTF-Alignment & Risk-Level');
