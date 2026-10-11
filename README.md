# NEXUS Atlas

Persönliches BTC/USDT-Perpetual-Futures-Market-Intelligence-Dashboard. Ziel
ist nicht ein einfaches Kurs-Dashboard, sondern zu erkennen wie
Marktteilnehmer positioniert sind, wo Divergenzen entstehen und was den
Markt als Nächstes bewegen könnte. Keine Anlageberatung, rein
informativ/analytisch.

## Architektur

```
Exchange-APIs (Bybit/Binance/Bitunix/Pionex), SoSoValue (ETF-Flows)
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
| `collect-etf-flows` | `0 */4 * * *` | US-Spot-BTC-ETF-Nettoflows (SoSoValue-API, vormals Farside; T+1) |
| `nexus-news-collector` | `*/15 * * * *` | RSS-News: Fed, BLS, SEC, Google News (Makro/Treasury) |
| `nexus-news-analyst` | `2-59/15 * * * *` | Bewertet News neu: Kategorie, Impact-Score, Richtung |

Alle Tabellen haben RLS-Policy "Public read access" (`SELECT using (true)`),
Schreibzugriff nur über den Service-Role-Key der Edge Functions.

## Aufbau der App

| Seite | Inhalt |
|---|---|
| `/` Dashboard | Fest oben: Zeitraum-Auswahl und das Lagebild (`HeroHeader`: Gesamteinschätzung, Fazit-Satz, Setup-/Regime-Score, MTF-Ampel, Marktphase, KI-Einordnung; Details aufklappbar). Darunter drei Reiter (siehe `lib/dashboardTabs.ts`): **Marktkontext**, **Preis, Orderflow & Makro**, **KI & Tools** |
| `/reports` | AI Report Engine (nur Gratis-Tier-Provider, siehe `lib/ai/reportProviders.ts`) |
| `/lernen` | Lernplattform: Leitner-Karteikarten, Wissen, Checklisten, Indikator-/Chartstruktur-Module |
| `/account` | Passwort ändern, Push-Benachrichtigungen |

Alle Seiten teilen sich Kopfzeile und Navigation (`components/AppHeader.tsx`).
Die ganze App liegt hinter einem Login (`proxy.ts`, `lib/authGate.ts`).
Neue Dashboard-Kacheln werden in `lib/dashboardTiles.ts` registriert und in
`lib/dashboardTabs.ts` einem Reiter zugeordnet — eine vergessene Zuordnung
bricht bewusst hart ab.

## Lokale Entwicklung

```bash
npm install
npm run dev
```

`.env.local` anlegen (Vorlage: `.env.example`). Pflicht sind nur die
Supabase-URL und der (öffentliche) anon-Key, alles andere schaltet einzelne
KI-/Mail-/YouTube-Funktionen frei.

Vor jedem Deploy lokal sauber durchlaufen lassen:

```bash
npx tsc --noEmit && npx eslint . && npm test && npx next build
```

`npm test` läuft ohne Netzwerk; `npm run test:integration` prüft Live-
Invarianten gegen die produktive Supabase-Instanz (nur lesend).

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
- Offene Ideen und Folgepunkte: `docs/research/IDEEN-BACKLOG.md`
