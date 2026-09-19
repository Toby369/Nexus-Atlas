# Wave Anchor: Code-Reconstruction — 2026-09-19 (v2, aktualisiert)

## 0. Zugriffs-Einschränkung (erneut geprüft für v2)

`tradingview.com` (inkl. aller Sprach-Subdomains) ist weiterhin vollständig vom Netzwerk-Egress-
Proxy blockiert. Erneuter Versuch für v2 (`https://www.tradingview.com/script/vqzrqY81-Wave-
Anchor-Indicator/`): **`EGRESS_BLOCKED`**, unverändert gegenüber v1. Status bestätigt:

**`STORMCAT1_SOURCE_NOT_DIRECTLY_AVAILABLE`**

Der literale Pine-Quelltext von StormCat1s "Wave Anchor Indicator" wurde **nicht** eingesehen —
weder in v1 noch in v2. Kategorie A (verifiziert aus StormCat1s Originalquelltext) bleibt für
alle StormCat1-spezifischen Implementierungsentscheidungen leer.

**Neu in v2**: Der Nutzer hat den vollständigen Pine-v4-Quelltext der VuManChu-B-Divergences-
/Cipher-B-Basis direkt geliefert (nicht über eine Drittkopie via GitHub reproduziert wie in v1).
Dieser Code wird ab jetzt als **Primärquelle für die WaveTrend-Rekonstruktion** verwendet — er
bleibt aber Kategorie C bezogen auf Wave Anchor selbst (echter Code der Abhängigkeit, nicht von
Wave Anchor), jetzt jedoch mit direkter Nutzer-Verifikation statt Web-Recherche.

**Legende (unverändert):**
- **A — VERIFIED FROM ORIGINAL SOURCE**: direkt aus StormCat1s Wave-Anchor-Skript.
- **B — VERIFIED FROM PUBLIC DESCRIPTION**: aus mehreren unabhängigen, übereinstimmenden
  öffentlichen Beschreibungen.
- **C — RECONSTRUCTED FROM OPEN-SOURCE DEPENDENCY**: aus dem tatsächlichen VuManChu-Cipher-B-
  Pine-Quelltext (jetzt: direkt vom Nutzer geliefert, Primärquelle für v2).
- **D — UNKNOWN / REQUIRES VALIDATION**: keine belastbare Quelle, nicht geraten.

## 1. WaveTrend-Kernfunktion — exakter Primärquellcode (v2)

**Kategorie C** (direkt vom Nutzer als Pine-v4-Primärquelle geliefert):

```
f_wavetrend(src, chlen, avg, malen, tf) =>
    tfsrc = security(syminfo.tickerid, tf, src)
    esa = ema(tfsrc, chlen)
    de = ema(abs(tfsrc - esa), chlen)
    ci = (tfsrc - esa) / (0.015 * de)
    wt1 = security(syminfo.tickerid, tf, ema(ci, avg))
    wt2 = security(syminfo.tickerid, tf, sma(wt1, malen))
    wtVwap = wt1 - wt2
    wtOversold = wt2 <= osLevel
    wtOverbought = wt2 >= obLevel
    wtCross = cross(wt1, wt2)
    wtCrossUp = wt2 - wt1 <= 0
    wtCrossDown = wt2 - wt1 >= 0
    wtCrosslast = cross(wt1[2], wt2[2])
    wtCrossUplast = wt2[2] - wt1[2] <= 0
    wtCrossDownlast = wt2[2] - wt1[2] >= 0
    [wt1, wt2, wtOversold, wtOverbought, wtCross, wtCrossUp, wtCrossDown, wtCrosslast, wtCrossUplast, wtCrossDownlast, wtVwap]
```

Originalparameter (Kategorie C, aus derselben Primärquelle):

```
wtChannelLen = 9
wtAverageLen = 12
wtMALen = 3
wtMASource = hlc3

obLevel  = +53      osLevel  = -53
obLevel2 = +60      osLevel2 = -60
obLevel3 = +100     osLevel3 = -75
```

**Wichtige Korrektur gegenüber v1**: in v1 wurde `chlen=9/avg=12/malen=3` noch als "VuManChu-
Cipher-B-Default"-Preset behandelt, dessen Herkunft über Web-Recherche (GitHub-Drittkopien)
bestätigt wurde. Diese Parameter sind jetzt durch die vom Nutzer gelieferte Primärquelle direkt
bestätigt — keine Änderung am Zahlenwert, aber höhere Verifikationssicherheit. Das
`LazyBear-Original`-Preset (n1=10/n2=21/sig=4) bleibt Kategorie B (Vorgänger-Indikator, nicht Teil
der gelieferten Primärquelle) und wird weiterhin parallel getestet.

