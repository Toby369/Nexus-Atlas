-- Exportiert aus supabase_migrations.schema_migrations (20260915134055 seed_quiz_cards_welz_salomon)

-- Welz (Trading-Psychologie) und Salomon (Chartanalyse) Lernkarten --
-- abgeleitet aus den im Briefing gegebenen Prinzipien-/Konzeptlisten
-- (nicht aus den Originalwerken zitiert, da nur die Zusammenfassung
-- vorliegt -- explanation weist das jeweils aus). Kleinerer Umfang als
-- das NEXUS-Mechanik-Set, siehe Umsetzungsplan Entscheidung 6.
insert into quiz_cards (question, answer, explanation, category) values
-- Welz -- Trading-Psychologie (9 Prinzipien)
('Welz-Prinzip: Was ist wichtiger, Psyche oder Strategie?', 'Psyche > Strategie — die beste Strategie scheitert an fehlender psychologischer Disziplin, nicht an fehlendem Wissen', 'Abgeleitet aus der Welz-Prinzipienliste im Briefing, nicht Originalzitat.', 'Welz'),
('Wie sollte man Verluste beim Trading einordnen (Welz)?', 'Als Betriebskosten des Systems, kein persönliches Versagen', 'Abgeleitet aus der Welz-Prinzipienliste im Briefing, nicht Originalzitat.', 'Welz'),
('Welche Trading-Journal-Regel gilt nach Welz?', 'Jeder Trade wird dokumentiert, unabhängig vom Ausgang', 'Abgeleitet aus der Welz-Prinzipienliste im Briefing, nicht Originalzitat.', 'Welz'),
('Warum wirkt eine kleinere Positionsgrösse als Emotionskontrolle?', 'Kleinere Positionen reduzieren emotionalen Druck und ermöglichen rationale Entscheidungen', 'Abgeleitet aus der Welz-Prinzipienliste im Briefing, nicht Originalzitat.', 'Welz'),
('Wonach sollte ein Trade bewertet werden — Prozess oder Ergebnis?', 'Prozess: ob die Regeln befolgt wurden, nicht ob der Trade gewann', 'Abgeleitet aus der Welz-Prinzipienliste im Briefing, nicht Originalzitat.', 'Welz'),
('Was meint "statistisches Denken" bei Welz?', 'Einzelne Trades sind bedeutungslos, nur die Serie über viele Trades zählt', 'Abgeleitet aus der Welz-Prinzipienliste im Briefing, nicht Originalzitat.', 'Welz'),
('Was ist Revenge-Trading?', 'Nach einem Verlust sofort "zurückholen wollen" — ein Warnsignal, kein Handelsplan', 'Abgeleitet aus der Welz-Prinzipienliste im Briefing, nicht Originalzitat.', 'Welz'),
('Was ist Confirmation Bias?', 'Die Tendenz, nur Informationen zu suchen, die die eigene Position bestätigen', 'Abgeleitet aus der Welz-Prinzipienliste im Briefing, nicht Originalzitat.', 'Welz'),
('Welche 3 Trader-Entwicklungsphasen nennt Welz?', 'Unbewusste Inkompetenz, bewusste Inkompetenz, bewusste Kompetenz (auf dem Weg zur unbewussten Kompetenz)', 'Abgeleitet aus der Welz-Prinzipienliste im Briefing, nicht Originalzitat.', 'Welz'),
-- Salomon -- Trendanalyse
('Was ist der Unterschied zwischen Retracement und Reversal (Salomon)?', 'Retracement ist eine temporäre Gegenbewegung im Trend, Reversal ein echter Trendwechsel', 'Abgeleitet aus der Salomon-Konzeptliste im Briefing, nicht Originalzitat.', 'Salomon'),
('Was besagt Salomons Multi-Timeframe-Konfluenz-Prinzip?', 'Höhere Zeitrahmen dominieren die Bewertung', 'Abgeleitet aus der Salomon-Konzeptliste im Briefing, nicht Originalzitat.', 'Salomon'),
-- Salomon -- Phasenmodell
('Welche 4 Phasen umfasst Salomons zyklisches Phasenmodell?', 'Akkumulation, Markup, Distribution, Markdown', 'Abgeleitet aus der Salomon-Konzeptliste im Briefing, nicht Originalzitat.', 'Salomon'),
('Was kennzeichnet die Markup-Phase?', 'Gesunder Aufwärtstrend — entspricht in NEXUS dem Pattern "Bullish Confirmation"', 'Abgeleitet aus der Salomon-Konzeptliste im Briefing, nicht Originalzitat.', 'Salomon'),
('Was kennzeichnet die Distributionsphase?', 'Übergang von Markup zu Markdown — entspricht in NEXUS dem Pattern "Distribution Warning"', 'Abgeleitet aus der Salomon-Konzeptliste im Briefing, nicht Originalzitat.', 'Salomon'),
('Was kennzeichnet das Ende der Markdown-Phase?', 'Kapitulation, möglicher Boden — entspricht in NEXUS dem Pattern "Capitulation"', 'Abgeleitet aus der Salomon-Konzeptliste im Briefing, nicht Originalzitat.', 'Salomon'),
-- Salomon -- Candlestick-Bibliothek (gruppiert)
('Welche Candlestick-Muster gelten klassisch als bullische Umkehrsignale?', 'Hammer, Inverted Hammer (bullisches) Engulfing, Three White Soldiers', 'Abgeleitet aus der Salomon-Konzeptliste im Briefing, nicht Originalzitat.', 'Salomon'),
('Welche Candlestick-Muster gelten klassisch als bärische Umkehrsignale?', 'Shooting Star, Evening Star, (bärisches) Engulfing', 'Abgeleitet aus der Salomon-Konzeptliste im Briefing, nicht Originalzitat.', 'Salomon'),
('Welche Candlestick-Muster zeigen Unentschlossenheit statt klarer Richtung an?', 'Doji, Spinning Top', 'Abgeleitet aus der Salomon-Konzeptliste im Briefing, nicht Originalzitat.', 'Salomon'),
('Was zeigt ein Pin Bar / Harami typischerweise an?', 'Eine mögliche Ablehnung des vorherigen Kursniveaus bzw. nachlassende Trenddynamik', 'Abgeleitet aus der Salomon-Konzeptliste im Briefing, nicht Originalzitat.', 'Salomon'),
-- Salomon <-> NEXUS Parallele
('Wie deckt sich Salomons Phasenmodell mit NEXUS-Patterns?', 'Markup≈Bullish Confirmation, beginnende Schwäche≈Fragile Bullish, Distribution≈Distribution Warning, Markdown-Ende≈Capitulation', 'Kern der Salomon-Interpretationsschicht (lib/salomonInterpretation.ts) -- Mapping-Tabelle aus dem Briefing.', 'Salomon');
