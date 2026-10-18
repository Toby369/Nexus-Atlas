# Termin-Basis (≈ CME-Basis) — Umsetzung 17.10.2026

**Freigegeben (Toby, 17.10.2026):** CME-Basis als Kontext in Nexus, Quelle Deribit, Speicher
unter 500 MB halten.

## Was

Annualisierte Prämie des vordersten Deribit-Futures (≥ 30 Tage Restlaufzeit) gegenüber dem
Deribit-Index. Näherung für die CME-Basis (echte CME-Daten gibt es nicht kostenlos über eine
offizielle Schnittstelle). Anzeige als Abschnitt „Termin-Basis (≈ CME)“ in der Kachel
„ETF-Flows & Makro“: Wert, Stufe, Veränderung über 7 Tage, 45-Tage-Verlauf und ein Hinweis,
wenn Basis (−2 Pp in 7 Tagen) und ETF-Flows (Summe 5 Handelstage) gemeinsam fallen.
**Nicht** Teil der Gesamteinschätzung, bis ein Backtest einen Nutzen zeigt.

Stufen (Faustregeln, `lib/termBasis.ts`): < 0 % negativ · 0–5 % schwach · 5–10 % normal ·
10–15 % erhöht · ≥ 15 % überhitzt.

## Daten

- Tabelle `term_basis_snapshots` (Migration `create_term_basis_snapshots`, Public read).
- Edge Function `collect-term-basis` (Quellcode: `supabase/functions/collect-term-basis/`),
  Cron `collect-term-basis-hourly` (`11 * * * *`, Job 41).
- Backfill 17.10.2026: `?backfill=1500` → 1'500 Tageswerte ab 07.09.2022, 59 Kontrakte
  (ältere Monatskontrakte über ihre Namen rekonstruiert, Index-Näherung BTC-PERPETUAL,
  `source = deribit_backfill`).

| Jahr | Tage | Ø p.a. | Min | Max |
|---|---|---|---|---|
| 2022 (ab Sep.) | 116 | −1,9 % | −12,5 % | 2,2 % |
| 2023 | 365 | 5,2 % | −3,5 % | 20,9 % |
| 2024 | 366 | 11,7 % | 3,7 % | 32,7 % |
| 2025 | 365 | 6,1 % | 2,3 % | 15,1 % |
| 2026 (bis 17.10.) | 288 | 2,9 % | 0,1 % | 6,3 % |

## Speicher

- Stand 17.10.2026: DB 413 MB von 500 MB.
- Neue Tabelle: 0,5 MB nach Backfill, danach ~24 Zeilen/Tag ≈ 2–3 MB pro Jahr.
- Grösster laufender Zuwachs kommt aus den 5-Minuten-Snapshots (market_snapshots,
  candles, positioning_*, orderbook_snapshots, macro_snapshots): zusammen rund 2 MB pro Tag
  (Schätzung aus den Zeilen der letzten 7 Tage). Ohne Aufbewahrungsregel ist die Grenze in
  etwa 6 Wochen erreicht. Vorschlag siehe Chat 17.10.2026; Entscheid bei Toby.

## SQL (zur Nachvollziehbarkeit, bereits ausgeführt)

```sql
create table public.term_basis_snapshots (
  id bigserial primary key,
  timestamp_utc timestamptz not null,
  instrument text not null,
  expiry_utc timestamptz not null,
  days_to_expiry numeric not null,
  future_price numeric not null,
  index_price numeric not null,
  basis_pct numeric not null,
  basis_annualized_pct numeric not null,
  source text not null default 'deribit',
  created_at timestamptz not null default now(),
  unique (timestamp_utc, instrument)
);
create index term_basis_snapshots_ts_idx on public.term_basis_snapshots (timestamp_utc desc);
alter table public.term_basis_snapshots enable row level security;
create policy "Public read access" on public.term_basis_snapshots for select using (true);

select cron.schedule('collect-term-basis-hourly', '11 * * * *', $$
  select net.http_post(
    url := 'https://cpktesxmbqrzpsurntul.supabase.co/functions/v1/collect-term-basis',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 45000
  );
$$);
```
