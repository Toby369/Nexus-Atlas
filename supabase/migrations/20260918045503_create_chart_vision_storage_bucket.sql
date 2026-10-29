-- Exportiert aus supabase_migrations.schema_migrations (20260918045503 create_chart_vision_storage_bucket)

-- Chart-Vision (Umsetzungsplan Phase 3): erste Upload-Infrastruktur in
-- diesem Projekt. Privater Bucket -- der Client spricht Storage nie direkt
-- an, ausschliesslich die API-Route (app/api/chart-vision/generate) laedt
-- ueber getSupabaseAdmin() (service-role, umgeht RLS ohnehin) hoch und
-- erzeugt Signed URLs zum Anzeigen. Deshalb KEINE storage.objects-Policy
-- noetig -- konsistent mit dem Rest der App: alle Schreibzugriffe laufen
-- ausschliesslich ueber service-role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chart-vision-screenshots',
  'chart-vision-screenshots',
  false,
  6291456, -- 6 MB harte Obergrenze (Server lehnt vorher schon frueher ab, siehe API-Route)
  array['image/jpeg', 'image/png']
)
on conflict (id) do nothing;
