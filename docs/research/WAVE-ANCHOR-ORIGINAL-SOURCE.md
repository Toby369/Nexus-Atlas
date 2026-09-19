# Wave Anchor: Original-Source-Dokumentation — 2026-09-19 (v3, Kategorie A jetzt verifiziert)

## 0. Update: Originalquelltext liegt jetzt tatsächlich vor

**Wichtige Korrektur gegenüber der ersten v3-Fassung dieses Dokuments**: der Nutzer hat den
vollständigen Pine-**v5**-Quelltext des "Wave Anchor Indicator" nachgereicht (nach einer
Rückfrage, da vorher nur die öffentliche Beschreibungsseite und der VuManChu-Abhängigkeitscode
vorlagen). Statische Referenzkopie:
`research-python/wave_anchor_research/reference/wave_anchor_original_v5.pine` (nicht Teil der
ausführbaren Pipeline, dient nur als zitierbare Quelle für dieses Dokument).

**Kategorie A ist ab jetzt NICHT mehr leer.** Alle unten als "A" markierten Punkte sind direkt aus
diesem Quelltext gelesen, keine Rekonstruktion.

**Legende (unverändert):**
- **A — VERIFIED FROM ORIGINAL SOURCE**: direkt aus dem jetzt vorliegenden Quelltext.
- **U — USER-DESCRIBED**: Nutzer-Beschreibung vor Quelltext-Erhalt (v3-Aufgabenstellung selbst)
  — im Rückblick fast durchgängig exakt zutreffend, siehe Abschnitt 6.
- **B — VERIFIED FROM PUBLIC DESCRIPTION**: offizielle TradingView-Beschreibungsseite (Screenshots).
- **C — RECONSTRUCTED FROM OPEN-SOURCE DEPENDENCY**: VuManChu-Pine-v4-Quelltext.
- **D — UNKNOWN**: nicht mehr relevant für die Kernlogik (siehe Abschnitt 7 für die verbleibenden
  offenen Punkte).

## 1. Header und Herkunft (Kategorie A)

```
//@version=5
indicator(title='Wave Anchor Indicator', shorttitle='Wave Anchor Indicator', overlay=true)
// Thanks to LazyBear via VuManChu for WaveTrend Oscillator ...
```

Bestätigt: Pine v5, Titel exakt "Wave Anchor Indicator", explizite Danksagung an LazyBear/VuManChu
für die WaveTrend-Basis — konsistent mit der bereits in v1/v2 dokumentierten Abhängigkeit.

## 2. WaveTrend-Parameter (Kategorie A, exakt)

```
wtChannelLen = input(9, ...)
wtAverageLen = input(12, ...)
wtMASource   = input(hlc3, ...)
wtMALen      = input(3, ...)
```

`chlen=9, avg=12, malen=3, src=HLC3` — **exakt bestätigt**, identisch zu allen bisherigen
Annahmen (Kategorie C aus v2, Kategorie U aus der ersten v3-Fassung). Als `input(...)` deklariert
(vom Nutzer im TradingView-UI änderbar), aber die hier verwendeten **Default-Werte** sind die
oben genannten — v3 Abschnitt 24 verlangt explizit, bei den Default-/Originalparametern zu bleiben.

## 3. Fast Wave / Slow Wave (Kategorie A — jetzt exakt bestätigt)

```
waveType = input.string("Fast Wave", title="Select Wave Type", options=["Fast Wave", "Slow Wave"], ...)
...
wt1 = request.security(..., ta.ema(ci, avg)) // Fast Wave
wt2 = request.security(..., ta.sma(wt1, malen)) // Slow Wave
...
(waveType == "Fast Wave" ? wt1_1h : wt2_1h)
```

**Bestätigt exakt**: `WT1 = "Fast Wave"`, `WT2 = "Slow Wave"`, echter Nutzer-Dropdown
(`input.string`), Default = `"Fast Wave"` (WT1). **Wichtiger neuer Befund**: im Original wird die
Wave-Type-Auswahl **global für alle Cross-Bedingungen gleichzeitig** angewendet (ein einziger
Toggle, nicht pro Timeframe oder Event separat wählbar) — d. h. der Originalindikator zeigt zu
jedem Zeitpunkt IMMER nur eine der beiden Wellen an, nie beide gleichzeitig. Die
Forschungsimplementierung testet dennoch — wie in v3 Abschnitt 3 explizit gefordert — **beide
Wellen parallel als unabhängige Forschungshypothesen**, da nicht bekannt ist, welche Einstellung
ein Nutzer tatsächlich wählt.

## 4. Anchor-Levels (Kategorie A — exakt, fest codiert, kein Input)

