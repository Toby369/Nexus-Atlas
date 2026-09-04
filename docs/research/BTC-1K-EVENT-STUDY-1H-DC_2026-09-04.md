# Event-Studie 2: Directional-Change-Events auf 1h, Einzelsignal- und Paar-Analyse

Auftrag von Toby: eigenes Testverfahren für $1000-Preisbewegungen mit max. 5%
Rücklauf, pro Signal prüfen ob/wie oft es korrekt war, und ob 2er-Kombinationen
von Signalen wiederkehrende, stärkere Muster zeigen. Vorarbeit zu
`BTC-1K-EVENT-STUDY_2026-09-03.md` (die auf 4h-Einzelkerzen ohne Rücklauf-Filter
beruhte) — hier: 1h, echter Directional-Change-Algorithmus, zwei parallel
verglichene Boden-Varianten (auf Tobys Wunsch), Paar-Suche auf 15 vorregistrierte
Kombinationen begrenzt (Overfitting-Risiko, siehe Rücksprache).

## 1. Vorab behobener Datenfehler

Bevor überhaupt ausgewertet wurde: `backtest_states` für Interval `1h` hatte
denselben Fehler wie zuvor bei `1d` (siehe `PHASE-1B-...md` Abschnitt 1) — die
ursprüngliche Rekonstruktion lief, bevor der Funding/Macro/Sentiment-Backfill
abgeschlossen war, und wurde wegen `ON CONFLICT DO NOTHING` nie nachgezogen.
Vor dem Fix: Funding/Macro/Sentiment bei 0% Abdeckung für Sep 2024–Jul 2026.
17.062 Zeilen neu rekonstruiert (in 6 Blöcken wegen Laufzeit). Nach dem Fix:
Funding 99.7%, Macro 98.5%, Sentiment 17.4% (Sentiment bleibt strukturell
niedrig — täglicher Fear&Greed-Snapshot passt nur in ein enges 3h-Zeitfenster,
kein Bug, siehe Abschnitt 4). Positioning/Orderbook/Options/OI-Preis/Basis
bleiben bei <0.3% (Börsen-Historie hart auf ~30 Tage gedeckelt, unveränderbar).

## 2. Event-Definition (Directional Change)

Sequenzieller, nicht überlappender Zigzag-Scan über alle 1h-Kerzen
(`research_directional_change_events()`, neue SQL-Funktion, additiv):

