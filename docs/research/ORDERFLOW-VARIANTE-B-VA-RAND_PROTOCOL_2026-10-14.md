# Orderflow Variante B — Ziel am Value-Area-Rand (Protokoll, 14.10.2026)

**Status: explorativ.** Diese Variante entsteht, nachdem die Ergebnisse des
Grund-Protokolls (`ORDERFLOW-4-SCHRITTE-RESULTS_2026-10-14.md`) bekannt sind, und wird auf
**denselben Daten** getestet. Ein positives Ergebnis ist deshalb höchstens ein Hinweis
und keine Bestätigung. Bestätigen liesse es sich nur mit neuen Daten ab 01.10.2026
(Vorwärtstest).

## Einzige Änderung gegenüber dem Grund-Protokoll (inkl. Nachtrag 1–3)

| | Grund-Protokoll | Variante B |
|---|---|---|
| Ziel 1 Long | näherer von VWAP/POC über dem Einstieg | **VAH** (oberer Rand der 24h-Value-Area) über dem Einstieg |
| Ziel 1 Short | näherer von VWAP/POC unter dem Einstieg | **VAL** unter dem Einstieg |

Begründung, vor dem Lauf festgehalten: Im Grund-Protokoll scheiterten 356 von 562
Long-Signalen am Mindest-CRV, weil VWAP/POC nach der Bestätigung zu nah lagen. Der
gegenüberliegende VA-Rand ist das klassische Auktionsziel („von Rand zu Rand“) und liegt
weiter weg.

Alles andere bleibt unverändert: Auslöser (z ≤ −1,0, Lookback 5), Ort, Umfeld, Stop,
Mindest-CRV 1,5, Ziel 2 (Swing über bzw. unter Ziel 1), Teilausstieg, Einstands-Stop,
Timeout, Kosten, Funding, V0–V4, H1–H5, Holm, Mindest-n 100, Gesamtprobe 10/2022–09/2026.
Das Volumenprofil für Ziel 1 ist dasselbe wie bisher (96 Kerzen vor der
Bestätigungskerze).

## Entscheidungsregel

- H1 bestätigt (n ≥ 100, p_holm < 0,05): **kein** Live-Signal, aber Vorwärtstest ab
  10/2026 mit unveränderten Regeln, Auswertung, sobald 100 neue Trades vorliegen.
- Sonst: Variante B verwerfen und im Bericht festhalten.