```
overboughtLevel = 60
oversoldLevel = -60
```

**Bestätigt**: ±60 ist fest im Code verdrahtet (`= 60`, nicht `input(60, ...)`) — es gibt in
diesem Indikator **keine** Möglichkeit, ±53 oder ein anderes Level einzustellen. Das validiert
vollständig die v3-Entscheidung, die Forschung ausschließlich auf L2 (±60) zu beschränken — es
ist nicht nur die naheliegendste, sondern die **einzige im Code vorkommende** Anchor-Schwelle.

## 5. `f_wavetrend`-Funktion (Kategorie A — exakte Struktur bestätigt)

```
f_wavetrend(src, chlen, avg, malen, tf) =>
    tfsrc = request.security(syminfo.tickerid, tf, src)
    esa = ta.ema(tfsrc, chlen)
    de = ta.ema(math.abs(tfsrc - esa), chlen)
    ci = (tfsrc - esa) / (0.015 * de)
    wt1 = request.security(syminfo.tickerid, tf, ta.ema(ci, avg))
    wt2 = request.security(syminfo.tickerid, tf, ta.sma(wt1, malen))
    [wt1, wt2]
```

**Bestätigt exakt die in `WAVE-ANCHOR-SECURITY-AUDIT.md` (v3, vor Quelltext-Erhalt) analysierte
Struktur**: `esa`/`de`/`ci` sind NICHT selbst in `request.security()` gewrappt, nur `tfsrc` (roh)
sowie `wt1`/`wt2` (fertige Endgrößen, über den bereits von `tfsrc` abhängigen Zwischenwert `ci`
verschachtelt). Meine vorherige strukturelle Analyse (Kategorie B/D, spekulativ aus dem
VuManChu-Code abgeleitet) war exakt zutreffend — jetzt Kategorie A. Kein expliziter
`gaps`/`lookahead`-Parameter — Pine-Default gilt (siehe Security-Audit-Dokument, dort weiterhin
gültig, jetzt mit Kategorie-A-Bestätigung der Aufrufstruktur).

Aufgerufen für drei Timeframes:
```
[wt1_4h, wt2_4h]       = f_wavetrend(..., "240")   // 4 Stunden
[wt1_daily, wt2_daily] = f_wavetrend(..., "D")     // Daily
[wt1_1h, wt2_1h]       = f_wavetrend(..., "60")    // 1 Stunde
```

Kein 15m-eigener `f_wavetrend`-Aufruf — auf dem 15m-Chart selbst wird nur der 1H- und 4H-Wave
referenziert, nicht der 15m-Wave selbst (der Indikator vergleicht also NICHT das aktuelle
Chart-Timeframe mit sich selbst, sondern ausschließlich HTF-Werte).

## 6. Timeframe-Mapping und Cross-Bedingungen (Kategorie A — exakt bestätigt)

```
if (timeframe.period == "15")
    ... crossover15m_1H_*, crossover15m_4H_* ...
if (timeframe.period == "60")
    ... crossover1H_4H_*, crossover1H_D_* ...
```

**Exakt bestätigt**: 15m-Chart nutzt 1H+4H, 1H-Chart nutzt 4H+Daily — identisch zur bereits in
v1/v2/v3 verwendeten `STUDY_SETUPS`-Konfiguration, keine Code-Änderung nötig.

Vier Cross-Typen je (Chart-TF, HTF)-Paar, exakt wie in `features.py` bereits implementiert:

| Original-Code | v3-Bezeichnung | Code-Spaltenname (dieses Projekt) |
|---|---|---|
| `ta.crossover(wave, +60)` | `CROSS_ABOVE_PLUS60` | `cross_up_ob` |
| `ta.crossunder(wave, +60)` | `CROSS_BELOW_PLUS60` | `cross_down_ob` |
| `ta.crossunder(wave, -60)` | `CROSS_BELOW_MINUS60` | `cross_down_os` |
| `ta.crossover(wave, -60)` | `CROSS_ABOVE_MINUS60` | `cross_up_os` |

**Exakte 1:1-Übereinstimmung mit der bereits implementierten Feature-Engine** — keine
Code-Änderung an `features.py` nötig, die Forschungsimplementierung bildet die vier Cross-Events
bereits korrekt ab.

**Wichtiger Befund**: die 4H- und Daily-Wellen werden EINMAL berechnet und dann sowohl für den
15m-Chart-Kontext (`crossover15m_4H_*`) als auch für den 1H-Chart-Kontext (`crossover1H_4H_*`)
identisch wiederverwendet — dieselbe zugrunde liegende HTF-Größe, nur unter zwei verschiedenen
Variablennamen für zwei verschiedene Anzeige-Kontexte. Das bestätigt exakt das
Architekturprinzip dieses Forschungsprojekts: HTF-Größen werden EINMAL berechnet
(`compute_htf_observations`) und dann look-ahead-sicher auf jede relevante LTF-Zeitachse
projiziert (`confirmed_asof_join`) — keine Neuberechnung je Chart-Kontext nötig.

