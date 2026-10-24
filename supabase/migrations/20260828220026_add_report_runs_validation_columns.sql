-- Exportiert aus supabase_migrations.schema_migrations (20260828220026 add_report_runs_validation_columns)

-- Phase 2, Punkt 1: regelbasierte Post-Validation der AI-Report-Texte gegen
-- die Rohdaten (siehe lib/reportValidation.ts). Bewusst getrennt von der
-- bestehenden "status"-Spalte (ok/error -- "hat der API-Call funktioniert"):
-- validation_status beantwortet eine andere Frage ("stimmt der Text mit
-- den Zahlen ueberein, die das Modell bekommen hat"), darf also NICHT die
-- bestehende Bedeutung von status ueberschreiben oder verschieben (u.a.
-- liest getLatestSuccessfulRun() in app/api/reports/run/route.ts weiterhin
-- status='ok' fuer die Master-Report-Verkettung).
--
-- NULL (Default, fuer alle bestehenden Zeilen) = nicht validiert / nicht
-- anwendbar (z.B. status='error'-Laeufe werden gar nicht erst validiert).
alter table public.report_runs
  add column if not exists validation_status text,
  add column if not exists validation_notes jsonb;
