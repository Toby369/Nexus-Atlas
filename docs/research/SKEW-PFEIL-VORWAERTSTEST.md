# Skew-Pfeil — Vorwärtstest und Kontrolltermine

**Start der Datensammlung: 14.10.2026, 12:48 UTC.** `collect-options` (Version 7,
Quellcode `supabase/functions/collect-options/index.ts`) schreibt alle 30 Minuten
`iv_30d`, `skew_30d` und `expiries_30d` in `options_snapshots`. Die Rechnung ist
identisch mit der Volatilitäts-Kachel (`lib/volatility.ts::thirtyDayOptions`), geprüft
am 14.10.2026 auf 500 zufälligen Optionsketten ohne Abweichung.

Warum: Der Pfeil in der Kachel (grün ↑ Calls teurer, rot ↓ Puts teurer, grau →
ausgeglichen) liess sich nicht rückwirkend testen, weil es keine kostenlosen
historischen Optionspreise je Strike gibt. Siehe
`VOLATILITAETS-KACHEL-BACKTEST_RESULTS_2026-10-14.md`.

## ⏰ Kontrolltermine

| Termin | Fällig am | Was tun | Erledigt |
|---|---|---|---|
| **1 Monat** | **14.11.2026** | Datenqualität: Lücken, Fehlerzeilen, Anteil `skew_30d IS NULL`, Plausibilität (siehe SQL unten). Keine Auswertung der Richtung. | ☐ |
| **3 Monate** | **14.01.2027** | Datenqualität wie oben. Verteilung von `skew_30d` anschauen: Wie oft ist der Pfeil grün/rot/grau? Sind die Schwellen (−2 / +5) sinnvoll verteilt? **Schwellen nur jetzt anpassen** (per datiertem Nachtrag hier), danach nie mehr. | ☐ |
| **6 Monate** | **14.04.2027** | Erste **beschreibende** Auswertung nach dem Testplan unten, ohne Entscheid. Prüfen, ob die Stichprobe für 12 Monate reichen wird. | ☐ |
| **12 Monate** | **14.10.2027** | **Bestätigungstest** nach dem Testplan unten. Ergebnis entscheidet, ob der Pfeil bleibt, umgedeutet oder entfernt wird. | ☐ |

Nach jedem Termin die Zeile abhaken und Datum und Kurzbefund darunter eintragen.

## Testplan (vorregistriert 14.10.2026)

**Beobachtung je Tag t:** `skew_30d` des ersten Snapshots ab 00:00 UTC. Richtung
nach den Kachel-Schwellen: ↑ bei < −2, ↓ bei > +5, sonst →.

**Ergebnis:** Log-Rendite von BTC (Binance-Futures-1h-Schlusskurs) von t bis t + 7 Tage
und t bis t + 30 Tage.

**Hypothesen (für den 12-Monats-Termin):**

1. **H-S1 (Richtung wie angezeigt):** Mittlere 7-Tage-Rendite nach ↑-Tagen >
   nach ↓-Tagen.
2. **H-S2 (Gegenindikator):** Mittlere 7-Tage-Rendite nach ↓-Tagen > nach ↑-Tagen. Diese
   Lesart steht im Info-Text: „starke Angst fällt oft mit Tiefs zusammen“.
3. **H-S3 (stetig statt Schwellen):** Rangkorrelation zwischen `skew_30d` und der
   7-Tage-Rendite ≠ 0.

H-S1 und H-S2 sind einseitig und schliessen sich aus. Beide werden getestet, jeweils mit
halbem α (Bonferroni), dazu H-S3 zweiseitig. Block-Bootstrap mit 14 Tagen Blocklänge,
10'000 Wiederholungen. Die 30-Tage-Rendite wird nur beschreibend berichtet, weil ein
Jahr nur rund 12 unabhängige 30-Tage-Fenster hat.

**Mindestgrösse:** je Gruppe (↑ / ↓) mindestens 30 Tage, sonst `INSUFFICIENT_DATA`.
Die Verteilung zum 3-Monats-Termin zeigt, ob das realistisch ist.

**Folgen:**

| Ergebnis | Kachel |
|---|---|
| H-S1 bestätigt | Pfeil bleibt, Info-Text nennt die Messung |
| H-S2 bestätigt | Pfeilfarben umkehren oder als „Gegenindikator“ beschriften |
| H-S3 bestätigt, H-S1/H-S2 nicht | Schwellen überprüfen (stetiger Zusammenhang, falsche Grenzen) |
| nichts bestätigt | Pfeil entfernen, Skew nur noch als Zahl und Text zeigen |
| `INSUFFICIENT_DATA` | Termin um 6 Monate verschieben, Protokoll unverändert |

## Hilfs-SQL

Datenqualität:

```sql
select date_trunc('day', timestamp_utc) as tag,
       count(*) as snapshots,
       count(*) filter (where status = 'error') as fehler,
       count(*) filter (where skew_30d is null and status = 'ok') as ohne_skew,
       round(min(skew_30d), 2) as skew_min,
       round(max(skew_30d), 2) as skew_max,
       round(avg(iv_30d), 1) as iv_mittel
from options_snapshots
where timestamp_utc >= '2026-10-14 12:48+00'
group by 1
order by 1;
```

Verteilung der Pfeilrichtung (ein Wert je Tag):

```sql
with taeglich as (
  select distinct on (date_trunc('day', timestamp_utc))
         date_trunc('day', timestamp_utc) as tag, skew_30d
  from options_snapshots
  where status = 'ok' and skew_30d is not null and timestamp_utc >= '2026-10-14 12:48+00'
  order by date_trunc('day', timestamp_utc), timestamp_utc
)
select case when skew_30d < -2 then 'up' when skew_30d > 5 then 'down' else 'flat' end as pfeil,
       count(*) as tage
from taeglich
group by 1;
```

## Hinweis zur Datenhaltung

`options_snapshots` hat keinen automatischen Aufräum-Job (Stand 14.10.2026). Falls
später ein Aufräumen eingeführt wird: **`skew_30d` und `iv_30d` mindestens bis nach dem
12-Monats-Termin behalten**, sonst ist der Test verloren.