## 7. Alert-Labels und "TP1"/"TP2"-Semantik (Kategorie A)

```
alertcondition(crossover15m_1H_overbought, title="D/15 Long TP1 Reached", ...)
alertcondition(crossover15m_4H_overbought, title="D/15 Long TP2 Reached", ...)
alertcondition(crossover1H_4H_overbought,  title="W/1H Long TP1 Reached", ...)
alertcondition(crossover1H_D_overbought,   title="W/1H Long TP2 Reached", ...)
alertcondition(crossunder15m_1H_oversold,  title="D/15 Short TP1 Reached", ...)
... (analog fuer TP2, Short, 1H-Chart)
```

**Wichtige inhaltliche Beobachtung** (nicht in Code übernommen, nur zur Einordnung im
Ergebnisteil des Abschlussberichts relevant): die Original-Benennung verknüpft einen
**Aufwärts-Cross durch +60** (Wave wird "overbought") mit einem **"Long TP" (Take-Profit-für-
Long)**-Label, nicht mit einem Long-Einstiegssignal. Das deutet auf eine **Mean-Reversion-/
Exit-Interpretation** hin (im Sinne der in der Beschreibungsseite genannten "TP Mint"-Strategie:
ein bereits laufender Long wird bei HTF-Overbought-Anchor eher abgesichert/geschlossen als neu
eröffnet), nicht auf eine Trendfolge-Interpretation. Für die Forschung bleibt das reine
Kontext-Information — es werden weiterhin ausschließlich objektive Forward-Return/MFE/MAE/
Direction-Größen getestet (v3 Abschnitt 8), keine TP-Regel wird nachgebaut. Die
Interpretationsrichtung (mean-reversion vs. trend-continuation) wird aber im Abschlussbericht
beim Lesen der Vorzeichen der Effektgrößen berücksichtigt.

Kein Hinweis auf Divergenz-Logik im gesamten Quelltext — **Kategorie A bestätigt jetzt
definitiv**, dass Wave Anchor keine Divergenz-Erkennung verwendet (war in v1/v2 Kategorie D mit
"vermutlich nein").

## 8. Zusammenfassung — was jetzt Kategorie A ist

| Baustein | v1/v2/erste-v3-Fassung | Jetzt |
|---|---|---|
| WaveTrend-Formel (esa/de/ci/wt1/wt2) | C / U | **A** |
| Parameter 9/12/3 | C / U | **A** |
| Fast Wave=WT1/Slow Wave=WT2 | U | **A** |
| ±60 als EINZIGE Anchor-Grenze (fest codiert) | B / U | **A** |
| Verschachtelte `request.security()`-Struktur | B (Struktur) / D (Konsequenz) | **A (Struktur)** / D bleibt (exakte Pine-Laufzeit-Numerik) |
| 15m→1H+4H, 1H→4H+1D | B | **A** |
| Vier Cross-Events (crossover/crossunder an ±60) | B / U | **A** |
| Divergenz-Logik NICHT verwendet | D ("vermutlich nein") | **A** (definitiv, kein Vorkommen im Code) |
| TP1/TP2-Label-Semantik (Exit- statt Entry-Interpretation) | — (nicht bekannt) | **A** (neu, siehe Abschnitt 7) |
| Exakte Pine-v5-Laufzeit-Konsequenz der Verschachtelung (Variante 1 vs. 2) | D | **D bleibt** (nur durch echte Pine-Ausführung klärbar, hier nicht verfügbar) |

**Konsequenz für die Forschung**: die bereits laufende v3-Statistik-Batterie testet exakt die
jetzt bestätigte Logik (WT1/WT2 getrennt, nur ±60, 15m→1H+4H/1H→4H+1D, vier Cross-Events) — **kein
Neu-Lauf nötig**, die Zellendefinitionen waren bereits korrekt. Einzige verbleibende
Kategorie-D-Unsicherheit: die exakte numerische Konsequenz der verschachtelten
`request.security()`-Aufrufe auf die Feinstruktur von `wt1`/`wt2` zwischen zwei HTF-Updates (siehe
`WAVE-ANCHOR-SECURITY-AUDIT.md` Abschnitt 3) — betrifft nicht die Bestätigungszeitpunkte selbst
und damit nicht die Look-Ahead-Sicherheit.
