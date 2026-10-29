-- Exportiert aus supabase_migrations.schema_migrations (20260915134126 seed_knowledge_base)

insert into knowledge_base (module, section, title, content, source, sort_order) values
-- Welz
('welz', 'Prinzipien', 'Psyche > Strategie', 'Die beste Strategie scheitert an fehlender psychologischer Disziplin, nicht an fehlendem Wissen.', 'Norman Welz -- Trading-Psychologie (Briefing-Zusammenfassung)', 1),
('welz', 'Prinzipien', 'Verlustakzeptanz', 'Verluste sind Betriebskosten des Systems, kein persönliches Versagen.', 'Norman Welz -- Trading-Psychologie (Briefing-Zusammenfassung)', 2),
('welz', 'Prinzipien', 'Trading-Journal-Pflicht', 'Jeder Trade wird dokumentiert, unabhängig vom Ausgang.', 'Norman Welz -- Trading-Psychologie (Briefing-Zusammenfassung)', 3),
('welz', 'Prinzipien', 'Positionsgrösse als Emotionskontrolle', 'Kleinere Positionen reduzieren emotionalen Druck und ermöglichen rationale Entscheidungen.', 'Norman Welz -- Trading-Psychologie (Briefing-Zusammenfassung)', 4),
('welz', 'Prinzipien', 'Prozess statt Ergebnis', 'Bewertung erfolgt danach, ob die Regeln befolgt wurden, nicht danach, ob der Trade gewann.', 'Norman Welz -- Trading-Psychologie (Briefing-Zusammenfassung)', 5),
('welz', 'Prinzipien', 'Statistisches Denken', 'Einzelne Trades sind bedeutungslos, nur die Serie über viele Trades zählt.', 'Norman Welz -- Trading-Psychologie (Briefing-Zusammenfassung)', 6),
('welz', 'Prinzipien', 'Revenge-Trading-Muster', 'Nach einem Verlust sofort "zurückholen wollen" ist ein Warnsignal, kein Handelsplan.', 'Norman Welz -- Trading-Psychologie (Briefing-Zusammenfassung)', 7),
('welz', 'Prinzipien', 'Confirmation Bias', 'Die Tendenz, nur Informationen zu suchen, die die eigene Position bestätigen.', 'Norman Welz -- Trading-Psychologie (Briefing-Zusammenfassung)', 8),
('welz', 'Prinzipien', '3 Trader-Entwicklungsphasen', 'Unbewusste Inkompetenz -> bewusste Inkompetenz -> bewusste Kompetenz auf dem Weg zur unbewussten Kompetenz.', 'Norman Welz -- Trading-Psychologie (Briefing-Zusammenfassung)', 9),
('welz', 'Toby-Baustellen', 'Diagnostiziertes Muster', 'Liest den Markt gut, überschreibt aber im Live-Moment das eigene System -- ein Vertrauens-/Convictionproblem, kein analytisches.', 'Frühere Arbeit mit Claude (Chat)', 10),
('welz', 'Toby-Baustellen', 'Aktueller Fokus', 'Pattern-Bestätigungs-Disziplin, Vermeidung von "Heldentrade-Denken".', 'Frühere Arbeit mit Claude (Chat)', 11),
('welz', 'Toby-Baustellen', 'Atemtechnik im Entry-Moment', 'Nadi-Shodhana-Atmung als Technik im Moment des Entry-Impulses.', 'Frühere Arbeit mit Claude (Chat)', 12),
('welz', 'Toby-Baustellen', 'Pre-Session-Planung', '"if X then Y"-Szenarioplanung vor Sessionbeginn statt reaktivem Chart-Beobachten.', 'Frühere Arbeit mit Claude (Chat)', 13),
-- Salomon
('salomon', 'Trendanalyse', 'HH/HL/LH/LL', 'Higher High, Higher Low, Lower High, Lower Low -- das Grundvokabular der Struktur.', 'Stefan Salomon -- Chartanalyse-Lehrbuch (Briefing-Zusammenfassung)', 1),
('salomon', 'Trendanalyse', 'Retracement vs. Reversal', 'Retracement: temporäre Gegenbewegung im Trend. Reversal: echter Trendwechsel.', 'Stefan Salomon -- Chartanalyse-Lehrbuch (Briefing-Zusammenfassung)', 2),
('salomon', 'Trendanalyse', 'Multi-Timeframe-Konfluenz', 'Höhere Zeitrahmen dominieren die Bewertung -- entspricht NEXUS' || chr(39) || 's MTF-Alignment-Gewichtung (1H=0,2/4H=0,35/1D=0,45).', 'Stefan Salomon -- Chartanalyse-Lehrbuch (Briefing-Zusammenfassung)', 3),
('salomon', 'Phasenmodell', 'Akkumulation -> Markup -> Distribution -> Markdown', 'Zyklisches Phasenmodell, jede Phase hat charakteristische Volumen-/Orderflow-Signaturen.', 'Stefan Salomon -- Chartanalyse-Lehrbuch (Briefing-Zusammenfassung)', 4),
('salomon', 'Candlestick-Bibliothek', 'Bullische Umkehrmuster', 'Hammer, Inverted Hammer, (bullisches) Engulfing, Three White Soldiers.', 'Stefan Salomon -- Chartanalyse-Lehrbuch (Briefing-Zusammenfassung)', 5),
('salomon', 'Candlestick-Bibliothek', 'Bärische Umkehrmuster', 'Shooting Star, Evening Star, (bärisches) Engulfing.', 'Stefan Salomon -- Chartanalyse-Lehrbuch (Briefing-Zusammenfassung)', 6),
('salomon', 'Candlestick-Bibliothek', 'Unentschlossenheits-Muster', 'Doji, Spinning Top, Pin Bar, Harami.', 'Stefan Salomon -- Chartanalyse-Lehrbuch (Briefing-Zusammenfassung)', 7),
('salomon', 'Salomon-Interpretationsschicht', 'Mapping-Tabelle NEXUS-Signal -> Salomon-Phase', 'structure=bullish+cvd=rising+oi_price=bullish -> Markup (gesund). Pattern "Fragile Bullish" -> beginnende Distribution innerhalb Markup. Pattern "Distribution Warning" -> Distribution. Pattern "Capitulation" -> Ende Markdown/möglicher Boden. MTF-Alignment > 80% über 1H/4H/1D -> hohe Konfluenz nach Salomon. Technisch umgesetzt in lib/salomonInterpretation.ts (regelbasiert, kein LLM-Call).', 'Briefing Anhang 3, umgesetzt 15.09.2026', 8),
-- Mein System
('mein_system', 'Multi-Timeframe-Flow', 'Salomon-Logik Entry-Flow', '4H-Breakout -> 1H-Retest -> 15m-Entry.', 'Mein Trading System v1.3 (Toby, gemeinsam mit Claude erarbeitet)', 1),
('mein_system', 'EMA-Framework', 'EMA 13/50/200', 'Genutzt auf allen Zeitrahmen; D13 ist der aktive Entry-Filter (W13 entfernt). Bewusst NICHT identisch mit dem produktiven NEXUS-Trend-Regime (EMA50/200, kein EMA13) -- siehe Checkliste unten fuer die Live-Anzeige beider Werte nebeneinander.', 'Mein Trading System v1.3 (Toby, gemeinsam mit Claude erarbeitet)', 2),
('mein_system', 'Keylevel-Methodik', 'Kerzenkörper und Dochte', 'Kerzenkörper definieren horizontale Levels, Dochte definieren Pivot-Extreme/Trendlinien.', 'Mein Trading System v1.3 (Toby, gemeinsam mit Claude erarbeitet)', 3),
('mein_system', 'Divergenzanalyse', '4 Divergenztypen', 'Klassisch/versteckt x bullisch/bearisch, geprüft auf RSI, MACD, StochRSI.', 'Mein Trading System v1.3 (Toby, gemeinsam mit Claude erarbeitet)', 4),
('mein_system', 'Take-Profit-Systeme', 'TP-Methoden', 'Struktur-basierte Ziele, Fibonacci-Extensions, Partial-TPs, Trailing Stops (höchste Priorität).', 'Mein Trading System v1.3 (Toby, gemeinsam mit Claude erarbeitet)', 5),
('mein_system', 'Rally-Nachhaltigkeit', 'Checkliste', 'OI-Delta vs. Preis-Delta, Funding-Schwelle >0,05%/8h, Liquidations-Heatmap, Salomon-Phasenmodell, Keylevel-/EMA-Check, RSI/StochRSI-Divergenz. Funding- und OI-Delta-Punkte sind in NEXUS live gekoppelt (identische Schwellenwerte wie compute-market-state), siehe /lernen.', 'Mein Trading System v1.3 (Toby, gemeinsam mit Claude erarbeitet)', 6);
