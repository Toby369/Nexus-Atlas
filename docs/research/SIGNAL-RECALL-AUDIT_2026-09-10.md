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

## Referenzen

- `TRIPLE-BARRIER-MTF-ALIGNMENT_2026-09-04.md` — Präzisions-Seite derselben Filter, gleiche
  Datenbasis, gleiche Non-overlapping-Methodik (n=732 bestätigt konsistent).
- `CANDLESTICK-PATTERNS_2026-09-04.md` — Grund für den Ausschluss der Kerzenmuster hier.
- `SIGNAL-REVIEW-PHASE2_2026-09-10.md` — laufende automatisierte Statistik-Pipeline für die
  kurzhistorischen Signal-Kategorien.
- Kein neues DB-Objekt — reine Analyse-Query auf bereits bestehenden Tabellen
  (`research_triple_barrier_results`, `research_triple_barrier_context`).
