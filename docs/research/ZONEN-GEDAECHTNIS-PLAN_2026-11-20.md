# Zonen mit Gedächtnis — Plan (20.11.2026)

Toby zeichnet Unterstützungs- und Widerstandszonen in AutarkTrade. Nexus
übernimmt sie alle 5 Minuten (`own_zones`, `replace_own_zones_from_autark`),
weiss aber nicht, was an einer Zone früher passiert ist. Ziel: Nexus merkt
sich die Geschichte jeder Zone (zuerst Unterstützung, dann gebrochen, dann
Widerstand) und erinnert daran, wenn der Kurs zurückkommt.

Auslöser: die grüne 1h-Zone 76'270–76'796 (30.10.–04.11. Unterstützung,
Bruch 05.11., Retest von unten 06.–08.11. gescheitert, danach Fall bis
unter 60'000).

## Ist-Zustand: woher Nexus Zonen nimmt

| Quelle | Was | Genutzt |
|---|---|---|
| Tobys Zonen aus AutarkTrade | `own_zones`, Sync alle 5 Min., alle Zonen werden jedes Mal gelöscht und neu geschrieben | **immer**, sobald mindestens eine existiert (`activeLevels` in `lib/ownZones.ts`): Regelcheck, Plan-Satz, Stop-Berechnung, Briefing |
| Nexus-Keylevels | Pivots 1W/1D/4h/1h, Liquidations-Cluster, Spot-Volumen-Knoten (`buildKeyLevelZones` in `lib/chartStructureContext.ts`) | nur als Ersatz ohne eigene Zonen |

Keine der beiden Quellen hat ein Gedächtnis.

## Entscheidungen

1. **Die Zone ist ein Ziel, keine Vorhersage.** Nexus erinnert und zeigt,
   was in der Zone passiert, und behauptet nicht, dass sie hält. Toby
   entscheidet in der Zone.
2. **Nur Tobys AutarkTrade-Zonen** bekommen ein Gedächtnis (Entscheid A,
   20.11.2026). Nexus-Keylevels höchstens später als Abgleich (Phase 5).
3. **Die Geschichte wird aus den Kerzen berechnet, nicht gespeichert.** Das
   funktioniert rückwirkend für neu gezeichnete Zonen, übersteht den
   Autark-Sync (der alles neu schreibt) und braucht keinen neuen Sammler,
   keinen Speicher und kein zusätzliches Log-Volumen.
4. **Zeiteinheiten: 1h, 4h, 1D.** 15m entfällt (zu viel Rauschen).
5. **Gezählt werden Schlusskurse auf der Zeiteinheit der Zone.** Ein Docht
   ist eine Berührung, kein Bruch.
6. **Zeiteinheit der Zone:** Toby schreibt sie in AutarkTrade an den Anfang
   der Beschriftung („1h …“, „4h …“, „1D …“). Zonen ohne Angabe gelten als
   „unbekannt“. An AutarkTrade wird kein Code geändert.

## Begriffe (Entwurf, wird in Phase 0 festgezurrt)

Beispiel für eine Zone, die zuerst Unterstützung ist (Widerstand gespiegelt):

| Begriff | Regel |
|---|---|
| Berührung | Tief der Kerze reicht in die Zone, Schluss bleibt darüber; aufeinanderfolgende Kerzen in der Zone zählen einmal |
| Unterstützung bestätigt | mindestens 2 Berührungen |
| Bruch | Schluss unter der Zonen-Untergrenze |
| Retest | Kurs hat sich nach dem Bruch mindestens 1 ATR entfernt und läuft wieder in die Zone |
| gedreht (jetzt Widerstand) | Retest schliesst wieder unter der Zone |
| Reclaim | Schluss über der Zonen-Obergrenze; Rolle wechselt zurück |

Zustände: `unberührt → Unterstützung → gebrochen → gedreht (Widerstand)`,
mit Reclaim zurück zu `Unterstützung`.

## Phasen

Nach jeder Phase entscheidet Toby, ob es weitergeht.

| Phase | Inhalt | Ergebnis | Status |
|---|---|---|---|
| 0. Grundlagen | Begriffe oben festzurren, Konvention für Zeiteinheit in der Beschriftung | dieses Dokument | Entwurf |
| 1. Test („nett zu wissen“, keine Voraussetzung) | Passiert an gedrehten Zonen mehr als an Zufallsniveaus? Reaktion in beide Richtungen: relatives Volumen, Dochte, Spanne danach. Zonen werden dafür aus den Kerzen erkannt, weil Tobys frühere Zonen nicht gespeichert sind | Bericht auf Deutsch in `docs/research/` | erledigt, siehe `ZONEN-GEDAECHTNIS-PHASE1-TEST_2026-11-20.md` |
| 2. Version 1: Anzeige | Pro Autark-Zone Rolle und Kurzgeschichte (Daten von Berührungen, Bruch, Retest) in der Zonen-Kachel. Logik in `lib/` mit Tests, Handy-Ansicht 400 × 800 prüfen | sichtbare Erinnerung | offen |
| 3. Version 2: In der Zone | Kurs in der Zone: Dochte und Schlüsse, CVD, OI-Veränderung, Liquidationen (Long/Short), Orderbuch-Wände als neutrale Zusammenfassung | „Was passiert hier?“-Block | offen |
| 4. Version 3: Alarme | Push bei Annäherung (ATR-Abstand), Eintritt und Ergebnis (akzeptiert / abgelehnt). Nur gedrehte oder starke Zonen. Log-Kontingent vorher abschätzen und Toby fragen | Push-Nachrichten | offen |
| 5. Später, optional | Nexus-Keylevels als Abgleich: „Diese gedrehte Zone fehlt bei dir“ | Vorschläge, Nexus zeichnet nichts selbst | offen |

## Phase 1 im Detail

- **Daten:** Binance-Futures-Kerzen BTCUSDT 1h/4h/1D, 08.2022–19.11.2026, aus
  dem öffentlichen Archiv `data.binance.vision` (dieselbe Börse wie
  `collect-candles`). Aufbereitung: `research-python/zone_flip_research/build_data.py`.
  Rohdaten und CSVs bleiben ausserhalb von Git. Abgleich mit Nexus-`candles`
  stimmt (z. B. 05.11.2026 Eröffnung 80'466,4).
- **Zonen erkennen:** Pivot-Tiefs und -Hochs, erst nach Bestätigung bekannt
  (kein Blick in die Zukunft), Breite aus Docht bis Kerzenkörper, begrenzt
  durch ATR.
- **Vergleich:** erste Rückkehr an eine gedrehte Zone gegenüber
  (a) Zufallsniveaus auf dem Weg dorthin, zur selben Zeit, im selben Abstand,
  und (b) ganz zufälligen Niveaus. Niveaus nahe bekannter Pivots werden
  ausgeschlossen.
- **Messgrössen** (Reaktion in beide Richtungen): relatives Volumen,
  Dochtlänge im Verhältnis zur ATR, Spanne danach (1h: 12 Kerzen, 4h: 12,
  1D: 5). Beschreibend dazu: abgelehnt / akzeptiert.
- **Unsicherheit:** Bootstrap über Kalendermonate (Ereignisse überlappen).
- **Kontrolle:** Findet die Erkennung die Zone 76'270–76'796 vom 05.11.?
- **Liquidationen** nur als Randnotiz (Daten erst ab 08.2026, unvollständig).
- **Nichts in die Live-Datenbank** (Lehre aus Oktober 2026, siehe CLAUDE.md).

## Grenzen

- Die Regeln (Berührung, Zonenbreite, Linien ohne Breite wie 59'550)
  entscheiden über die Qualität und müssen an echten Zonen geprüft werden.
- Zu viele Alarme bei vielen Zonen: deshalb nur gedrehte oder starke Zonen.
- Löscht Toby eine Zone in AutarkTrade, verschwindet sie auch in Nexus;
  zeichnet er sie neu, ist die Geschichte dank Berechnung aus Kerzen sofort
  wieder da.
