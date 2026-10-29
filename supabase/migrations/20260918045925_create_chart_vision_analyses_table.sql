-- Exportiert aus supabase_migrations.schema_migrations (20260918045925 create_chart_vision_analyses_table)

-- Chart-Vision (Umsetzungsplan Phase 3): Speichert Toby's hochgeladene
-- TradingView-Screenshots (LSOB-Zonen + handgezeichnete Trendlinien) samt
-- der strukturierten Gemini-Analyse. Ein Screenshot-Upload ist ein
-- unabhaengiges, nutzerausgeloestes Ereignis ohne natuerlichen Dedup-Key --
-- deshalb Plain-Insert-Muster wie custom_query_runs, nicht Upsert wie
-- youtube_video_analyses (dort video_id als Dedup-Key vorhanden).
--
-- RLS: BEWUSSTE ABWEICHUNG von der sonst durchgaengigen "Public read
-- access"(SELECT true)-Konvention dieser App -- hier KEINE anon-SELECT-
-- Policy. Begruendung: die Kachel braucht ohnehin getSupabaseAdmin()
-- serverseitig, um Signed URLs fuer die privaten Screenshots zu erzeugen
-- (der Storage-Bucket hat keine anon-Policy) -- es gibt also keinen
-- Code-Pfad, der eine anon-SELECT-Policy auf dieser Tabelle braeuchte.
-- Persoenliche Trading-Chart-Screenshots sind sensibler als z.B.
-- Liquidations-Events; RLS hier strenger zu halten kostet nichts.
create table if not exists chart_vision_analyses (
  id bigint generated always as identity primary key,
  generated_at timestamptz not null default now(),
  storage_path text not null,
  image_mime_type text not null,
  note text,
  provider text,
  model text,
  result jsonb,
  status text not null,
  error text
);

alter table chart_vision_analyses enable row level security;
