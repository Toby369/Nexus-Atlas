-- Exportiert aus supabase_migrations.schema_migrations (20260907190731 add_ema_100_800_to_market_features)

alter table public.market_features
  add column if not exists ema_100 double precision,
  add column if not exists ema_800 double precision;

comment on column public.market_features.ema_100 is 'EMA(100) des Schlusskurses -- Trade-Debate-Kachel (07.09.2026), ergaenzt EMA20/50/200.';
comment on column public.market_features.ema_800 is 'EMA(800) des Schlusskurses -- Nischen-/Community-Heuristik als Makro-Trendfilter auf kleineren Timeframes, kein etablierter institutioneller Standard (siehe Recherche 07.09.2026). Braucht mind. 800 Kerzen Vorlauf zum Seeden -- auf 1D-Basis (aktuell 733 Tageskerzen) faellt der Wert vorerst noch null aus, auf 1h/4h ausreichend Historie vorhanden.';
