# Signal-Recall-Audit: wie oft geht einer profitablen Bewegung überhaupt ein Nexus-Signal voraus? — 2026-09-10

## 1. Fragestellung

Anlass: Toby berichtet, dass der Preis oft Bewegungen macht, die für sein Setup (20x Hebel,
TP 30%/SL 10%) profitabel wären, Nexus davor aber nur selten ein Signal zeigt. Alle bisherigen
Auswertungen (`TRIPLE-BARRIER-MTF-ALIGNMENT_2026-09-04.md`) haben ausschließlich **Präzision**
gemessen: *wenn* ein Filter aktiv ist, wie viel höher ist die Trefferquote. Das beantwortet
nicht Tobys eigentliche Beobachtung — das ist eine **Recall/Abdeckungs**-Frage: von allen
profitablen Bewegungen, bei wie vielen war überhaupt ein Signal vorher da?

**Vorfeld-Fenster** (mit Toby abgestimmt): 15 Minuten bis 4 Stunden vor Entry.

## 2. Methodik

Wiederverwendet dieselbe Datenbasis wie die Triple-Barrier-Studie vom 04.09.
(`research_triple_barrier_results`/`research_triple_barrier_context`, 15m-Intervall, TP
+1,5%/SL-0,5% Kursbewegung = Tobys 30%/10% bei 20x, 2 Jahre Historie 2024-09-04 bis
2026-09-04). Keine neue Detection-Logik nötig — reine Umkehrung der bereits vorhandenen
Auswertungsrichtung (P(Signal | TP) statt P(TP | Signal)).

**Non-overlapping-Dedup:** identisch zur Ursprungsstudie, feste 48h-Buckets je Richtung ab dem
frühesten Signal-Zeitpunkt, erstes Ereignis je Bucket behalten (n=732 gesamt — deckt sich exakt
mit den 732 aus der Ursprungsstudie, bestätigt methodische Konsistenz).

**Getestete Signale:** die zwei bereits als Präzisions-Filter validierten Kandidaten (die
einzigen mit ausreichender Historie für einen 2-Jahres-Test, s. Abschnitt 5):
- **4h-Struktur** (`structure_trend_4h`, aktuell produktiv in `lib/entryFilter.ts`)
- **MTF 1h+4h+1d-Alignment** (strengere 3-Zeitebenen-Regel, Vorgänger-Filter)

**Metriken je Signal:**
- **Prevalence**: Anteil ALLER 732 Ereignisse, bei denen das Signal aktiv war (= wie oft kommt
  es überhaupt vor, unabhängig vom Ausgang)
- **Recall** (unter TP-Ereignissen): Anteil der profitablen Trades, denen das Signal voranging
  — direkte Antwort auf "wie oft hätte ich ein Signal gehabt"
- **Falsch-Positiv-Rate** (unter SL-Ereignissen): dieselbe Kennzahl unter Verlust-Trades, als
  Kontrastgröße — ein Signal, das vor Gewinn- und Verlust-Trades gleich oft auftritt, hilft
  beim Filtern nicht, auch wenn es "oft" da ist
- Zweiproportion-Z-Test (Recall vs. Falsch-Positiv-Rate), BH-FDR über die 2 getesteten Signale

## 3. Ergebnis — gepoolt LONG+SHORT

| Signal | Prevalence (n=732) | Recall unter TP (n=178) | Falsch-Positiv-Rate unter SL (n=552) | Diff | p-Wert | BH (2 Tests) |
|---|---|---|---|---|---|---|
| 4h-Struktur passt | 49,9% | **57,3%** | 47,5% | +9,8pp | 0,022 | ✅ |
| MTF 1h+4h+1d-Alignment | 17,3% | **20,8%** | 16,1% | +4,7pp | 0,152 | ❌ |

**Je Richtung:**

| Richtung | Signal | Recall TP | Falsch-Positiv-Rate SL |
|---|---|---|---|
| LONG (n=91 TP / 275 SL) | 4h-Struktur | 61,5% | 52,6% |
| LONG | MTF-Alignment | 22,0% | 17,2% |
| SHORT (n=88 TP / 278 SL) | 4h-Struktur | 52,9% | 42,4% |
| SHORT | MTF-Alignment | 19,5% | 15,1% |

## 4. Einordnung

