# Kerzenmuster-Backtest gegen BTC/USDT-Historie — 2026-09-04

## 1. Fragestellung

Anlass: Nutzerfrage, ob ich mich mit klassischen Candlestick-Mustern auskenne, gefolgt von
"gegen die Historie testen, gleiche Sorgfalt wie bisher". Ziel: prüfen, ob die klassischen
Umkehr-Kerzenmuster der technischen Analyse einen statistisch robusten Vorhersage-Edge auf
BTC/USDT-Kursbewegungen haben — mit derselben Methodik-Disziplin wie PHASE-1B, der
Directional-Change-Event-Studie und dem multivariaten Modell-Benchmark dieser Session.

## 2. Methodik (vorregistriert vor Ergebnis-Ansicht)

**Muster (bewusst auf 7 begrenzt, keine offene Suche):** Doji, Hammer, Hanging Man,
Bullish Engulfing, Bearish Engulfing, Morning Star, Evening Star — die meistzitierten
Umkehrmuster der klassischen TA-Literatur (Nison). Dieselbe Kombinatorik-Vorsicht wie beim
DC-Event-Pair-Screening: keine Ad-hoc-Erweiterung der Musterliste nach Ergebnis-Ansicht.

**Erkennung:** rein aus OHLC der aktuellen und bis zu 2 vorangegangenen Kerzen (`candles`-
Tabelle), SQL-Fensterfunktionen (`lag`). Per Konstruktion punkt-in-Zeit-sicher — ein Muster
bei Kerze *t* verwendet ausschließlich Daten von *t* und früher, nie Zukunftsdaten. Trendkontext
für Hammer/Hanging-Man/Doji-Richtung nutzt `close[t-1]` vs. `close[t-6]` (Trend endet VOR der
Musterkerze, damit die Musterkerze ihre eigene Trendklassifikation nicht kontaminiert).
Schwellenwerte fix vorregistriert (Doji-Body ≤10% Range, Hammer-Body ≤30% Range mit
dominantem unterem Docht ≥50% Range, Star-Body ≥50%/≤30% Range je nach Rolle).

**Intervalle:** 1D und 1H (beide mit vollständig zurückgefüllter 2-Jahres-Historie,
2024-09-04 bis 2026-09-03/04).

**Horizonte (bewusst NICHT das Standard-24/168/720h-Set der Modellvergleiche, sondern an die
klassische "kurzfristige Umkehr"-Behauptung der Kerzenmuster-Literatur angepasst):**
- 1D → 24h / 72h / 168h (1 / 3 / 7 Tageskerzen vorwärts)
- 1H → 4h / 12h / 24h (4 / 12 / 24 Stundenkerzen vorwärts)

**Splits:** identische Train/Validation/Test-Grenzen wie die `_2y`-Modell-Runs dieser Session
(train 2024-09-04–2026-01-14, validation 2026-01-15–2026-05-14, test 2026-05-15–2026-09-03).
**Testset wurde nicht angerührt** — nur Train+Validation ausgewertet.

**Purge + Embargo:** Label-Fenster darf die Split-Grenze nicht überschreiten; zusätzlich
3 Tage (1D) / 1 Tag (1H) Embargo vor der Grenze — Werte an die jeweils längsten getesteten
Horizonte angelehnt. Strukturell als Filter umgesetzt (`purged_fwd`-CTE): eine leckende Zeile
kann so gar nicht erst in die Aggregation gelangen, statt nachträglich per Assertion geprüft
zu werden.

**Baseline:** unbedingte Wahrscheinlichkeit, dass der Kurs im selben Split/Intervall/Horizont
steigt (bzw. bei BEARISH-Mustern gespiegelt: fällt) — exakt dasselbe Prinzip wie
`research_evaluate_purged` im Modellvergleich.

**Korrektur:** Benjamini-Hochberg-FDR (α=0.05) über alle getesteten Zellen gemeinsam
(Muster × Richtung × Intervall × Horizont × Split), neue Funktion `research_bh_fdr_patterns`
analog zu `research_bh_fdr`.

Neue DB-Objekte: `research_detect_candlestick_patterns()`, `research_pattern_events`
(materialisierte Treffer, RLS von Anfang an aktiviert), `research_evaluate_patterns_purged()`,
`research_pattern_results_purged`, `research_bh_fdr_patterns()`.

## 3. Ergebnis

**96 Zellen getestet (Train + Validation). 0 von 96 überleben die BH-FDR-Korrektur.**

