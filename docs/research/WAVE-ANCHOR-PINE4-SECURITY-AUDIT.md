# Wave Anchor: Pine-v4-`security()`-Semantik-Audit — 2026-09-19 (v2)

HIGH-PRIORITY-Dokument (Abschnitt 8 der v2-Aufgabenstellung). Analysiert exakt, was der vom
Nutzer gelieferte Pine-v4-Primärquellcode mit `security()` tatsächlich tut — insbesondere die in
v1 nicht erkannte **verschachtelte `security()`-Struktur** in `f_wavetrend` selbst.

## 1. Allgemeine Pine-v4-`security()`-Semantik (Kategorie B — öffentlich dokumentiertes
   Sprachverhalten, nicht Wave-Anchor-spezifisch)

`security(symbol, timeframe, expression, gaps, lookahead)` — in Pine v4 bereits mit den optionalen
Parametern `gaps` und `lookahead` (nicht erst seit v5). Werden sie nicht angegeben — wie im
gelieferten Code, der ausschließlich die 3-Parameter-Form `security(syminfo.tickerid, tf, src)`
nutzt — gelten die Sprachdefaults:

- `gaps = barmerge.gaps_off` (Default): der zuletzt bestätigte HTF-Wert wird auf jeder LTF-Bar
  wiederholt/fortgeschrieben (Stufenfunktion), bis die nächste HTF-Bar bestätigt wird.
- `lookahead = barmerge.lookahead_off` (Default, **bereits in Pine v4**, nicht erst v5): für
  **historische** Bars liefert `security()` ausschließlich den Wert der zuletzt vollständig
  geschlossenen HTF-Bar zum jeweiligen LTF-Zeitpunkt — kein Zugriff auf zukünftige HTF-Daten.

**Historical vs. Realtime Bars (Kategorie B)**: Pine unterscheidet zwei Ausführungskontexte:
1. **Historische Bars** (Backtest/Chart-Historie): jede Bar ist bereits abgeschlossen.
   `security()` mit `lookahead_off` liefert hier ausschließlich bestätigte HTF-Werte — exakt der
   Kontext, in dem diese Forschung arbeitet.
2. **Realtime-Bar** (die aktuell laufende, noch nicht geschlossene Bar im Live-Chart):
   `security()` kann hier den Wert der sich GERADE BILDENDEN (noch unbestätigten) HTF-Bar liefern,
   der sich bis zu deren Schluss noch ändert — das ist KEIN Look-Ahead (keine Zukunftsdaten),
   sondern normales Verhalten von Live-Daten, die sich noch entwickeln. Es ist die häufigste
   Quelle für umgangssprachliches "Repainting" bei TradingView-Indikatoren: der Live-Chart zeigt
   während der laufenden Bar einen vorläufigen Wert, der bei Bar-Schluss "einrastet" und sich
   danach nicht mehr ändert.

**Relevanz für diese Forschung**: Punkt 2 ist für die vorliegende Untersuchung **irrelevant**, da
ausschließlich mit historischen, bereits vollständig abgeschlossenen Kerzen aus der Datenbank
gearbeitet wird — es gibt in diesem Backtest-Kontext keine "laufende Realtime-Bar". Die gesamte
Forschung befindet sich strukturell in Fall 1.

## 2. Die konkrete Struktur im gelieferten Code (Kategorie C — Primärquelle)

```
tfsrc = security(syminfo.tickerid, tf, src)          -- (1) security(), roher HLC3 vom HTF
esa   = ema(tfsrc, chlen)                             -- (2) LOKAL im LTF-Kontext, NICHT gewrappt
de    = ema(abs(tfsrc - esa), chlen)                   -- (3) LOKAL im LTF-Kontext, NICHT gewrappt
ci    = (tfsrc - esa) / (0.015 * de)                   -- (4) LOKAL im LTF-Kontext, NICHT gewrappt
wt1   = security(syminfo.tickerid, tf, ema(ci, avg))   -- (5) security() UM EINEN AUSDRUCK, der
                                                            selbst von (1) abhängt
wt2   = security(syminfo.tickerid, tf, sma(wt1, malen)) -- (6) security() UM EINEN AUSDRUCK, der
                                                            selbst von (5) abhängt
```

**Zentraler Befund**: nur `tfsrc` (Zeile 1), `wt1` (Zeile 5) und `wt2` (Zeile 6) sind explizit in
`security()` gewrappt. `esa`, `de`, `ci` (Zeilen 2–4) werden im **lokalen LTF-Skriptkontext**
berechnet — mit `tfsrc` als Eingabe, der selbst eine Stufenfunktion ist (wegen `gaps_off`), die
sich nur an HTF-Bar-Grenzen ändert.

## 3. Konsequenz der Verschachtelung (Kategorie B für das allgemeine Pine-Verhalten,
   Kategorie D für die exakte numerische Auswirkung in diesem Fall)

**Bekanntes Pine-Anti-Pattern (Kategorie B)**: TradingView dokumentiert und die Pine-Community
diskutiert ausführlich, dass `security()` mit einem Ausdruck, der selbst bereits von einem
ANDEREN `security()`-Aufruf abhängt (hier: `ci` in Zeile 5 hängt über `tfsrc` von Zeile 1 ab),
zu einer **erneuten Auswertung des gesamten Ausdrucksbaums im Zielkontext** führt, statt einfach
den bereits im LTF-Kontext berechneten Wert zu übernehmen. Das ist ein bekanntes, offiziell
dokumentiertes Pine-Verhalten bei verschachtelten `security()`-Aufrufen — kein Implementierungs-
fehler von VuManChu, aber eine Konstruktion mit nicht-trivialen Konsequenzen.

