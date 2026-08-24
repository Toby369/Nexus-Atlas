# NEXUS Atlas

Persönliches BTC/USDT-Perpetual-Futures-Market-Intelligence-Dashboard. Ziel
ist nicht ein einfaches Kurs-Dashboard, sondern zu erkennen wie
Marktteilnehmer positioniert sind, wo Divergenzen entstehen und was den
Markt als Nächstes bewegen könnte. Keine Anlageberatung, rein
informativ/analytisch.

## Architektur

```
Exchange-APIs (Bybit/Binance/Bitunix/Pionex, Farside)
   → Supabase Edge Functions (Deno, cron-getriggert via pg_cron/pg_net)
   → Supabase Postgres (öffentlich lesbare Tabellen, RLS "Public read access")
   → Next.js Server Components (page.tsx liest via Supabase JS)
   → Client-Components ("use client", pollen alle 30-60s für Live-Updates)
   → Dashboard (Vercel)
```

Es ist kein eigenes Backend/Server nötig — die Datensammlung läuft komplett
innerhalb von Supabase (Edge Functions + pg_cron + pg_net), die App selbst
ist rein lesend.

## Edge Functions

| Function | Cron | Zweck |
|---|---|---|
| `collect-btc` | `*/5 * * * *` | Preis/Mark/Index/OI/Funding je Börse (Bybit, Binance, Bitunix, Pionex) + regelbasierte Markteinschätzung |
| `collect-positioning` | `*/5 * * * *` | Long/Short-Ratios, Top-Trader-Daten, Taker-Flow (Binance+Bybit) + Divergenz-Engine |
| `collect-liquidations` | `*/5 * * * *` | Liquidations-Sampling via WebSocket (Binance+Bybit, ~25s Capture-Fenster je Lauf — keine lückenlose Erfassung) |
| `collect-etf-flows` | `0 */4 * * *` | US-Spot-BTC-ETF-Nettoflows (Farside Investors, T+1) |
| `nexus-news-collector` | `*/15 * * * *` | RSS-News: Fed, BLS, SEC, Google News (Makro/Treasury) |
| `nexus-news-analyst` | `2-59/15 * * * *` | Bewertet News neu: Kategorie, Impact-Score, Richtung |

Alle Tabellen haben RLS-Policy "Public read access" (`SELECT using (true)`),
Schreibzugriff nur über den Service-Role-Key der Edge Functions.

## Dashboard-Kacheln

- **Live-Preis** — Preis/Mark/Index/Funding/OI, Zeitreihen, Börsenvergleich
  mit Ausreißer-Erkennung
- **Positioning Intelligence** — Retail vs. Top Trader (Binance+Bybit),
  Taker-Flow, NEXUS-Divergenz-Assessment
- **Liquidationen** — Größe, Richtung, Häufung (Cascade vs. vereinzelt),
  transparent als Stichprobe gekennzeichnet
- **ETF-Flows & Makro** — Tages-/5-Tage-Flow, Synthese aus Flow-Richtung +
  Makro-News-Ton
- **News Risk** — nur High-Impact-News (`is_market_moving=true`), max. 5,
  letzte 72h

## Lokale Entwicklung

```bash
npm install
npm run dev
```

`.env.local` enthält die öffentliche Supabase-URL und den (öffentlichen)
anon-Key — beides ist bewusst clientseitig sichtbar und kein Geheimnis.
Vor jedem Deploy lokal `npx tsc --noEmit`, `npx next build`, `npx eslint .`
sauber durchlaufen lassen.

## Deployment (Vercel)

1. Repo mit Vercel verknüpfen (Projektname `nexus-atlas`)
2. Environment Variables in Vercel setzen (siehe `.env.example`)
3. Deploy — kein weiterer Schritt nötig, die Datenpipeline läuft unabhängig
   vom Frontend-Deployment in Supabase

## Prinzipien

- Keine kostenpflichtigen APIs ohne Rücksprache
- Keine isolierten Signale aus einer einzelnen Kennzahl — immer im Kontext
  mehrerer Datenpunkte
- Datenqualität immer transparent machen (Quelle, Stichprobe vs.
  vollständig, Confidence)
- Bei API-Ausfall: Quelle als "nicht verfügbar" markieren, nicht die ganze
  App blockieren

## Bewusst zurückgestellt

- Whale-/Smart-Money-Intelligence (Phase 4-9 der Positioning-Roadmap) —
  bräuchte kostenpflichtige On-Chain-APIs oder eine eigene
  Adress-Label-Datenbank
- AI-Router (`lib/ai/*`) — Fundament steht, aber ohne aktive API-Keys und
  ohne UI-Anbindung, um das bestehende regelbasierte Dashboard nicht zu
  ersetzen