Ereignishäufigkeiten (Gesamtzeitraum): 1D — Bullish/Bearish Engulfing ~70, Doji ~90,
Evening/Morning Star 11–13, Hammer/Hanging Man 9–15. 1H — Engulfing ~1'680, Doji ~1'840,
Evening/Morning Star 260–270, Hammer/Hanging Man ~375–400.

Auffälligste Einzelzellen (niedrigste p-Werte, dennoch alle nicht BH-signifikant):

| Muster | Intervall | Horizont | Split | n | Trefferquote | Baseline | p-Wert | BH-kritisch |
|---|---|---|---|---|---|---|---|---|
| doji (BEARISH) | 1H | 12h | train | 616 | 52.4% | 47.6% | 0.0171 | 0.0005 |
| evening_star (BEARISH) | 1H | 24h | train | 182 | 38.5% | 47.1% | 0.0201 | 0.0010 |
| evening_star (BEARISH) | 1D | 24h | train | 5 | 100.0% | 48.2% | 0.0204 | 0.0016 |
| bearish_engulfing (BEARISH) | 1H | 4h | train | 1129 | 45.3% | 48.6% | 0.0265 | 0.0031 |
| doji (BULLISH) | 1D | 72h | validation | 8 | 12.5% | 52.1% | 0.0250 | 0.0026 |

Der scheinbar spektakulärste Wert (Evening Star 1D/24h, 100% Trefferquote) beruht auf n=5 —
ein klassisches Kleinstichproben-Artefakt: ein einziges anderes Ergebnis hätte die Quote um
20 Prozentpunkte verschoben. Der stichprobenstärkste Fund (Doji 1H/12h BEARISH, n=616) hat
zwar den niedrigsten Rohwert der gesamten Tabelle, verfehlt aber den BH-kritischen Wert bei
96 gleichzeitig getesteten Hypothesen um mehr als das 30-fache. Mehrere Zellen zeigen zudem
Trefferquoten klar **unter** Baseline mit falscher Vorzeichenrichtung (z.B. Doji BULLISH 1D
72h validation: 12.5% vs. 52.1% Baseline) — bei n=8 reines Rauschen, keine belastbare
"Anti-Signal"-Aussage.

## 4. Einordnung

- Horizonte >1 Kerze (72h/168h auf 1D, 12h/24h auf 1H) erzeugen überlappende Label-Fenster
  zwischen benachbarten Ereignissen derselben Klasse — die Unabhängigkeitsannahme des
  Binomial-Tests ist verletzt, die berichteten Standardfehler sind daher tendenziell zu klein
  und die p-Werte zu optimistisch. Das kann nur fälschlich-signifikante Ergebnisse erzeugen,
  nie ein echtes Signal verdecken — die "kein Edge"-Schlussfolgerung wird dadurch also eher
  gestärkt als geschwächt.
- Ergebnis ist konsistent mit **jedem** bisherigen Test dieser Session (PHASE-1B
  Modellvergleich, Directional-Change-Event-Studie, multivariates Modell inkl. On-Chain-Daten):
  kein bislang getestetes strukturelles, statistisches oder — nun auch — klassisches
  kerzenbasiertes Muster zeigt einen Edge, der eine Multiple-Testing-Korrektur übersteht.
  Einzelkerzen-Muster (Doji, Hammer) gelten in der akademischen Literatur ohnehin als
  schwächer belegt als die bereits getesteten Mehrfaktor-/Strukturmuster — das Ergebnis
  entspricht der Erwartung.
- Statistischer Status: **SUPPORTED**, dass kein robuster Edge nachweisbar ist
  ("no edge nachgewiesen"). **NICHT bewiesen**, dass keiner existiert (PROVEN wäre eine
  stärkere, hier nicht gerechtfertigte Aussage) — u.a. weil einzelne Muster (Hammer,
  Morning/Evening Star) auf 1D nur 2–13 Validation-Ereignisse haben und damit strukturell
  nicht ausreichend statistische Power besitzen, um einen moderaten Edge sauber zu verwerfen.

## 5. Für Nexus

Keine Handlungsempfehlung, keine Code-Änderung an der Produktions-Engine. Bestätigt die
bereits bestehende Produktentscheidung: `market_states.patterns` (z.B. "Short Squeeze") sind
im Live-System explizit als reine Interpretationshilfe gekennzeichnet, kein Score-Faktor und
kein Handelssignal — für klassische Kerzenmuster gilt nach diesem Test dieselbe Einschätzung.
Es besteht kein Anlass, Doji/Hammer/Engulfing/Star als neue Faktoren in die Market-State-Engine
aufzunehmen.
