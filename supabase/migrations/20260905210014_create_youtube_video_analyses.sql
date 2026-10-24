-- Exportiert aus supabase_migrations.schema_migrations (20260905210014 create_youtube_video_analyses)

create table public.youtube_video_analyses (
  id bigint generated always as identity primary key,
  video_id text not null unique,
  channel_title text,
  title text not null,
  published_at timestamptz not null,
  url text not null,
  generated_at timestamptz not null default now(),
  model text,
  result jsonb,
  status text not null check (status = any (array['ok'::text, 'error'::text])),
  error text
);

comment on table public.youtube_video_analyses is
  'Thema KI, "Krypto-YouTube-Monitor" (05.09.2026): findet neue BTC/Krypto-relevante YouTube-Videos (YouTube Data API v3, kostenloses Tageskontingent) und laesst sie per Gemini direkt per Video-URL analysieren (Google-Free-Tier, Flash-Modelle, siehe lib/ai/youtubeVideoAnalysis.ts) -- bewusst NICHT ueber den generischen AI-Router (lib/ai/router.ts), da Video-Input (file_data/file_uri) kein reiner Text-Prompt ist. video_id ist eindeutig, damit dasselbe Video nicht doppelt analysiert wird. Nur ueber POST /api/youtube-monitor/generate geschrieben (service_role), oeffentlich lesbar wie alle anderen Marktdaten-Tabellen.';

alter table public.youtube_video_analyses enable row level security;

create policy "Public read access" on public.youtube_video_analyses
  for select to public using (true);
