-- Exportiert aus supabase_migrations.schema_migrations (20261002204405 add_1w_interval_to_candles_and_market_features)


-- Nutzer-Wunsch (02.10.2026): MTF-Ampel zeigt 1W bisher immer als "keine
-- Daten", weil collect-candles keine Wochenkerzen sammelt (interval-CHECKs
-- erlaubten "1w" bisher gar nicht). Beide Constraints erweitert, damit der
-- Collector ab jetzt auch "1w" schreiben kann -- candles bekommt zusaetzlich
-- 1w-Rohkerzen, market_features zusaetzlich die daraus berechneten
-- Indikatoren (structure_trend/adx_14 fuer die MTF-Ampel).
alter table candles drop constraint candles_interval_check;
alter table candles add constraint candles_interval_check
  check (interval = any (array['1m','5m','15m','1h','4h','1d','1w']));

alter table market_features drop constraint market_features_interval_check;
alter table market_features add constraint market_features_interval_check
  check (interval = any (array['15m','1h','4h','1d','1w']));