**Wichtiger neuer Befund (Kategorie C, siehe `WAVE-ANCHOR-PINE4-SECURITY-AUDIT.md` für die volle
Herleitung)**: `esa`/`de`/`ci` sind in diesem Code **nicht** selbst in `security()` gewrappt — nur
`tfsrc` (der rohe HLC3-Input) sowie `wt1`/`wt2` (die fertigen Endgrößen) werden separat über
`security()` anfragt. Das hat Konsequenzen für die EMA-Taktung, die eine naive "berechne alles auf
HTF-OHLC-Kerzen"-Nachbildung NICHT automatisch korrekt abbildet — siehe eigenes Audit-Dokument.

## 2. Overbought/Oversold-Schwellen — jetzt alle 6 Level dokumentiert

**Kategorie C** (aus derselben Primärquelle, exakte Werte):

| Level-Paar | OB | OS | Pine-Variable |
|---|---|---|---|
| Level 1 | +53 | -53 | `obLevel`/`osLevel` |
| Level 2 | +60 | -60 | `obLevel2`/`osLevel2` |
| Level 3 | +100 | -75 | `obLevel3`/`osLevel3` |

**Wichtige Korrektur gegenüber v1**: in v1 wurde Level 3 fälschlich als "±100 vs. ±75 uneinheitlich
zwischen zwei GitHub-Kopien" beschrieben und als unsicher eingestuft. Die jetzt vom Nutzer
gelieferte Primärquelle bestätigt eindeutig: **`obLevel3=+100`, `osLevel3=-75`** — asymmetrisch,
keine Uneinheitlichkeit, sondern ein Fehler der v1-Websuche-Rekonstruktion. Dieses Dokument
korrigiert das hiermit explizit.

**Kategorie D bleibt bestehen**: welche(s) dieser drei Level-Paare — falls überhaupt nur eines —
StormCat1s Wave Anchor tatsächlich als "Anchor"-Schwelle verwendet, ist ohne Originalquelltext
nicht verifizierbar. Öffentliche Beschreibungen (Kategorie B, aus v1 übernommen) sprechen
konsistent von "±60" ("above +60 overbought/anchored", "below -60 oversold/anchored"), was für
Level 2 spricht — aber die Forschungsimplementierung testet jetzt **alle drei Paare separat**
(Abschnitt 6 der Aufgabenstellung), statt sich auf ±60 festzulegen.

## 3. WT1 vs. WT2 — jetzt getrennt behandelt (v2)

**Kategorie D, zentrale offene Frage (Abschnitt 5 der Aufgabenstellung).** Der gelieferte
Primärcode selbst verwendet für seine EIGENEN `wtOversold`/`wtOverbought`-Flags ausschließlich
**wt2** gegen Level 1 (±53): `wtOversold = wt2 <= osLevel`, `wtOverbought = wt2 >= obLevel`. Das
ist ein reales, im Code sichtbares Muster — aber es bezieht sich auf VuManChus eigene
Oversold/Overbought-Logik bei ±53, nicht notwendigerweise auf StormCat1s Wave-Anchor-Definition
bei (vermutlich) ±60.

**Korrektur gegenüber v1**: in v1 wurde wt2 als alleinige Default-Annahme für die
Forschungsimplementierung gewählt, ohne wt1 als eigenständige Testgröße zu führen. **Das wird in
v2 aufgehoben** — die Forschungsimplementierung exponiert jetzt WT1 und WT2 als vollständig
getrennte, unabhängig testbare Feature-Familien (raw value, State, Cross, Distance, Duration je
Welle), wie in Abschnitt 5 der Aufgabenstellung gefordert. Keine Annahme, welche Welle Wave Anchor
tatsächlich verwendet — beide werden empirisch geprüft.

## 4. Timeframe-Kopplung (unverändert aus v1)

**Kategorie B**: 15m-Chart überwacht 1H- und 4H-Wave; 1H-Chart überwacht 4H- und Daily-Wave. Keine
neue Information in v2 zu diesem Punkt. **Kategorie D** für alle nicht explizit genannten
Timeframe-Paare.

## 5. Anchor-Zustand: Event oder anhaltender Zustand? (unverändert aus v1)

