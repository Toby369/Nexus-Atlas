# Wave Anchor: Original-Source-Dokumentation — 2026-09-19 (v3)

## 0. Was tatsächlich vorliegt — ehrliche Bestandsaufnahme

**Wichtige Klarstellung zu Beginn**: In der v3-Aufgabenstellung heißt es, der "vollständige
Originalcode" befinde sich "im vorherigen Prompt". Das stimmt nicht ganz — im vorherigen Prompt
wurde der Pine-**v4**-Quelltext von **VuManChu B Divergences/Cipher-B** geliefert (Funktion
`f_wavetrend`, Level `obLevel/osLevel=±53`, `obLevel2/osLevel2=±60`, `obLevel3/osLevel3=+100/-75`)
— das ist die Abhängigkeit, auf der Wave Anchor laut eigener Aussage aufbaut, **nicht** Wave
Anchors eigener Code selbst. Der in der v3-Aufgabenstellung beschriebene Pine-**v5**-Code (mit
`ta.ema()`, `ta.crossover()`, `ta.crossunder()`, `request.security(...)`, TP-Alert-Labels wie
`"D/15 Long TP1 Reached"`, expliziter Fast-Wave/Slow-Wave-Auswahl) wurde in dieser Unterhaltung
**nicht als Quelltext übermittelt** — ich habe ihn nicht direkt gesehen.

Zusätzlich hat der Nutzer vier Screenshots der **offiziellen TradingView-Beschreibungsseite** des
Wave-Anchor-Indikators geliefert (Changelog, "How It Works", Credits) — das ist echte, direkte
Evidenz von der Indikator-Seite selbst, aber **weiterhin nicht der Pine-Quelltext**.

**Kategorie A (verifiziert aus Originalquelltext) bleibt daher leer.** `tradingview.com` ist in
dieser Sandbox weiterhin vollständig `EGRESS_BLOCKED` (erneut geprüft für v3) — eine unabhängige
Verifikation des Skripttexts ist technisch nicht möglich.

**Legende (erweitert um Kategorie U für v3):**
- **A — VERIFIED FROM ORIGINAL SOURCE**: direkt aus StormCat1s Skript gelesen. **Leer.**
- **U — USER-DESCRIBED**: detaillierte technische Beschreibung des Codes direkt vom Nutzer (v3-
  Aufgabenstellung selbst: Parameterwerte, Funktionsnamen, Pine-Konstrukte). Wird als
  zuverlässige Fachauskunft behandelt, aber NICHT unabhängig durch Code-Einsicht verifiziert.
- **B — VERIFIED FROM PUBLIC DESCRIPTION**: aus der offiziellen TradingView-Beschreibungsseite
  (jetzt per Nutzer-Screenshot direkt belegt) bzw. aus unabhängigen Web-Beschreibungen (v1).
- **C — RECONSTRUCTED FROM OPEN-SOURCE DEPENDENCY**: aus dem tatsächlich gelieferten VuManChu-
  Pine-v4-Quelltext (Primärquelle für die WaveTrend-Formel selbst, nicht für Wave Anchor).
- **D — UNKNOWN**: nicht belegbar, nicht geraten.

## 1. WaveTrend-Parameter

| Größe | Wert | Kategorie |
|---|---|---|
| WT Channel Length | 9 | U (v3-Beschreibung) / C (identisch zum gelieferten VuManChu-Code) |
| WT Average Length | 12 | U / C |
| WT MA Length | 3 | U / C |
| Source | HLC3 | U / C |

Diese drei Werte sind bereits aus der v2-Primärquelle (VuManChu-Code) als `chlen=9/avg=12/malen=3`
bekannt (Kategorie C) — die v3-Beschreibung stimmt exakt damit überein, was die Plausibilität der
Nutzer-Beschreibung stützt, sie aber nicht zu Kategorie A erhebt.

```
src = HLC3
esa = EMA(src, 9)
de  = EMA(|src - esa|, 9)
ci  = (src - esa) / (0.015 * de)
WT1 = EMA(ci, 12)
WT2 = SMA(WT1, 3)
```

## 2. Fast Wave / Slow Wave

**Kategorie U**: laut Nutzer-Beschreibung bietet der Originalcode eine echte Nutzerauswahl
zwischen `Fast Wave = WT1` und `Slow Wave = WT2`. In den Screenshots der offiziellen
Beschreibungsseite wird diese Auswahl NICHT erwähnt (Kategorie B liefert dazu keine Bestätigung
oder Widerlegung). Die Forschungsimplementierung exponiert **beide** als vollständig getrennte,
gleichrangige Feature-Familien (`fast_wave` = Alias für `wt1`, `slow_wave` = Alias für `wt2`),
konsistent mit v3 Abschnitt 3 ("Nicht vorher entscheiden, welche besser ist").

## 3. Anchor-Levels: nur ±60