- **4h-Struktur** ist tatsächlich kein seltenes Signal — es ist bei rund der Hälfte aller
  Gelegenheiten aktiv (Prevalence 49,9%) und deckt **57,3% der profitablen Trades ab**
  (Recall). Der Unterschied zur Falsch-Positiv-Rate (47,5%) ist mit BH-Korrektur signifikant
  (p=0,022) — das Signal ist also messbar spezifischer für Gewinn- als für Verlust-Trades, nicht
  nur "oft da". **Aber: 42,7% der profitablen Bewegungen hatten KEIN 4h-Struktur-Signal davor**
  — eine erhebliche blinde Zone selbst beim aktuell besten Filter.
- **MTF-Alignment (streng, 3 Zeitebenen)** ist dagegen tatsächlich selten (Prevalence 17,3%)
  und deckt nur **20,8% der profitablen Trades ab** — knapp 4 von 5 profitablen Bewegungen
  liefen ohne dieses strenge Signal. Der Recall-vs-Falsch-Positiv-Unterschied übersteht die
  BH-Korrektur hier NICHT (p=0,152) — aus reiner Abdeckungs-Sicht ist die strenge Regel kaum von
  Zufall zu unterscheiden, obwohl sie (siehe Ursprungsstudie) bei Auftreten eine höhere
  Trefferquote liefert. Das ist kein Widerspruch: Präzision und Recall sind unabhängige
  Größen — ein seltenes Signal kann sehr treffsicher UND gleichzeitig kaum abdeckend sein.
- **Das erklärt Tobys Beobachtung direkt**, wenn er sich (bewusst oder unbewusst) eher an der
  strengeren 3-Zeitebenen-Logik orientiert (näher an seiner eigenen beschriebenen Methodik,
  "1h/4h/1d zur Trendbestimmung") statt am seit 04.09. produktiven, großzügigeren
  4h-Filter: dort ist "selten" korrekt gemessen, nicht nur gefühlt.

## 5. Was NICHT getestet werden konnte — und warum das wichtig ist

Kerzenmuster, BOS/CHoCH-Strukturbrüche, TradingView-Alerts, Warn-Muster/Risk-Faktoren,
Kern-Engine-Zustände und Divergenz-Radar wurden bewusst ausgeschlossen:

- **Kerzenmuster**: bereits in `CANDLESTICK-PATTERNS_2026-09-04.md` mit 0/192 BH-signifikanten
  Zellen als ohne nachweisbaren Präzisions-Edge eingestuft — ein Recall-Test auf ein Signal ohne
  belegten Edge wäre nicht aussagekräftig (ein "Treffer" wäre Zufall, keine Vorhersage).
- **TradingView-Alerts, Warn-Muster/Risk-Faktoren, Kern-Engine-Zustände, Divergenz-Radar**:
  Historie existiert erst seit 26.08./03.09.2026 (`market_states`, `signal_outcomes`) bzw.
  überhaupt nicht vor heute (Divergenz-Radar, `SIGNAL-REVIEW-PHASE5_2026-09-10.md`) — bei 2
  Jahren Triple-Barrier-Historie wäre das Fenster fast vollständig leer. Das ist vermutlich ein
  Teil dessen, was Toby als "selten" erlebt: mehrere Signal-Kategorien in Nexus sind schlicht
  erst seit 1-2 Wochen scharf geschaltet und haben in absoluten Zahlen noch kaum gefeuert,
  unabhängig von ihrer tatsächlichen Trefferquote. Die dafür bereits laufende
  `signal_stats_results`-Pipeline (wöchentlich, BH-FDR) wird das mit wachsender Historie von
  selbst nachliefern — keine neue Arbeit nötig, nur Zeit.

## 6. Für Nexus / für Toby

- Keine Code-Änderung, kein neues automatisches Signal — rein diagnostisch, wie die Ursprungsstudie.
- Konkret nachvollziehbar: der produktive 4h-Filter ist kein Nischen-Signal (fast 50/50), fängt
  aber auch beim aktuell besten bekannten Filter weniger als 6 von 10 profitablen Bewegungen ab
  — Handel ausschließlich bei aktivem Filter reduziert die Chancenzahl spürbar, das ist der
  Preis für die höhere Trefferquote (Präzision vs. Recall ist ein echter Zielkonflikt, keine
  Umsetzungslücke).