**Zwei mögliche numerische Interpretationen** (nicht ohne echte Pine-Laufzeitumgebung
gegeneinander verifizierbar — daher Kategorie D für die exakte Konsequenz):

- **Variante 1 ("Direct-HTF")**: durch die Verschachtelung wird der komplette Ausdrucksbaum
  (`ci`, und implizit `esa`/`de`/`tfsrc`) im HTF-Kontext neu ausgewertet — `wt1`/`wt2` verhalten
  sich dann so, als wäre die gesamte `esa→de→ci→wt1→wt2`-Pipeline direkt auf den HTF-eigenen
  OHLC-Kerzen berechnet worden (EMA-Rekursion taktet nur bei jedem tatsächlichen HTF-Bar-Update
  einen Schritt weiter).
- **Variante 2 ("LTF-rekursiv mit HTF-Stufenfunktion")**: `esa`/`de`/`ci` werden tatsächlich auf
  **jeder LTF-Bar neu berechnet** (weil sie selbst nicht gewrappt sind), mit `tfsrc` als
  stufenförmigem Input. Das ist numerisch **nicht** identisch zu Variante 1: eine
  `ema(x, N)`-Rekursion (`esa[i] = esa[i-1] + α·(x[i] − esa[i-1])`) konvergiert bei jedem
  Rekursionsschritt weiter Richtung des aktuellen `x`-Werts — auch wenn `x` zwischen zwei
  HTF-Updates konstant bleibt. Bei LTF-Taktung macht `esa` also auf **jeder LTF-Bar** einen
  kleinen Schritt Richtung des aktuellen (konstanten) `tfsrc`-Werts, statt nur einmal pro
  HTF-Bar — eine andere, schnellere Glättungsdynamik als bei reiner HTF-Taktung.

**Einschätzung**: die im Pine-Umfeld dokumentierte Regel zu verschachtelten `security()`-Aufrufen
spricht eher für Variante 1 bei `wt1`/`wt2` selbst (da diese explizit erneut gewrappt sind) — das
würde bedeuten, dass die fertigen `wt1`/`wt2`-Endgrößen trotz der ungewöhnlichen Code-Struktur
näherungsweise HTF-getaktet sind, näher an einer direkten HTF-Berechnung als an Variante 2. Das
ist eine **plausible, aber nicht zu 100 % verifizierte Einschätzung** — eine abschließende Prüfung
wäre nur durch tatsächliches Ausführen dieses Codes in einer echten Pine-Laufzeitumgebung (mit
Vergleich der resultierenden `wt1`/`wt2`-Werte gegen eine direkte HTF-Berechnung) möglich, was in
dieser Sandbox nicht zur Verfügung steht.

## 4. Konsequenz für diese Forschung

Die Forschungsimplementierung (`wave_anchor_research/wavetrend.py`) verwendet **ausschließlich
Variante 1** (`esa`/`de`/`ci`/`wt1`/`wt2` komplett auf den HTF-eigenen OHLC-Kerzen berechnet, dann
look-ahead-sicher per `confirmed_asof_join` auf die LTF-Zeitachse projiziert) — aus zwei Gründen:

1. Sie ist die einzige robust und deterministisch nachbaubare Variante außerhalb einer echten
   Pine-Laufzeitumgebung.
2. Die Analyse in Abschnitt 3 spricht für Variante 1 als die wahrscheinlichere tatsächliche
   Konsequenz der Verschachtelung.

**Explizite Einschränkung, nicht zu verschweigen**: sollte die tatsächliche Pine-Laufzeit
näher an Variante 2 liegen, würden sich `wt1`/`wt2` in dieser Forschung geringfügig von
StormCat1s/VuManChus tatsächlich angezeigten Werten unterscheiden (schnellere Konvergenz
innerhalb einer HTF-Periode statt Stufenfunktion). Dieser Unterschied beträfe die **Feinstruktur**
der Werte zwischen zwei HTF-Updates, nicht die HTF-Update-Zeitpunkte selbst — das
Look-Ahead-Verhalten (Abschnitt 6, `WAVE-ANCHOR-MTF-LOOKAHEAD-AUDIT.md`) bleibt davon unberührt,
da beide Varianten ausschließlich auf bereits bestätigten HTF-Informationen basieren.

## 5. Zusammenfassung

| Frage | Antwort | Kategorie |
|---|---|---|
| `security()`-Aufrufe explizit ohne `gaps`/`lookahead`-Parameter | Ja, 3-Parameter-Form | C (Primärquelle) |
| Default-`lookahead` in Pine v4 bei fehlendem Parameter | `lookahead_off` (sicher) | B |
| Default-`gaps` bei fehlendem Parameter | `gaps_off` (Stufenfunktion) | B |
| `esa`/`de`/`ci` selbst in `security()` gewrappt? | Nein | C (Primärquelle) |
| `wt1`/`wt2` selbst in `security()` gewrappt? | Ja (verschachtelt, da vom bereits gewrappten `ci` abhängig) | C (Primärquelle) |
| Numerische Konsequenz der Verschachtelung für `wt1`/`wt2` | Wahrscheinlich HTF-getaktet (Variante 1), nicht abschließend verifizierbar | D |
| Relevanz für Look-Ahead in dieser (historischen) Forschung | Keine — beide Varianten basieren ausschließlich auf bestätigten HTF-Daten | — |
| In der Forschungsimplementierung verwendete Variante | Variante 1 (Direct-HTF) | Dokumentierte Designentscheidung |