**Kategorie D.** Wie in v1: beide Interpretationen (State UND Cross-Event) werden getrennt als
Features exponiert, siehe `WAVE-ANCHOR-FEATURE-SPECIFICATION.md`.

## 6. `security()` — Timeframe, Gaps, Lookahead, Offset — jetzt mit Primärquelle

**Kategorie C** (aus der gelieferten Primärquelle): `security(syminfo.tickerid, tf, ...)` wird
**ohne** explizite `gaps`/`lookahead`/`offset`-Parameter aufgerufen — reine 3-Parameter-Form.
Konsequenz: Pine verwendet die jeweiligen Sprachversion-Defaults. **Welche Pine-Version** dieser
Code tatsächlich deklariert (`//@version=4` wurde vom Nutzer als Kontext genannt, aber nicht als
Codezeile selbst geliefert) und was in Pine v4 konkret der Default für `lookahead` ist (nicht
identisch mit Pine v5, siehe eigenes Audit-Dokument
`WAVE-ANCHOR-PINE4-SECURITY-AUDIT.md`) — das ist der Kern eines eigenen, separaten Dokuments,
da es (Abschnitt 8 der Aufgabenstellung) als HIGH-PRIORITY-Punkt explizit angefordert wurde.

**Zusätzlicher neuer Befund**: `wt1` und `wt2` werden nicht direkt aus HTF-OHLC-Werten berechnet,
sondern aus einem bereits von `security()` abgeleiteten Zwischenausdruck (`ci`) erneut per
`security()` anfragt — eine **verschachtelte `security()`-Konstruktion**. Das ist in v1 nicht
erkannt worden (v1 hatte nur die einfache `f_getTFCandle`-Funktion mit `lookahead_on` als
Repainting-Quelle identifiziert, NICHT diese verschachtelte Struktur in `f_wavetrend` selbst).
Volle Analyse: siehe `WAVE-ANCHOR-PINE4-SECURITY-AUDIT.md`.

## 7. Divergenz-Logik, Alert-Bedingungen, Bar-State (unverändert aus v1)

Kategorie D, siehe v1-Begründung — für diese Forschung weiterhin nicht als Wave-Anchor-Feature
nachgebaut (Divergenz) bzw. irrelevant (Alerts, da keine Handelssignale erzeugt werden).

## 8. Zusammenfassung — Stand v2

| Baustein | Kategorie | Änderung ggü. v1 |
|---|---|---|
| WaveTrend-Kernformel (esa/de/ci/wt1/wt2) | C | Jetzt Primärquelle (Nutzer-geliefert) statt GitHub-Drittkopie |
| chlen=9/avg=12/malen=3 | C | Jetzt Primärquelle bestätigt |
| ±53 (Level 1) | C | Neu vollständig dokumentiert |
| ±60 (Level 2) | C (Zahlenwert) / B (Anchor-Bedeutung) | Unverändert |
| +100/-75 (Level 3) | C | **Korrigiert**: v1 nannte fälschlich "±100 vs ±75 uneinheitlich" |
| wt2 gegen Schwelle geprüft (VuManChu-eigene Logik) | C | Bestätigt, aber nur für Level 1 (±53) |
| WT1 vs. WT2 für Wave-Anchor-Zweck | D | **Beide jetzt separat getestet** (v1: nur wt2 angenommen) |
| Welches Level-Paar Wave Anchor nutzt | D | **Alle 3 Paare jetzt separat getestet** (v1: nur ±60) |
| Verschachtelte security()-Aufrufe (esa/de/ci ungewrapped, wt1/wt2 gewrapped) | C (Struktur) / D (Laufzeit-Konsequenz) | **Neu erkannt in v2**, eigenes Audit-Dokument |
| 15m→1H+4H, 1H→4H+1D Kopplung | B | Unverändert |
| Anchor = Zustand oder Cross-Event | D | Unverändert, beide exponiert |
| Divergenz-Nutzung, Alert-Bedingungen | D | Unverändert, nicht relevant |

**Konsequenz für die gesamte Untersuchung (unverändert aus v1, weiterhin gültig)**: dies ist keine
Eins-zu-eins-Rekonstruktion eines verifizierten Indikators, sondern ein Test des **Konzepts**
"HTF-WaveTrend-Extremzone als Feature", jetzt mit erheblich präziserer mathematischer Grundlage
(echte Primärquelle statt Websuche) und deutlich breiterer Testabdeckung (WT1+WT2 getrennt, alle
3 Threshold-Paare getrennt) als in v1.
