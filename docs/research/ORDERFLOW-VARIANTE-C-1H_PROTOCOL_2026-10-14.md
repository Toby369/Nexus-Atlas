# Orderflow Variante C — alles eine Stufe höher (Protokoll, 14.10.2026)

**Status: explorativ**, wie Variante B. Festgeschrieben, während Variante B rechnete und
bevor deren Ergebnisse angesehen wurden. Getestet wird auf denselben Jahren
10/2022–09/2026, ein positives Ergebnis wäre nur ein Hinweis für einen Vorwärtstest ab
10/2026.

## Idee

Im Grund-Protokoll lagen Ort und Ziel auf 15m zu nah beieinander. Variante C hebt jeden
Zeitrahmen um eine Stufe an, damit zwischen Einstieg und Ziel mehr Raum bleibt. Alle
Regeln sind sonst die des Grund-Protokolls (inkl. Nachtrag 1–3), skaliert wie folgt:

| Baustein | Grund-Protokoll | Variante C |
|---|---|---|
| Auslöser, Ausführung, ATR | 15m | **1h** |
| 1h-Struktur (Umfeld) | 1h, Fraktal 5 | **4h**, Fraktal 5 (kausal) |
| Regime (Umfeld) | 4h | **1d** (gleiche Regime-Formeln und Schwellen) |
| Funding-Filter | z > 2,5 / < −2,5 | unverändert |
| VWAP-Anker | US-Eröffnung 09:30 New York, täglich | **Wochenanker Montag 00:00 UTC** |
| Mindestkerzen seit Anker | 4 | 4 |
| Volumenprofil | 96 Kerzen vor der Kerze, Bucket 0,1 % | **168 Kerzen (1 Woche)**, Bucket **0,2 %** |
| Delta-z-Fenster | 96 Kerzen | **168 Kerzen** |
| Delta-z-Schwelle, Lookback neues Extrem, Bestätigungsfenster | −1,0 / 5 / 3 | unverändert (in 1h-Kerzen) |
| Ziel 2 | 1h-Swing, Fraktal 20 | **4h-Swing**, Fraktal 20 |
| Timeout | 24h (96 Kerzen) | **96 Kerzen = 4 Tage** |
| Tagesregel (V4) | Sperre bis nächster US-Anker | Sperre bis zum **nächsten Wochenanker** |
| Kosten, Funding, CRV ≥ 1,5, Stop-Puffer 0,1·ATR, Teilausstieg | | unverändert |

## Zwei Unter-Varianten, beide berichtet

- **C1:** Ziel 1 wie Grund-Protokoll (näherer von VWAP/POC)
- **C2:** Ziel 1 wie Variante B (gegenüberliegender Value-Area-Rand)

Je Unter-Variante und Richtung (Long, Short): V0–V4, H1–H5, eigene Holm-Familie,
Mindest-n 100. Da hier vier Familien parallel laufen (C1/C2 × Long/Short), gilt für eine
„Bestätigung“ zusätzlich eine Bonferroni-Schranke über die Familien: p_holm < 0,05 / 4.

**Erwartung, vor dem Lauf festgehalten:** Auf 1h gibt es etwa ein Viertel so viele Kerzen
wie auf 15m. Wahrscheinlich bleiben die Trades weit unter 100, und das Ergebnis lautet
erneut `INSUFFICIENT_DATA`.

## Entscheidungsregel

Wie Variante B: Eine Bestätigung führt höchstens zu einem Vorwärtstest ab 10/2026, nie
direkt zu einem Live-Signal.
