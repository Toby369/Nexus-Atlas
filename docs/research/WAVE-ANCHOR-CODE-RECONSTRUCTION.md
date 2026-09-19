# Wave Anchor: Code-Reconstruction — 2026-09-19

## 0. Zugriffs-Einschränkung (zuerst, damit der Rest richtig eingeordnet wird)

`tradingview.com` (inkl. aller Sprach-Subdomains: `il.`, `jp.`, `it.`, `kr.`) ist in dieser
Sandbox vollständig vom Netzwerk-Egress-Proxy blockiert. Mehrere Versuche, die Wave-Anchor-Seite
(`https://www.tradingview.com/script/vqzrqY81-Wave-Anchor-Indicator/`) direkt zu laden, schlugen
mit `EGRESS_BLOCKED` fehl. **Der literale Pine-Quelltext von StormCat1s "Wave Anchor Indicator"
wurde NICHT eingesehen.** Alles unten Genannte ist entsprechend kategorisiert — siehe Legende.

**Legende:**
- **A — VERIFIED FROM ORIGINAL SOURCE**: direkt aus StormCat1s Wave-Anchor-Skript gelesen.
- **B — VERIFIED FROM PUBLIC DESCRIPTION**: aus mehreren unabhängigen, übereinstimmenden
  Beschreibungen der TradingView-Skriptseite (per Web-Suche zusammengefasst, nicht Rohcode).
- **C — RECONSTRUCTED FROM OPEN-SOURCE DEPENDENCY**: aus dem tatsächlichen, auf GitHub
  gehosteten Pine-Quelltext von VuManChu Cipher B (der Baustein, auf dem Wave Anchor laut allen
  Beschreibungen aufbaut) — echter Code, aber nicht Wave Anchors eigene Datei.
  - Quelle: `github.com/iamc1oud/Tradingview-Scripts` (`2024-Setup/cipher-b.pine`) und
    `github.com/noobtechie/MarketIndicators` (`VuManChu Cipher B`), beide unabhängig
    abgerufen, inhaltlich deckungsgleich.
- **D — UNKNOWN / REQUIRES VALIDATION**: keine belastbare Quelle, nicht raten.

**Ergebnis vorweg: Kategorie A ist in diesem Dokument LEER.** Es gibt nichts, das ich als "aus
dem Original-Quelltext verifiziert" kennzeichnen kann. Falls der Nutzer den Skript-Text selbst
einsehen kann (TradingView → Pine-Editor → "Quellcode ansehen" bei offenen Skripten), sollte
dieses Dokument danach aktualisiert werden.

## 1. WaveTrend-Berechnung

**Kategorie C** (exakt aus dem VuManChu-Cipher-B-Quelltext, Funktion `f_wavetrend`):

```
esa  = ema(src, chlen)
de   = ema(abs(src - esa), chlen)
ci   = (src - esa) / (0.015 * de)
wt1  = ema(ci, avg)
wt2  = sma(wt1, malen)
wtVwap = wt1 - wt2
```

`src` = `hlc3` (Default-Parameter `wtMASource`). VuManChu-Cipher-B-Defaults: `chlen=9`,
`avg=12`, `malen=3`. Der kanonische LazyBear-Original-WaveTrend (Vorgänger von VuManChu,
ebenfalls per Websuche/Sekundärquellen bestätigt, **Kategorie B**, nicht direkt eingesehen)
verwendet stattdessen `n1=10`, `n2=21`, Signal-Länge `4`.

**Kategorie D**: Ob StormCat1s Wave Anchor die VuManChu-Defaults (9/12/3), die LazyBear-Originale
(10/21/4) oder eigene, ein drittes Set von Werten verwendet, ist **nicht verifizierbar** ohne den
Originalcode. Die Forschungsimplementierung (Abschnitt "Isolierte Implementierung" unten)
parametrisiert deshalb beide Presets explizit und testet sie **parallel**, statt sich auf eines
festzulegen.

## 2. Overbought/Oversold-Schwellen

