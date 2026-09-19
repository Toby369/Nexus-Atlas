# Wave Anchor: `request.security()`-Semantik-Audit — 2026-09-19 (v3, Kategorie A verifiziert)

**Update**: der tatsächliche Pine-v5-Quelltext liegt jetzt vor (siehe
`WAVE-ANCHOR-ORIGINAL-SOURCE.md` Abschnitt 0/5). Die in diesem Dokument ursprünglich als
Kategorie U/B (vom Nutzer beschrieben bzw. aus dem VuManChu-Code übertragen) geführte
Aufrufstruktur ist jetzt **Kategorie A** — exakt bestätigt, keine Abweichung zur vorherigen
Analyse. Die zugrunde liegende Sprachsemantik von `security()`/`request.security()` hat sich
zwischen Pine v4 und v5 in den hier relevanten Punkten (Default-`gaps`/`lookahead`,
historical-vs-realtime-Verhalten) **nicht** geändert — v5 führte primär den `request.`-Namensraum
und strengere Typisierung ein, nicht neue Bar-Merge-Semantik.

## 1. Tatsächliche Aufrufe (Kategorie A, aus `f_wavetrend` im Originalquelltext)

```
tfsrc = request.security(syminfo.tickerid, tf, src)
esa = ta.ema(tfsrc, chlen)                              // NICHT security-gewrappt
de = ta.ema(math.abs(tfsrc - esa), chlen)                // NICHT security-gewrappt
ci = (tfsrc - esa) / (0.015 * de)                        // NICHT security-gewrappt
wt1 = request.security(syminfo.tickerid, tf, ta.ema(ci, avg))
wt2 = request.security(syminfo.tickerid, tf, ta.sma(wt1, malen))
```

Beide `request.security()`-Aufrufe **ohne** explizite `lookahead`-Angabe — **exakt bestätigt**,
keine Abweichung zur vorherigen strukturellen Analyse (die aus dem VuManChu-v4-Code abgeleitet
worden war, Kategorie B/C). Die verschachtelte Struktur (nur `tfsrc`, `wt1`, `wt2` gewrappt;
`esa`/`de`/`ci` nicht) ist jetzt Kategorie A, keine Vermutung mehr.

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

## 3. Verschachtelte `request.security()`-Aufrufe — Konsequenz (Struktur jetzt Kategorie A,
   numerische Konsequenz weiterhin Kategorie D)

Jetzt am tatsächlichen Quelltext bestätigt (Kategorie A): der zweite `request.security()`-Aufruf
(`wt1 = request.security(tf, ta.ema(ci, avg))`) umschließt einen Ausdruck, der selbst bereits von
einem ersten `request.security()`-Aufruf abhängt (`ci` hängt über `tfsrc` vom ersten Aufruf ab).
Das ist ein bekanntes, offiziell dokumentiertes Pine-Verhalten bei verschachtelten
`security()`-Aufrufen: Pine wertet den gesamten Ausdrucksbaum im Zielkontext neu aus. Die exakte
numerische Konsequenz für `WT1`/`WT2` (Feinstruktur zwischen zwei HTF-Updates) bleibt ohne echte
Pine-Laufzeitumgebung nicht abschließend verifizierbar (Kategorie D — dieser einzelne Punkt ist
strukturell, nicht empirisch, klärbar). Die Forschungsimplementierung wählt weiterhin die
konservative, robust nachbaubare "Direct-HTF"-Variante (komplette Pipeline auf HTF-eigenen
OHLC-Kerzen berechnet) — jetzt mit Kategorie-A-Bestätigung, dass dies strukturell exakt die im
Original verwendete Aufrufkette nachbildet.

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
| Verschachtelte security()-Aufrufe vorhanden | Ja, exakt bestätigt im Originalquelltext | **A** (Struktur) / D (exakte numerische Konsequenz) |
| **SECURITY AUDIT: PASS/FAIL** | **PASS** (im tatsächlichen Quelltext keine `lookahead_on`-Verwendung, kein Beleg für Zukunftsdatenzugriff — Kategorie A) | — |
