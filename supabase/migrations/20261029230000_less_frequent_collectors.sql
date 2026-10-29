-- Log-Kontingent (Toby 29.10.2026): Supabase Free-Plan 1 GB Logs/Monat,
-- Hochrechnung ~0,85 GB. ~80 % der Log-Eintraege sind REST-Anfragen der
-- Sammler (edge_logs). Zwei Ablaeufe ohne Echtzeit-Bedarf laufen seltener:
--  - collect-orderbook: 5 -> 15 Min (Orderbuch-Waende im Archiv; die
--    Marktlage toleriert Orderbuch-Daten bis 30 Min, compute-market-state).
--  - divergence-radar-scheduler: 15 -> 60 Min (Divergenz-Radar im Archiv,
--    Eskalation/Rueckblick lesen nur den letzten Snapshot).
-- collect-spot-volume-profile bleibt bei 5 Min: max. 10'000 Trades je Lauf,
-- in 15 Min wuerde der Rueckstand in unruhigen Phasen wachsen.
do $$
declare v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'collect-orderbook-every-5-min';
  if v_cmd is not null then
    perform cron.unschedule('collect-orderbook-every-5-min');
    perform cron.schedule('collect-orderbook-every-15-min', '1-59/15 * * * *', v_cmd);
  end if;

  select command into v_cmd from cron.job where jobname = 'divergence-radar-scheduler-every-15-min';
  if v_cmd is not null then
    perform cron.unschedule('divergence-radar-scheduler-every-15-min');
    perform cron.schedule('divergence-radar-scheduler-hourly', '9 * * * *', v_cmd);
  end if;
end $$;