- Die als "selten" empfundenen Signale sind vermutlich eher die neueren, kurzhistorischen
  Kategorien (TradingView-Alerts, Warn-Muster, Divergenz-Radar) — deren automatische
  statistische Bewertung läuft bereits (`signal_stats_results`), braucht aber noch mehrere
  Wochen Historie, bevor Aussagen zu Trefferquote und Recall möglich sind.

## 7. Nachtrag: vollständiger 9-Signal-Screen für Tobys aktualisiertes Setup (TP 35%, CRV 3,5:1)

Toby hat sein Setup präzisiert: 20x Hebel, SL 10%, **TP 35%** (vorher 30% angenommen) —
Kursbewegung TP +1,75%/SL -0,5%, **CRV 3,5:1**, Break-even-Trefferquote **22,2%**
(10/(35+10), statt 25% bei TP 30%). Zusätzlich Wunsch nach dem **vollständigen** Signal-Screen
(nicht nur 2 Filter) über 15m/1h/4h vor jedem Setup, plus: wie oft wiederholen sich exakt
dieselben Signal-Kombinationen.

**Neue Daten:** `research_triple_barrier_results`/`research_triple_barrier_context` um
`tp_pct=1,75`/`sl_pct=0,5` erweitert — volle 2-Jahres-Historie neu berechnet (140.300 Events,
LONG+SHORT), identische Methodik wie die 30%-TP-Version.

### 7.1 Alle 9 verfügbaren Signale mit 2-Jahres-Historie, Recall-Framing

Nicht-überlappend (48h-Buckets wie in Abschnitt 2), gepoolt LONG+SHORT, n=164 TP / 568 SL
insgesamt. Für jedes Signal: Anteil der TP- bzw. SL-Ereignisse, bei denen es in Trade-Richtung
aktiv war (bullisch vor LONG, bärisch vor SHORT):

| Signal | Recall TP | Anteil SL | Diff | p-Wert | BH (9 Tests, α=0,05) |
|---|---|---|---|---|---|
| 4h-Struktur | 57,7% (n=163) | 47,6% (n=567) | +10,0pp | 0,024 | ❌ (kritisch 0,0056) |
| MTF 1h+4h+1d | 22,1% | 15,9% | +6,2pp | 0,064 | ❌ |
| 1d-Struktur | 52,1% | 46,6% | +5,6pp | 0,208 | ❌ |
| 15m-Struktur | 53,7% | 48,6% | +5,1pp | 0,253 | ❌ |
| CVD-Richtung | 48,8% | 44,7% | +4,1pp | 0,358 | ❌ |
| Kerzenmuster | 21,3% | 18,5% | +2,9pp | 0,413 | ❌ |
| RSI >50/<50 | 51,5% | 50,3% | +1,3pp | 0,775 | ❌ |
| 1h-Struktur | 50,9% | 49,7% | +1,2pp | 0,790 | ❌ |
| Trendstärke (ADX≥20+DI) | 31,3% | 31,2% | +0,1pp | 0,986 | ❌ |

**0 von 9 übersteht die BH-FDR-Korrektur.** Anders als beim 2-Signal-Test in Abschnitt 3
(dort überlebte 4h-Struktur) reicht die Stichprobe bei strenger Korrektur über 9 gleichzeitig
getestete Kandidaten nicht — nicht weil das Signal schwächer geworden wäre (die Größenordnung
10,0pp vs. vorher 9,8pp ist praktisch identisch), sondern weil die Korrektur bei mehr Tests
strenger wird. **4h-Struktur bleibt aber, wie in jedem bisherigen Test dieser Session, das mit
Abstand konsistenteste Signal** — größter Effekt, kleinster Rohwert, gleiche Richtung wie in
Abschnitt 3 und in der ursprünglichen Präzisionsstudie vom 04.09.

Zur Einordnung auch die **Präzisions-Sicht** (nicht nur Recall) für 4h-Struktur bei TP=35%:
Trefferquote 25,6% wenn aktiv (n=359) vs. 18,7% wenn nicht (n=359), p=0,025 (Einzeltest). Bei
CRV 3,5:1 liegt 25,6% knapp ÜBER der 22,2%-Gewinnschwelle (Erwartungswert ≈ **+0,15R/Trade**),
18,7% liegt darunter (Erwartungswert ≈ **-0,16R/Trade**) — der Filter bleibt ökonomisch
relevant, auch wenn der Recall-Screen ihn nicht als "bewiesen" einstuft.