**Kategorie B, jetzt direkt von der offiziellen Beschreibungsseite bestätigt** (Nutzer-Screenshot,
Abschnitt "Key Concept: Anchored Waves"): *"momentum waves in overbought (above 60) or oversold
(below -60) conditions on higher time frames are considered 'anchored'."* Explizit **kein** ±53 —
das stammt aus der VuManChu-Basis (dort `obLevel/osLevel`) und ist laut expliziter v3-Vorgabe
NICHT die Wave-Anchor-Anchor-Grenze. Die v3-Forschungsimplementierung testet **ausschließlich
±60** (im Unterschied zu v2, das alle drei VuManChu-Level parallel getestet hatte — diese
Einschränkung ist jetzt durch die direkte Beschreibungsseiten-Bestätigung UND die explizite
Nutzervorgabe gerechtfertigt, nicht mehr nur eine Kategorie-D-Annahme).

## 4. Timeframe-Pairing

**Kategorie B, jetzt direkt bestätigt** (Nutzer-Screenshot, "Time Frame Pairings"): *"On the
15-minute time frame, the indicator tracks anchor conditions from the 1-hour and 4-hour time
frames. On the 1-hour chart, it monitors 4-hour and daily time frame anchor conditions."* Exakt
identisch zur bereits in v1/v2 verwendeten Kopplung — keine Änderung am Code nötig.

## 5. Event- vs. State-Charakter

**Kategorie B, jetzt direkt bestätigt** (Nutzer-Screenshot, "How It Works" / "Labeling Signals"):
*"the indicator shows labels when higher time frame momentum waves ... cross the overbought or
oversold levels. Labels above price indicate overbought conditions, with green labels when the
wave crosses upward and red labels when crossing downward."* Das ist eindeutig ein **Cross-Event**
(Label erscheint am Kreuzungsmoment, farbcodiert nach Richtung), keine kontinuierliche
Zustandsanzeige. Konsistent mit der `ta.crossover()`/`ta.crossunder()`-Verwendung, die der Nutzer
in v3 beschreibt (Kategorie U). Die Forschungsimplementierung testet — wie schon in v1/v2 — EVENT
(Cross) und STATE (anhaltende Zone) weiterhin getrennt (v3 Abschnitt 7 verlangt das explizit),
mit dem Hinweis, dass laut dieser Beschreibung das EVENT die primäre, vom Original tatsächlich
sichtbar gemachte Größe ist.

## 6. TP-Alert-Labels

**Kategorie U**: Label-Texte wie `"D/15 Long TP1 Reached"` werden laut Nutzer-Beschreibung vom
Original verwendet. Diese Bezeichnungen sind reine Alert-/Anzeige-Texte und werden — wie in v3
Abschnitt 8 explizit gefordert — NICHT als Handelsregeln in die Forschung übernommen. Die
Forschung testet stattdessen objektiv Forward Return/MFE/MAE/Direction/Magnitude (siehe
`WAVE-ANCHOR-FEATURE-SPEC.md`).

## 7. `request.security()` — v5-Syntax

**Kategorie U**: laut Nutzer-Beschreibung `request.security(syminfo.tickerid, tf, src)` bzw.
`request.security(syminfo.tickerid, tf, ta.ema(...))`, ohne explizite `lookahead`-Angabe — exakt
dieselbe 3-Parameter-Form wie im tatsächlich gelieferten v4-VuManChu-Code (dort `security(...)`
ohne `request.`-Präfix, Pine v4 vs. v5-Namensraum-Unterschied, funktional identisch). Volle
Analyse in `WAVE-ANCHOR-SECURITY-AUDIT.md`.

## 8. Zusammenfassung

| Baustein | Kategorie | Quelle |
|---|---|---|
| WaveTrend-Formel (esa/de/ci/wt1/wt2) | C (Zahlenwerte) / U (v5-Syntax-Beschreibung) | VuManChu-v4-Primärquelle + Nutzer-Beschreibung |
| Parameter 9/12/3 | C + U übereinstimmend | Beide Quellen decken sich |
| Fast Wave=WT1/Slow Wave=WT2 | U | Nur Nutzer-Beschreibung, nicht in Screenshots erwähnt |
| ±60 als einzige Anchor-Grenze | B (jetzt Screenshot-bestätigt) | Offizielle Beschreibungsseite |
| 15m→1H+4H, 1H→4H+1D | B (Screenshot-bestätigt) | Offizielle Beschreibungsseite |
| Event-/Cross-Charakter | B (Screenshot-bestätigt) + U (ta.crossover/under) | Beide konsistent |
| TP-Alert-Label-Texte | U | Nur Nutzer-Beschreibung, nicht produktionsrelevant |
| `request.security()`-Aufrufform | U + C (identische Struktur im v4-Code) | Konsistent zwischen beiden Quellen |

**Konsequenz**: höheres Vertrauen als in v1/v2 (mehrere unabhängig konsistente Quellen: v4-Code,
offizielle Beschreibungsseite, Nutzer-Beschreibung), aber weiterhin **keine** Kategorie-A-Aussage
über den literalen Pine-v5-Quelltext möglich.
