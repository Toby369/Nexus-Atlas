-- Verweildauer je Reiter (Toby 15.11.2026: "wie oft/lange?"). Ein Eintrag pro
-- Besuch eines Reiters ("dwell:lage" + Sekunden), nur ab 5 s Sichtbarkeit --
-- wenige Zeilen pro Tag, kaum Speicher und Logs. Bestehende Tabelle, Rechte
-- unveraendert (nur service_role).
alter table public.tile_usage add column if not exists seconds integer
  check (seconds is null or (seconds between 1 and 7200));
alter table public.tile_usage drop constraint if exists tile_usage_item_check;
alter table public.tile_usage add constraint tile_usage_item_check
  check (item ~ '^(tab|tile|step|dwell):[a-z0-9-]{1,40}$');
