# Wave Anchor: `request.security()`-Semantik-Audit — 2026-09-19 (v3)

Aktualisiert `WAVE-ANCHOR-PINE4-SECURITY-AUDIT.md` (v2) für die in v3 vom Nutzer beschriebene
Pine-v5-Syntax. Die zugrunde liegende Sprachsemantik von `security()`/`request.security()` hat
sich zwischen Pine v4 und v5 in den hier relevanten Punkten (Default-`gaps`/`lookahead`,
historical-vs-realtime-Verhalten) **nicht** geändert — v5 führte primär den `request.`-Namensraum
und strengere Typisierung ein, nicht neue Bar-Merge-Semantik. Diese Analyse gilt daher für beide
Versionen gleichermaßen; wo etwas v5-spezifisch ist, ist es gekennzeichnet.

## 1. Vom Nutzer beschriebene Aufrufe (Kategorie U, siehe ORIGINAL-SOURCE.md)

```
request.security(syminfo.tickerid, tf, src)
request.security(syminfo.tickerid, tf, ta.ema(...))
```

Beide **ohne** explizite `lookahead`-Angabe — strukturell identisch zur tatsächlich gelieferten
v4-VuManChu-Primärquelle (`security(syminfo.tickerid, tf, src)` bzw.
`security(syminfo.tickerid, tf, ema(ci, avg))`, siehe `WAVE-ANCHOR-PINE4-SECURITY-AUDIT.md`
Abschnitt 2). Dieselbe verschachtelte Struktur ist also plausibel auch hier vorhanden: ein Aufruf
liefert den rohen HTF-Quellwert, ein zweiter (verschachtelter) Aufruf liefert einen bereits von
`ta.ema()`/`ta.crossover()` abgeleiteten Ausdruck.

## 2. Pine `request.security()`-Defaults (Kategorie B — öffentlich dokumentiertes Sprachverhalten,
   für v4 UND v5 gültig)

1. **Historische Bars** (= der gesamte Kontext dieser Forschung, da ausschließlich mit
   abgeschlossenen historischen Kerzen aus der Datenbank gearbeitet wird): ohne expliziten
   `lookahead`-Parameter gilt der sichere Default `barmerge.lookahead_off` — nur bereits
   vollständig geschlossene HTF-Bars sind sichtbar.
2. **Realtime-Bar** (die aktuell laufende, noch offene Bar im Live-Chart): kann einen sich noch
   entwickelnden, unbestätigten HTF-Wert zeigen — irrelevant für diese historische Forschung
   (siehe `WAVE-ANCHOR-PINE4-SECURITY-AUDIT.md` Abschnitt 1 für die volle Herleitung, unverändert
   gültig).
3. `gaps`-Default (`barmerge.gaps_off`): letzter bestätigter HTF-Wert wird zwischen HTF-Updates
   auf der LTF-Zeitachse fortgeschrieben (Stufenfunktion).

## 3. Verschachtelte `request.security()`-Aufrufe — Konsequenz (Kategorie B/D, siehe
   PINE4-SECURITY-AUDIT.md Abschnitt 3 für die volle technische Herleitung)

Unverändert aus v2: wenn ein zweiter `security()`/`request.security()`-Aufruf einen Ausdruck
umschließt, der selbst bereits von einem ersten `security()`-Aufruf abhängt (hier: `ta.ema(ci,
avg)`, wobei `ci` von `tfsrc = request.security(tf, src)` abhängt), wertet Pine den gesamten
Ausdrucksbaum im Zielkontext neu aus — ein bekanntes, offiziell dokumentiertes Pine-Verhalten bei
verschachtelten `security()`-Aufrufen (Kategorie B), dessen exakte numerische Konsequenz für
`WT1`/`WT2` ohne echte Pine-Laufzeitumgebung nicht abschließend verifizierbar ist (Kategorie D).
Die Forschungsimplementierung wählt weiterhin die konservative, robust nachbaubare
"Direct-HTF"-Variante (komplette Pipeline auf HTF-eigenen OHLC-Kerzen berechnet).

## 4. Reproduzierbarer Test (v3 Abschnitt 9 verlangt explizit einen Test, nicht nur Theorie)

Umgesetzt in `tests/test_mtf_join.py` (6 Tests, alle bestehend) und
`tests/test_features.py::test_join_htf_to_ltf_is_lookahead_safe_end_to_end`: synthetische 4H-HTF-
Serie mit bekannten Testwerten, exhaustive Prüfung jeder LTF-Bar vor/an/nach jeder HTF-
Bestätigungsgrenze — siehe `WAVE-ANCHOR-REPAINT-AUDIT.md` für die konkreten Ergebnisse.

## 5. Variante A ("Original") vs. Variante B ("Strict Confirmed HTF") — v3 Abschnitt 10

**Befund**: für die historische (nicht Realtime-)Forschung **fallen Variante A und B praktisch
zusammen**. Begründung: der beschriebene Code verwendet `security()`/`request.security()` ohne
expliziten `lookahead`-Parameter → Pine-Default ist `lookahead_off` (Abschnitt 2) → auf
historischen Bars liefert das bereits ausschließlich bestätigte HTF-Werte, exakt die Definition
von Variante B. Der einzige Fall, in dem sich A und B unterscheiden würden, ist die
**Realtime-Bar** (Live-Chart, sich noch bildende Kerze) — das ist kein Zustand, der in einem
historischen Backtest über abgeschlossene Datenbank-Kerzen je auftritt. Es wird daher **keine
separate "Variante A"-Implementierung gebaut** — dies ist eine bewusste, hier begründete
Design-Entscheidung, keine stillschweigende Vereinfachung. Die einzige Ausnahme, die A von B
unterscheiden KÖNNTE, ist die in `WAVE-ANCHOR-SECURITY-AUDIT.md` Abschnitt 3 diskutierte
verschachtelte-`security()`-Feinstruktur — dort bleibt eine Kategorie-D-Unsicherheit bestehen,
die aber die Bestätigungs-Zeitpunkte selbst (und damit Look-Ahead-Sicherheit) nicht berührt,
sondern nur die Glättungsfeinstruktur zwischen zwei HTF-Updates.

## 6. Ergebnis

| Prüfpunkt | Befund | Kategorie |
|---|---|---|
| Default `lookahead` bei fehlendem Parameter | `lookahead_off` (sicher) | B |
| Default `gaps` bei fehlendem Parameter | `gaps_off` (Stufenfunktion) | B |
| Relevanz von Realtime-Bar-Verhalten für diese Forschung | Keine (nur historische Bars verwendet) | — |
| Variante A vs. B für diese Forschung | Fallen zusammen | Begründete Designentscheidung |
| Verschachtelte security()-Aufrufe vorhanden | Ja (plausibel, Kategorie U/C-Struktur) | B (Struktur) / D (exakte Konsequenz) |
| **SECURITY AUDIT: PASS/FAIL** | **PASS** (keine unsichere `lookahead_on`-Verwendung in den beschriebenen Aufrufen, kein Beleg für Zukunftsdatenzugriff) | — |
