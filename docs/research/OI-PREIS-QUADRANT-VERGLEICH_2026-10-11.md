# OI/Preis-Quadrant: Vergleich der zwei Berechnungen — 2026-10-11

Entscheidungsvorlage für den Backlog-Punkt "OI/Preis-Quadrant: zwei unabhängige Berechnungen
derselben Taxonomie" (`IDEEN-BACKLOG.md`), Phase 2 der Aufräumrunde
(`NEXUS-STRUKTUR-KONZEPT_2026-09-12.md`, Abschnitt 8).

## Die zwei Berechnungen

| | **Marktphase-Kachel** (`market_state_matrix.oi_price_quadrant`) | **Marktkontext-Kachel** (`lib/marketContext.ts::classifyMarketContext`) |
|---|---|---|
| Berechnet in | Datenbank (`compute_market_state_matrix_series`) | Frontend |
| Zeitfenster | fest 6h (6 × 1h-Kerzen) | gewählter Zeitraum (Zeitraum-Auswahl oben) |
| Open Interest | eine Börse | Summe über alle Börsen, mit Sperre bei Börsen-Onboarding |
| Totzone ("keine klare Struktur") | **keine** — jede Bewegung > 0 zählt | ±0,4 % × √(Zeitraum/1h), bei 6h ≈ ±0,98 % |
| Spot-Bestätigung | nein | ja (bestätigt / unbestätigt) |
| Datenqualitäts-Kennzeichnung | nein | ja (OK / vorläufig / gesperrt) |
| Weiterverwendet | Forschungs-Signal "OI-Quadrant (Buildup)" für den Regime-Score (`research_regime_extend_activation_round2`) | nur Anzeige |

## Live-Befund (letzte 30 Tage, 719 Stundenwerte)

| Quadrant (Marktphase) | Anzahl | davon nach Marktkontext-Regel (6h) "keine klare Struktur" |
|---|---|---|
| Short-Covering | 226 | 213 |
| Long-Aufbau | 169 | 142 |
| Long-Abbau | 162 | 137 |
| Short-Aufbau | 162 | 144 |
| **Summe** | **719** | **636 (88 %)** |

Die Marktphase-Kachel zeigt also **immer** einen der vier Quadranten an. In 88 % der Fälle
beruht das aber auf einer Bewegung, die die Marktkontext-Regel als zu klein für eine
belastbare Aussage einstuft. Das erklärt, warum beide Kacheln oft Unterschiedliches zeigen.

## Empfehlung

**Marktkontext ist die Anzeige für den Nutzer, die DB-Berechnung bleibt als Forschungs-Input.**

1. In der Marktphase-Kachel die Zeile "OI/Preis-Quadrant" entfernen (die Rohwerte
   "Preis-Δ (6h)" und "OI-Δ (6h)" bleiben sichtbar). Begründung: ohne Totzone ist der Wert
   meist Rauschen und widerspricht scheinbar der Marktkontext-Kachel.
2. Die DB-Spalte `oi_price_quadrant` und ihre Berechnung **nicht** anfassen: sie speist das
   Forschungs-Signal "OI-Quadrant (Buildup)" des Regime-Scores. Eine Änderung dort würde
   laufende Forschungsergebnisse verändern.
3. Alternative zu 1.: Zeile behalten, aber mit Hinweis "ohne Mindestbewegung, kann von der
   Marktkontext-Kachel abweichen" (Variante b aus dem Backlog).

**Entscheidung (Toby, 11.10.2026): Empfehlung 1+2 umgesetzt** — Zeile in der Marktphase-Kachel
entfernt, Info-Texte angepasst, DB-Spalte unverändert.