- **Ziel**: Nettobewegung ≥ $1000 vom Einstiegspunkt.
- **Boden**: zwei parallel geprüfte Varianten (Rücksprache mit Toby: "beide
  nebeneinander laufen lassen"):
  - `trailing` — 5% unter dem bisher erreichten Extrem der Bewegung (Standard
    "Directional Change"-Literatur, Guillaume et al.)
  - `fixed` — 5% unter dem ursprünglichen Einstiegspreis (Tobys wörtliche
    Formulierung)
- **Intrabar-Mehrdeutigkeit**: wenn eine einzelne Kerze sowohl Ziel- als auch
  Boden-Bedingung erfüllen könnte, gewinnt konservativ immer der Boden (keine
  optimistische Reihenfolge unterstellt).
- **Signal-Fenster**: `backtest_states` der unmittelbar vorangehenden 1h-Kerze
  (point-in-time-safe, exakt wie in allen bisherigen Phasen).

## 3. Event-Statistik

| Boden-Modus | Events gesamt | UP | DOWN | Ø Dauer | Min/Max Dauer |
|---|---|---|---|---|---|
| trailing | 1959 | 986 | 973 | 8.7h | 0.0h / 320h |
| fixed | 1783 | 895 | 888 | 9.7h | 0.0h / 365h |

**Wichtige Einordnung, bevor irgendein Ergebnis interpretiert wird:** Bei
$1000/1h-Kerze mit nur 5% Boden ist das **kein seltenes Großereignis** mehr,
sondern praktisch die komplette Zigzag-Zerlegung der gesamten 2-Jahres-Historie
— im Schnitt alle 8.7–9.7 Stunden ein bestätigtes Event. Zum Vergleich: die
erste Event-Studie (4h, keine Rücklauf-Grenze) fand nur 14 Events in 7 Wochen
(4.7% Basisrate). Das hier ist etwas anderes: eine flächendeckende
Trendsegmentierung, kein Filter auf besonders bedeutsame Bewegungen. Für die
Fragestellung ("welche Signale/Kombinationen erkennen bevorstehende große
Bewegungen") ist das nicht falsch, aber die Ergebnisse unten sagen eher etwas
über "was ist typisch vor irgendeiner Fortsetzung/Umkehr" als über "was ist
typisch vor einem seltenen Ausbruch".

## 4. Einzelsignal-Ergebnis (6 durchgehend abgedeckte Faktoren, `trailing`, n=973–986)

| Faktor | DOWN Lift | UP Lift |
|---|---|---|
| trend_regime | +9.1pp | −8.7pp |
| trend_strength | +7.9pp | −4.0pp |
| momentum | +5.1pp | −5.1pp |
| structure | +5.0pp | −10.9pp |
| vwap_position | +1.1pp | −10.2pp |
| cvd | +0.2pp | −9.7pp |

**Ein klares, durchgängiges Muster über alle 6 Faktoren:** vor DOWN-Events
liegt der jeweilige Faktor öfter (leicht bis moderat) schon bärisch als der
Basisdurchschnitt — vor UP-Events liegt er dagegen **seltener** bullisch als
der Durchschnitt, in einigen Fällen deutlich (−9 bis −11pp). Unter `fixed`
praktisch identisch (max. 1pp Abweichung je Zelle) — das Muster ist robust
gegenüber der Boden-Wahl, kein Artefakt der Parametrisierung.

**Ökonomische Lesart**: Down-Moves in diesem Datensatz laufen eher als
Fortsetzung eines bereits erkannten Bärentrends (Momentum-Charakter).
Up-Moves starten dagegen öfter aus einem NICHT bereits bullischen Zustand
heraus (Erholungs-/Short-Squeeze-Charakter) — nicht ungewöhnlich für Krypto,
aber das Gegenteil von "Trendfaktor bullisch → Aufwärtsbewegung folgt".

**Andere Faktoren**: `funding` bleibt inert (Lift ≈0, deckt sich mit dem
bereits dokumentierten Threshold-Befund). `macro` schwach (+1.8/+3.4pp).
`sentiment` zeigt große Lift-Zahlen (+32.6/+10.5pp), aber nur auf 17% der
Fälle (n=155–169) — nicht vertrauenswürdig ohne weitere Prüfung, ob diese
Teilstichprobe repräsentativ ist (sie ist es wahrscheinlich nicht, siehe
Abschnitt 1). `positioning`/`orderbook`/`options`/`oi_price`/`basis`: n=1–3,
nicht auswertbar.

## 5. Paar-Analyse (15 vorregistrierte Kombinationen × 2 Richtungen = 30 Tests)

Nur die 6 durchgehend abgedeckten Faktoren, alle C(6,2)=15 Paare, **vor** dem
Blick auf Ergebnisse festgelegt (kein Nachträglich-Aussuchen). Getestet: wie
oft stimmen BEIDE Faktoren eines Paars mit der Event-Richtung überein,
verglichen mit der unkonditionierten Basisrate dieser Übereinstimmung.

**Ergebnis: 27 von 30 Zellen signifikant nach Benjamini-Hochberg (α=0.05).**
Stärkste Paare (DOWN): `structure`+`trend_regime` (+11.15pp, p≈0),
`trend_strength`+`trend_regime` (+10.97pp, p≈0). Stärkste (UP, negativ):
`structure`+`vwap_position` (−8.37pp), `structure`+`cvd` (−7.11pp).

**Zwei Gründe, warum das trotzdem NICHT als "stärkeres Kombisignal" zu werten
ist:**

1. **Events sind nicht unabhängig.** Der Zigzag-Scan erzeugt sequenzielle,
   aneinandergereihte Events (Ø alle 8.7h eines) — in einer mehrtägigen
   Trendphase teilen sich Dutzende aufeinanderfolgende DOWN-Events denselben
   zugrundeliegenden Markt-Regime-Zustand. Das ist exakt dieselbe
   Pseudo-Replikations-Problematik wie die MA(H-1)-Autokorrelation aus
   `PHASE-0-RECONCILIATION.md` Abschnitt 3, hier auf der Event-Ebene statt der
   Label-Ebene. Die tatsächliche Zahl unabhängiger "Regime-Phasen" liegt
   vermutlich um Größenordnungen unter n=973–986 — die p-Werte oben sind
   dadurch massiv zu optimistisch (zu niedrig), die BH-Korrektur rechnet mit
   der rohen (falschen) Stichprobengröße.
2. **Keine echte Synergie gegenüber dem Einzelsignal.** Das stärkste Paar
   (`structure`+`trend_regime`, DOWN, +11.15pp) übertrifft den stärkeren der
   beiden Einzelfaktoren (`trend_regime` allein: +9.1pp) nur um 2pp — kein
   Sprung, der auf echten Kombinationsgewinn hindeutet. Das deckt sich exakt
   mit dem bereits in Phase 6 dokumentierten Befund: `structure`,
   `trend_regime`, `trend_strength` korrelieren stark (r=0.53–0.72 auf TRAIN)
   — ein "Paar" aus zwei bereits redundanten Trendfaktoren zählt im
   Wesentlichen dieselbe Information doppelt, keine zusätzliche.

## 6. Fazit — direkte Antwort auf die Ausgangsfrage

**"Signale höher gewichten, wenn sie in Kombination immer wieder auftreten"
— nicht durch diesen Test gestützt.** Die Paare, die am häufigsten
"übereinstimmen", sind exakt die bereits als redundant bekannten Trendfaktoren
— eine höhere Gewichtung würde nur verstärken, was schon mehrfach
(`INSTITUTIONAL_COMPARE.md`, `phase6-factor-diagnostics.md`, Redundanzanalyse)
als Doppelzählung desselben Trendsignals identifiziert wurde, nicht neue
Information hinzufügen.

**Was der Test wirklich zeigt** (robust unter beiden Boden-Varianten,
n≈1000): die 6 Trend-/Struktur-Faktoren sind ein **Regime-/Fortsetzungssignal
für Abwärtsbewegungen**, aber ein **Kontra-Indikator-artiges Signal vor
Aufwärtsbewegungen** — Aufwärts-Events starten eher aus einem noch nicht
bullischen Zustand heraus. Das ist eine neue, robuste Beobachtung (nicht in
der ersten Event-Studie sichtbar, weil die vorherige Stichprobe zu klein und
richtungsblind ausgewertet war) — aber es ist ein Regime-Charakteristikum,
keine handlungsfähige "Signalstärke"-Kombination, und die Paar-Signifikanz ist
wegen der Event-Autokorrelation (Punkt 1 oben) mit Vorsicht zu lesen.

**Empfehlung:** keine Score-Gewichtung basierend auf diesen Kombinationen
einführen. Falls die Asymmetrie (DOWN=Fortsetzung, UP=Kontra) weiterverfolgt
werden soll, wäre der nächste saubere Schritt eine **regime-blockweise**
Auswertung (nicht event-weise) — z.B. non-overlapping Trendphasen statt
einzelner Zigzag-Legs — um die Autokorrelation aus Punkt 1 direkt zu
adressieren, statt sie nur zu benennen.

Kein Automatismus, keine Anlageberatung, keine Production-Änderung.
