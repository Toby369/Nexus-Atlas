-- Exportiert aus supabase_migrations.schema_migrations (20260917194703 add_pattern_key_to_quiz_cards)

-- Nutzer-Wunsch: Kerzenmuster-Lernkarten mit visueller Illustration statt
-- reinem Text (Muster sind per Definition eine Form, kein Fliesstext-
-- Konzept). pattern_key ist ein optionaler Lookup-Schluessel, den das
-- Frontend (components/CandlestickPatternIllustration.tsx) auf eine feste,
-- im Code hinterlegte SVG-Skizze abbildet -- kein Bild-Upload/Speicher
-- noetig, bleibt kostenlos und deterministisch. NULL fuer alle bisherigen/
-- eigenen Karten (kein Bruch bestehender Daten).
alter table public.quiz_cards add column pattern_key text null;
