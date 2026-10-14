# structure_trend kausal — Fix in collect-candles (14.10.2026)

**Problem** (gefunden im Orderflow-4-Schritte-Backtest, Protokoll-Nachtrag 1):
`collect-candles::computeMarketStructure` hat einen Fraktal-Swing schon an seiner eigenen
Kerze j verarbeitet, obwohl er erst nach Kerze j+5 feststeht. Weil jeder Lauf die letzten
250 Zeilen neu schreibt, hatte die gespeicherte Historie von `structure_trend`, `bos`,
`bos_direction`, `choch` und `choch_direction` bis zu 5 Kerzen Blick in die Zukunft. Der
Live-Wert der jüngsten Kerze war nicht betroffen.

## Was geändert wurde

1. **Edge Function `collect-candles` Version 18** (Quelle jetzt im Repo:
   `supabase/functions/collect-candles/index.ts`). Ein Swing bei Kerze j wird erst bei
   Kerze j+5 verarbeitet. `swing_type` bleibt am Pivot-Bar j stehen, weil
   `levelStructureContext` und `get_anchored_vwap_summary` die Lage des Pivots brauchen.
   Typ und Reihenfolge der Swings sind unverändert.
2. **SQL-Funktion `recompute_market_structure_causal(p_interval)`** (Migration
   `recompute_market_structure_causal`, nur für den Service-Role-Key ausführbar) rechnet
   die Historie mit identischer Logik neu und schreibt nur geänderte Zeilen.

## Geprüft

- TypeScript-Logik vs. Python-Referenz (`orderflow_4step/features.py::
  causal_structure_trend`, mit Lookahead-Tests): **100 %** auf 36'022 1h-Kerzen.
- `swing_type` vor und nach der Änderung: identisch.
- Gespeicherte 1h-Werte nach Neuberechnung vs. Python-Referenz: **100 %** auf 36'032
  Zeilen, einschliesslich der Zeilen, die der Live-Cron nach dem Deploy geschrieben hat.

## Geänderte Zeilen in `market_features`

| Intervall | geändert |
|---|---|
| 15m | 48'558 |
| 1h | 12'220 |
| 4h | 3'082 |
| 1d | 441 |
| 1w | 0 |

## Folgen

- **App:** MTF-Ampel, Trade-Debate und Marktstruktur-Kacheln lesen nur die jüngste Zeile,
  die war schon vorher korrekt. Sichtbar ändert sich nichts.
- **Research-Pipelines**, die `structure_trend` historisch lesen
  (`research_confluence_extend_activation`, `research_confluence_score_live`,
  `research_regime_extend_activation(_round7)`, `research_regime_score_live`): Ihre
  Statistiken basierten bisher auf der Historie mit Lookahead. Beim nächsten
  Wochen-Refresh rechnen sie auf den korrigierten Werten. Die Signal-Statistiken können
  sich dadurch verschieben, wahrscheinlich nach unten, weil der Vorteil aus der Zukunft
  wegfällt. Frühere Research-Berichte, die `structure_trend` historisch nutzen, sind
  entsprechend zu optimistisch.
- Die Funktion kann jederzeit erneut laufen, z. B. nach einem Backfill:
  `select recompute_market_structure_causal('1h');`
