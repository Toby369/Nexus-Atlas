# Zonen mit Gedächtnis — Phase 1: Test (20.11.2026)

Plan: `ZONEN-GEDAECHTNIS-PLAN_2026-11-20.md`. Code:
`research-python/zone_flip_research/` (`build_data.py`, `analysis.py`, Tests).
Nichts wurde in die Live-Datenbank geschrieben.

**Frage („nett zu wissen“, keine Voraussetzung):** Passiert an gedrehten
Zonen mehr als anderswo? Gemeint ist eine Reaktion in beide Richtungen.

## Kurzfassung

1. **Ja, etwas mehr, vor allem beim Volumen.** Kehrt der Kurs an eine
   gedrehte 1h- oder 4h-Zone zurück, ist das Volumen rund **30 % höher** als
   an einem Niveau auf demselben Weg dorthin. Dochte und Spanne danach sind
   leicht höher (1h: +9 % und +16 %). Bei 1D sind die Dochte etwa doppelt so
   lang, bei nur 78 Fällen.
2. **Die Zone sagt nicht voraus, ob sie hält.** Abgelehnt werden etwa 50–58 %
   der Rückkehrer, an Zufallsniveaus ähnlich viele. Das bestätigt den
   Grundsatz „Zone = Ziel, keine Vorhersage“.
3. **Wichtigste Erkenntnis für die Regeln (Phase 0): Fehlausbrüche.** Ein
   Drittel aller „Brüche“ kommt innerhalb von 3 Kerzen zurück. Beispiel: Die
   grüne Zone wurde nach der strengen Regel am **04.11. um 02:00 UTC
   gebrochen** (1h-Schluss 76'127,8) und war 2 Stunden später wieder darüber.
   Toby hat das richtig als Docht und Fehlausbruch gelesen. Ohne diese Fälle
   wird der Effekt deutlicher.

## Daten und Vorgehen

- Binance-Futures BTCUSDT, 1h / 4h / 1D, 08.2022–19.11.2026 (öffentliches
  Archiv, gleiche Börse wie `collect-candles`, mit Nexus-`candles` abgeglichen).
- Zonen erkennt das Skript selbst aus Pivots, weil Tobys frühere Zonen nicht
  gespeichert sind. Ein Pivot ist erst k Kerzen später bekannt; ein Test
  prüft, dass kein Blick in die Zukunft entsteht.
- Ereignis = erste Rückkehr in eine gebrochene Zone, nachdem sich der Kurs
  mindestens 1 ATR entfernt hat (ex-Unterstützung von unten, ex-Widerstand
  von oben).
- Messgrössen ab der Rückkehr-Kerze: **Volumen** (3 Kerzen gegenüber dem
  Median der 20 davor), **Docht** (Mittel aus 3 Kerzen, in ATR), **Spanne**
  (1h und 4h: 12 Kerzen, 1D: 5 Kerzen, in ATR).
- Vergleich:
  - **„auf dem Weg“** (fairer Vergleich): Niveaus zwischen dem Extrem nach
    dem Bruch und der Zone, gleiche Zeit, gleiche Bewegung, gleiche Breite.
  - **„zufällig“**: Zufallszeitpunkt, Niveau 1–4 ATR entfernt.
  - Kontrollniveaus nahe bekannter Pivots sind ausgeschlossen.
- Unsicherheit: 95-%-Intervall per Bootstrap über Kalendermonate.

## Ergebnis ohne Fehlausbrüche (Rückkehr frühestens 4 Kerzen nach dem Bruch)

Verhältnis = Median an der Zone geteilt durch Median an der Kontrolle
(1,30 = 30 % mehr). Fettgedruckt: Das Intervall liegt ganz über 1.

| TF | n Zonen | Volumen | Docht | Spanne |
|---|---|---|---|---|
| 1h | 1324 | **1,31** (1,09–1,48) | **1,09** (1,00–1,18) | **1,16** (1,07–1,26) |
| 4h | 336 | **1,27** (1,05–1,41) | 1,07 (0,92–1,23) | 1,10 (0,89–1,33) |
| 1D | 78 | 1,22 (0,70–1,89) | **2,00** (1,18–2,22) | 1,44 (0,85–1,87) |

Mit allen Fällen, also inklusive Fehlausbrüchen, ist der Effekt kleiner
(1h Volumen 1,16, 4h 1,18, Intervalle knapp an 1).

**Stabil:** 2022–2024 und 2025–2026 zeigen ähnliche Werte. Zonen mit einer
Berührung und mit zwei oder mehr unterscheiden sich kaum.

## Was das Ergebnis nicht zeigt

- **Gegen ganz zufällige Niveaus** zeigen die Zonen sogar *weniger* Volumen
  und Dochte. Dieser Vergleich ist aber unfair: Zufallsniveaus werden meist
  in starken Ausbrüchen in neues Gebiet erreicht (Median-Volumen 3,6-fach).
  Die Rückkehr an eine Zone ist dagegen eine Gegenbewegung. Aussagekräftig
  ist deshalb der Vergleich „auf dem Weg“.
- „Abgelehnt / akzeptiert“ lässt sich mit „auf dem Weg“ nicht vergleichen,
  denn diese Niveaus liegen per Konstruktion vor der Zone und werden danach
  überschritten.
- Die Zonen stammen aus einer Pivot-Erkennung, nicht von Toby. Seine Zonen
  sind ausgewählter; der Effekt könnte dort grösser oder kleiner sein.
- Liquidationen sind nicht enthalten (Daten erst ab 08.2026, unvollständig).

## Kontrolle mit der grünen Zone

Die Erkennung findet 76'444–76'796 (Toby: 76'270–76'796), Pivot 30.10.,
**6 Berührungen**. Sie wertet aber den 04.11. 02:00 als Bruch und 04:00 als
Rückkehr. Damit endet die Zone im Test schon dort; den echten Bruch vom
05.11. (erste 1h-Schlüsse darunter ab 15:00 UTC) sieht der Test nicht mehr.

## Folgen für den Plan

1. **Neue Regel für Phase 0: Bruch bestätigen.** Vorschlag: Ein Bruch gilt
   erst, wenn **2 Schlüsse in Folge** unter der Zone liegen oder der Kurs
   innerhalb von **3 Kerzen** nicht zurückkehrt. Sonst ist es ein
   **Fehlausbruch** und zählt als Berührung. Am Beispiel: Der 04.11. wäre
   eine Berührung (die 7.), der 05.11. der echte Bruch.
2. **Die Anzeige muss den ganzen Lebenslauf zeigen**, nicht nur bis zur
   ersten Rückkehr: Berührung → Fehlausbruch → Bruch → Retest → gedreht →
   eventuell Reclaim.
3. **Die Nutzung bestätigt sich:** An gedrehten Zonen passiert messbar mehr,
   vor allem beim Volumen; die Richtung bleibt offen. Das passt zu „Ziel, dann
   in der Zone beobachten“ (Phase 3).
4. Phase 1 ist damit abgeschlossen. Weiter mit Phase 2 erst nach Tobys
   Entscheid über die Fehlausbruch-Regel.

## Nachrechnen

```
cd research-python/zone_flip_research/data/raw  # Zips von data.binance.vision, siehe Plan
cd research-python
python3 -I zone_flip_research/build_data.py
python3 -m zone_flip_research.analysis --report zone_flip_research/output/ergebnis_alle.md
python3 -m zone_flip_research.analysis --min-kerzen 3 --report zone_flip_research/output/ergebnis_ohne_fehlausbruch.md
python3 -m pytest -q zone_flip_research/tests
```