**Kategorie B** (aus mehreren unabhängigen Beschreibungen übereinstimmend): Wave Anchor
verwendet **±60** als Anchor-Schwelle ("above +60 overbought/anchored", "below -60
oversold/anchored") — das entspricht `obLevel2`/`osLevel2` im VuManChu-Cipher-B-Quelltext
(Kategorie C: `obLevel2 = input(60, ...)`, `osLevel2 = input(-60, ...)`), nicht `obLevel`/`osLevel`
(±53) oder `obLevel3`/`osLevel3` (±100, in einer Quelle abweichend auch ±75 genannt — die beiden
GitHub-Kopien selbst stimmen bei diesem dritten Level nicht exakt überein, ±100 vs. ±75, was die
Unsicherheit bei diesem speziellen Level zusätzlich unterstreicht; für Wave Anchor irrelevant, da
nur die ±60-Ebene verwendet wird).

Welche der beiden Wellen (`wt1` oder `wt2`) für den Schwellenvergleich verwendet wird: **Kategorie
D**. Der VuManChu-Code selbst prüft in seiner eigenen `wtOversold`/`wtOverbought`-Logik `wt2`
gegen `osLevel`/`obLevel` (nicht `obLevel2`); Wave Anchor könnte dieselbe Konvention (wt2 gegen
±60) oder eine eigene (z.B. wt1) verwenden. Die Forschungsimplementierung verwendet **wt2**
als Default-Annahme (konsistent mit VuManChu-eigener Oversold/Overbought-Logik, auch wenn dort
gegen ±53 statt ±60 geprüft wird) und dokumentiert dies explizit als Annahme, nicht als
verifizierte Tatsache.

## 3. Timeframe-Kopplung (Multi-Timeframe-Mapping)

**Kategorie B**: 15m-Chart überwacht 1H- und 4H-Wave; 1H-Chart überwacht 4H- und Daily-Wave.
Kein Hinweis auf weitere Kopplungen (z.B. 5m→15m/1H) in den gefundenen Beschreibungen —
**Kategorie D** für alle nicht explizit genannten Timeframe-Paare.

## 4. Anchor-Zustand: Event oder anhaltender Zustand?

**Kategorie D — wichtigste offene Frage.** Die Beschreibungen sprechen von "Labels ... when
higher time frame momentum waves cross the overbought or oversold levels" — das klingt nach
einem **Cross-Event** (Label nur im Moment des Durchbruchs), während der Begriff "anchored"
selbst einen **anhaltenden Zustand** ("solange wt jenseits ±60 bleibt") beschreibt. Beide
Interpretationen sind mit den gefundenen Beschreibungen vereinbar. Der Begleitindikator
"HTF Anchor Dots" (ebenfalls StormCat1) scheint einen ZUSTAND abzubilden (Punkte erscheinen
kontinuierlich, nicht nur im Kreuzungsmoment: "Yellow Dots indicate TP1 timeframe IS anchored" —
Präsens, kein Perfekt).

**Entscheidung für die Forschungsimplementierung**: BEIDE Größen werden getrennt als Features
exponiert — `state` (anhaltender Zustand, jede bestätigte HTF-Bar neu ausgewertet) UND
`cross_up_60`/`cross_down_60`/etc. (Event, nur an der Bar der tatsächlichen Schwellen-Kreuzung).
Das entspricht auch der expliziten Vorgabe in Abschnitt 4/10 der Aufgabenstellung, State und
Cross-Events als getrennte, unabhängig testbare Größen zu behandeln — löst die Unklarheit also
nicht auf, sondern macht sie für beide plausiblen Linsen testbar.

## 5. `request.security()` — Timeframe, Gaps, Lookahead, Offset

**Kategorie D für die tatsächlich in Wave Anchor verwendeten Parameter** (keine Sicht auf den
Aufruf selbst). **Kategorie B/C für die allgemeine Pine-Semantik dieser Funktion** (öffentlich
dokumentiertes Sprachverhalten, nicht Wave-Anchor-spezifisch):

- `gaps`: `barmerge.gaps_off` (Default) füllt Lücken zwischen HTF-Updates mit dem letzten
  bekannten Wert fort; `barmerge.gaps_on` liefert `na`, bis die nächste HTF-Bar tatsächlich
  vorliegt. Für ein "ist die HTF-Welle gerade verankert"-Feature ist `gaps_off` die naheliegende
  Wahl (kontinuierliche Anzeige), aber nicht verifiziert.
  - Im oben zitierten VuManChu-Quelltext wird `barmerge.gaps_off` explizit nur in
    `f_getTFCandle` verwendet (Heikin-Ashi-HTF-Kerze für das "Sommi Diamond"-Feature) — mit
    `barmerge.lookahead_on` kombiniert (siehe unten).
- `lookahead`: `barmerge.lookahead_off` (Standard/sicher) liefert nur bereits geschlossene
  HTF-Bars; `barmerge.lookahead_on` kann bei nicht-realtime (historischer) Berechnung den
  sich noch bildenden HTF-Wert vorzeitig offenlegen — ein bekannter, dokumentierter
  Repainting-Mechanismus in Pine, wenn ein Skript `lookahead_on` unbedacht verwendet.
  **Bemerkenswert**: Im VuManChu-Quelltext wird `barmerge.lookahead_on` tatsächlich verwendet
  (`f_getTFCandle`, für die HTF-Kerzenfarbe des "Sommi Diamond"-Features) — das ist ein reales,
  im Code sichtbares Repainting-Risiko IN VUMANCHU SELBST, für eine Funktion, die NICHT die
  Kern-WaveTrend-Berechnung ist (`f_wavetrend` selbst verwendet `security()` ohne expliziten
  `lookahead`-Parameter, was in Pine v4 dem sicheren Default entspricht). Ob Wave Anchor
  überhaupt auf `f_getTFCandle` oder eine ähnliche Lookahead-Konstruktion zurückgreift: **D**.
- `offset`: keine Hinweise gefunden, ob Wave Anchor einen Offset-Parameter verwendet — **D**.

## 6. Divergenz-Logik — von Wave Anchor selbst genutzt?

**Kategorie D, mit Indizien für "eher nein".** Alle gefundenen Beschreibungen von Wave Anchor
konzentrieren sich ausschließlich auf die ±60-Anchor-Kreuzung der WaveTrend-Welle selbst — keine
Erwähnung von Divergenz-Erkennung (die in VuManChu Cipher B als eigenständiges, umfangreiches
Feature existiert: `f_findDivs`, regulär/versteckt, RSI/Stoch/WT-Divergenzen). Da Wave Anchor
laut allen Beschreibungen ein deutlich fokussierterer, kleinerer Indikator als das volle
VuManChu-Cipher-B-Panel ist, ist plausibel, dass nur die WaveTrend-Wellenwerte selbst (wt1/wt2)
übernommen werden, nicht die Divergenz-Zusatzlogik — das ist aber eine Vermutung, keine
verifizierte Aussage, und wird in der Forschungsimplementierung NICHT als Feature nachgebaut.

## 7. Alert-Bedingungen

**Kategorie D.** Keine der gefundenen Beschreibungen listet die konkreten `alertcondition()`-
Aufrufe von Wave Anchor auf (im Gegensatz zu VuManChu Cipher B, dessen Alerts im eingesehenen
Quelltext vollständig sichtbar sind — buySignal/sellSignal/Divergenz-Alerts). Für die
Forschungsimplementierung irrelevant, da keine Handelssignale erzeugt werden (siehe
Aufgabenstellung, Abschnitt 4 und 17).

## 8. Bar-State / Bestätigungslogik

**Kategorie D für Wave Anchors eigene Implementierung.** Die Forschungsimplementierung erzwingt
unabhängig davon ihre eigene, strikt konservative Regel (siehe
`WAVE-ANCHOR-MTF-LOOKAHEAD-AUDIT.md`): ein HTF-Wert wird erst nach vollständigem Schluss der
HTF-Kerze verwendet — unabhängig davon, ob Wave Anchor selbst das genauso handhabt. Das ist eine
bewusste Entscheidung, NICHT eine Behauptung über Wave Anchors tatsächliches Verhalten: die
Forschung prüft, ob das KONZEPT (HTF-Momentum-Extremzone als Feature) Informationsgehalt hat,
unter der striktesten, look-ahead-sichersten Auslegung — nicht, ob eine potenziell repainting-
behaftete Chart-Anzeige in der Vergangenheit gut ausgesehen hätte.

## 9. Zusammenfassung — was tatsächlich feststeht

| Baustein | Kategorie | Sicherheit |
|---|---|---|
| WaveTrend-Kernformel (esa/de/ci/wt1/wt2) | C | Hoch (echter Quellcode, Cipher-B-Abhängigkeit) |
| ±60 als Anchor-Schwelle | B | Mittel-hoch (mehrfach übereinstimmend beschrieben) |
| 15m→1H+4H, 1H→4H+1D Kopplung | B | Mittel-hoch (mehrfach übereinstimmend beschrieben) |
| wt2 (nicht wt1) gegen Schwelle geprüft | D | Angenommen, nicht verifiziert |
| VuManChu- vs. LazyBear-Parameter (9/12/3 vs. 10/21/4) | D | Unbekannt — beide werden parallel getestet |
| Anchor = Zustand oder nur Cross-Event | D | Beide werden getrennt als Features exponiert |
| request.security() gaps/lookahead/offset in Wave Anchor | D | Unbekannt — eigene, konservative Regel erzwungen |
| Divergenz-Nutzung in Wave Anchor | D | Vermutlich nein, nicht nachgebaut |
| Alert-Bedingungen | D | Irrelevant für diese Forschung |

**Konsequenz für die gesamte weitere Untersuchung**: dies ist keine Eins-zu-eins-Rekonstruktion
eines verifizierten Indikators, sondern ein Test des **Konzepts** "HTF-WaveTrend-Extremzone als
Feature", unter der striktesten plausiblen, look-ahead-sicheren Interpretation der öffentlich
dokumentierten Beschreibung. Jedes Ergebnis dieser Forschung ist entsprechend zu lesen — ein
negativer Befund widerlegt nicht zwingend "Wave Anchor funktioniert nicht", sondern "das hier
getestete, unter Unsicherheit rekonstruierte Konzept funktioniert nicht"; ebenso für ein
positives Ergebnis.