### 7.2 Wiederkehrende Signal-Kombinationen: fast nie exakt dieselbe

Für jedes TP-/SL-Ereignis wurde die exakte Kombination aktiver Signale (welche der 9 gleichzeitig
"an" waren) gebildet und gezählt, wie oft genau dieselbe Kombination wiederkehrt:

- **Häufigste Kombination unter TP-Ereignissen:** kommt nur **6-mal von 164** vor (3,7%) — und
  das gleich für drei verschiedene Kombinationen gleichzeitig (kein einzelner Ausreißer).
- **Häufigste Kombination unter SL-Ereignissen:** 24-mal von 568 (4,2%), aber das ist die
  Kombination "gar kein Signal aktiv" — keine inhaltliche Wiederholung.
- Mit 9 (näherungsweise) unabhängigen Ja/Nein-Signalen gibt es rechnerisch bis zu 512 mögliche
  Kombinationen — bei 164-568 Ereignissen ist die Stichprobe dafür strukturell zu klein, als
  dass sich eine exakte Kombination bedeutsam oft wiederholen könnte.

**Antwort auf "gab es wiederkehrende Signale/Muster":** exakt dieselbe Vollkombination — nein,
praktisch nie. Aber das ist der falsche Maßstab: **einzelne Signale** (v.a. 4h-Struktur, s.o.)
wiederholen sich sehr wohl regelmäßig und tragen den messbaren Effekt — nur nicht als
identisches Gesamtmuster. Ein zukünftiger Konfluenz-Score (gewichtete Summe statt exakter
Kombinationsabgleich, wie in früheren Sessions vorgeschlagen) wäre hier der richtige nächste
Schritt, kein Kombinationszähler.

### 7.3 Wie viele Trades für Profitabilität (TP 35%, CRV 3,5:1)

- **Break-even-Trefferquote:** 22,2% (statt 25% bei TP 30%) — jeder Trefferquote-Wert darüber
  ist bei JEDER Trade-Anzahl profitabel, jeder darunter defizitär; das hängt nicht von N ab.
- **Ungefiltert gemessen:** 21,9% (LONG) / 21,7% (SHORT) — wie bei TP 30% liegt die reine
  Zufallsrate wieder fast exakt auf der Gewinnschwelle (minimal darunter).
- **Mit 4h-Struktur-Filter:** 25,6% — Erwartungswert ≈ +0,15R/Trade statt ±0.
- **Für ein gegebenes N:** die nötige Mindestzahl an Gewinnern ist ⌈0,222×N⌉+1 grenzwertig,
  praktisch: bei 10 Trades ≥3 Gewinner nötig (≤7 Verlierer erlaubt), bei 50 Trades ≥12
  Gewinner, bei 100 Trades ≥23 Gewinner.
- **Für statistische Gewissheit, dass der 4h-Filter-Effekt real ist** (nicht nur Zufall): der
  hier gemessene Unterschied (25,6% vs. 18,7%, 6,9pp) ist kleiner als der bei TP 30% gemessene
  (32,8% vs. 17,9%, 14,8pp) — entsprechend mehr Trades nötig, um ihn robust nachzuweisen:
  rechnerisch **rund 1.100-1.200 nicht-überlappende Trades** für 80%-Power bei α=0,05 (gegenüber
  ca. 230 bei der größeren TP-30%-Differenz). Bei ca. 1 Signal/Tag (grobe Schätzung aus obiger
  Prevalence) wären das mehrere Jahre Livehandel — der Filter ist ökonomisch plausibel, aber mit
  der aktuellen Datenmenge (2 Jahre) nicht auf demselben Beweisniveau wie bei TP 30%.

## Referenzen

- `TRIPLE-BARRIER-MTF-ALIGNMENT_2026-09-04.md` — Präzisions-Seite derselben Filter, gleiche
  Datenbasis, gleiche Non-overlapping-Methodik (n=732 bestätigt konsistent).
- `CANDLESTICK-PATTERNS_2026-09-04.md` — Grund für den Ausschluss der Kerzenmuster hier.
- `SIGNAL-REVIEW-PHASE2_2026-09-10.md` — laufende automatisierte Statistik-Pipeline für die
  kurzhistorischen Signal-Kategorien.
- Kein neues DB-Objekt — reine Analyse-Query auf bereits bestehenden Tabellen
  (`research_triple_barrier_results`, `research_triple_barrier_context`).
