# NEXUS Atlas

Persönliches BTC/USDT-Perpetual-Marktüberwachungs-Dashboard. V1 (Vertical Slice):
ein einzelner Live-Datenpunkt (Preis, Mark Price, Funding, Open Interest), sauber
End-to-End von der Datenquelle bis zur Anzeige.

## Architektur

```
Bybit (öffentliche API)
   → Supabase Edge Function "collect-btc"   (läuft alle 5 Min via pg_cron)
   → Tabelle public.market_snapshots
   → Next.js App liest per Supabase JS Client (RLS: öffentlicher Lesezugriff)
   → Deployment via Vercel
```

Es ist kein eigenes Backend/Server nötig — die Datensammlung läuft komplett
innerhalb von Supabase (Edge Function + pg_cron + pg_net), die App selbst ist
rein lesend.

## Lokale Entwicklung

```bash
npm install
npm run dev
```

`.env.local` enthält bereits die öffentliche Supabase-URL und den
(öffentlichen) anon-Key — beides ist bewusst clientseitig sichtbar und kein
Geheimnis.

## Deployment (Vercel)

1. Repo mit Vercel verknüpfen (Projektname z. B. `nexus-atlas`)
2. Environment Variables in Vercel setzen (siehe `.env.example`)
3. Deploy — kein weiterer Schritt nötig, die Datenpipeline läuft unabhängig
   vom Frontend-Deployment in Supabase

## Nächste Ausbaustufen

- Weitere Symbole/Exchanges (Bitunix, Pionex) ergänzen
- Liquidationen, News-Events, Makro-Kalender anzeigen
- KI-generierte 3–5-Satz-Markteinschätzung auf Basis der gesammelten Daten
- Anpassbare Dashboard-Boxen
