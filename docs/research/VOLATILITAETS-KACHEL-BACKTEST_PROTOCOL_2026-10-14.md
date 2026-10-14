# Volatilitäts-Kachel — Backtest-Protokoll, vorregistriert (14.10.2026)

Prüft die Aussagen der Kachel „Volatilitäts-Lage“ (`lib/volatility.ts`,
`components/VolatilityCard.tsx`), bevor irgendein Ergebnis angesehen wurde. Der
Skew-Pfeil ist **nicht** Teil dieses Tests: Historische Optionspreise je Strike gibt es
nicht gratis. Er wird ab 14.10.2026 gesammelt und separat geprüft (siehe Abschnitt 6).

## 1. Daten

- **DVOL** (Deribit, Tageskerzen, Schlusswert = Stand 00:00 UTC des Folgetags), über die
  öffentliche API, exportiert als CSV mit Prüfsumme.
- **BTC-Kurs:** Binance-Futures-1h-Kerzen aus Supabase (`candles`), dieselbe Quelle wie
  die Kachel. Kurs an Tag t = Schlusskurs der 1h-Kerze 23:00–00:00 UTC.
- **Zeitraum:** alle Tage, an denen DVOL und 1h-Kerzen vorliegen und das
  Vorwärtsfenster vollständig ist (ab 04.09.2022 plus Einlaufzeit für 30 Tage
  Rückblick bzw. 365 Tage für das Perzentil).
- **Realisierte Volatilität** wie in der Kachel (`realizedVolPct`): Standardabweichung
  der stündlichen Log-Renditen, annualisiert mit √(24·365).

Alle Grössen an Tag t verwenden nur Daten bis einschliesslich t. Vorwärtsgrössen
beginnen nach t.

## 2. Aussage A — Kalibrierung der erwarteten Spanne

Die Kachel sagt: Mit rund 68 % liegt der Kurs nach h Tagen in
`Kurs_t · e^(±σ_t·√(h/365))`, σ_t = DVOL_t / 100.

- Für h ∈ {1, 7, 30}: **Trefferquote** = Anteil der Tage mit
  |ln(P_{t+h}/P_t)| ≤ σ_t·√(h/365).
- **H-A (je h):** Die Trefferquote weicht von 68,27 % ab (zweiseitig).
- Zusätzlich beschreibend: Mittelwert von z² mit z = ln(P_{t+h}/P_t) / (σ_t·√(h/365)).
  1 heisst kalibriert, < 1 heisst, die Optionen überschätzen die Bewegung.

## 3. Aussage B — „Sehr ruhig, auf tiefe Volatilität folgt oft eine Ausdehnung“

- Perzentil_t = Rang von DVOL_t unter den DVOL-Schlusswerten der 365 Tage bis t (wie
  `percentileRank`). „Sehr ruhig“ = Perzentil < 20.
- Ausdehnung_t = ln(RV_vorwärts30 / RV_rückwärts30). RV_rückwärts30 sind die 720
  Stunden bis t, RV_vorwärts30 die 720 Stunden ab t.
- **H-B:** Die mittlere Ausdehnung ist bei Perzentil < 20 grösser als an allen übrigen
  Tagen (einseitig).

## 4. Aussage C — „Implizit vs. realisiert“

Die Kachel ordnet die Differenz D_t = IV_t − RV_rückwärts30 ein. Getestet wird mit DVOL
als IV, weil es keine historische 30-Tage-ATM-IV gibt. Schwellen wie in der Kachel:

- **H-C1:** Bei D > +10 („Optionen teuer, erwartet mehr Bewegung als zuletzt“) ist die
  mittlere Ausdehnung grösser als bei −5 ≤ D ≤ +10 (einseitig).
- **H-C2:** Bei D < −5 („Optionen billig, der Kurs bewegt sich mehr als eingepreist“)
  ist RV_vorwärts30 im Mittel grösser als DVOL_t, d. h. die Optionen waren tatsächlich
  zu billig (einseitig, Mittelwert von RV_vorwärts30 − DVOL_t > 0).

Zusätzlich beschreibend: mittlere Volatilitäts-Risikoprämie DVOL_t − RV_vorwärts30 über
alle Tage.

## 5. Statistik und Entscheidung

- **Überlappende Fenster:** Tageswerte mit 7- bzw. 30-Tage-Vorwärtsfenster sind stark
  abhängig. Konfidenzintervalle und p-Werte deshalb per Moving Block Bootstrap
  (`research-python/src/validation/block_bootstrap.py`), Blocklänge = max(14, h)
  Tage, 10'000 Wiederholungen, Seed 20261014. Gruppenvergleiche bootstrappen die
  Differenz der Gruppenmittel auf der vollen Tagesreihe (Maske je Gruppe).
- **Mehrfachtest:** Holm über H-A(1), H-A(7), H-A(30), H-B, H-C1, H-C2, α = 0,05.
- **Mindestgrösse:** Gruppen unter 60 Tagen → `INSUFFICIENT_DATA`. Die effektive
  Stichprobe bei 30-Tage-Fenstern ist klein (rund 1'400 Tage / 30 ≈ 47 unabhängige
  Fenster). Das steht im Bericht.

**Folgen für die Kachel (vorab festgelegt):**

| Ergebnis | Änderung an der Kachel |
|---|---|
| H-A bestätigt (Trefferquote ≠ 68 %) | Neben „68 %“ die historische Trefferquote je Zeitraum anzeigen |
| H-A nicht bestätigt | „68 %“ bleibt, Info-Text nennt die gemessene Quote |
| H-B nicht bestätigt | Text „auf tiefe Volatilität folgt oft eine Ausdehnung“ entfernen oder abschwächen |
| H-C1/H-C2 nicht bestätigt | Einordnungstexte neutral formulieren („Optionen teurer/billiger als die letzten 30 Tage“) statt Erwartungsaussagen |
| bestätigt | Text bleibt, Info-Text nennt die Messung |

## 6. Skew-Pfeil (separat, vorwärts)

Ab 14.10.2026 speichert `collect-options` alle 30 Minuten zusätzlich die
30-Tage-ATM-IV und den 30-Tage-Skew (gleiche Rechnung wie die Kachel). Kontrolltermine
und Testplan: `docs/research/SKEW-PFEIL-VORWAERTSTEST.md`.
