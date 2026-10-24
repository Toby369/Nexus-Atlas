-- Exportiert aus supabase_migrations.schema_migrations (20261014113344 checklist_runs_allow_orderflow)

-- 2026-10-14: neues Lernen-Modul "orderflow" (Orderflow-4-Schritte-Checkliste).
alter table public.checklist_runs drop constraint checklist_runs_module_check;
alter table public.checklist_runs add constraint checklist_runs_module_check
  check (module = any (array['welz'::text, 'salomon'::text, 'mein_system'::text, 'orderflow'::text]));
