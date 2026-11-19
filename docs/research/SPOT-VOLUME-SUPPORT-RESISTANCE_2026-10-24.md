# Spot-Volumen als Support/Resistance -- Status & offener Nachcheck

**Datum:** 24.10.2026 (erster valider Testversuch), 19.11.2026 (zweiter
Nachcheck, erneut zu wenig Daten -- siehe unten). Naechster Schritt mit
Toby noch zu klaeren (kein neuer Termin automatisch gesetzt).

## Hypothese

Hohes Kauf-Volumen (Taker-Buy) bei Preis X wirkt als Unterstuetzung (Preis
reagiert dort mit einem Bounce), hohes Verkaufs-Volumen (Taker-Sell) als
Widerstand -- klassische Spot-Volume-Profile-Logik.

## Datengrundlage

Seit 30.09.2026 sammelt die Edge Function `collect-spot-volume-profile`
(nicht in diesem Repo) lueckenlos Binance-Spot-Aggregated-Trades (echter
Taker-Buy/Sell-Split) in $200-Preis-Buckets, Tabelle `spot_volume_buckets`
(Supabase project_id `cpktesxmbqrzpsurntul`). Schema: `bucket_time_utc`,
`exchange`, `symbol`, `price_bucket`, `buy_volume`, `sell_volume`,
`trade_count`.

Am 02.10.2026 waren erst ~2 Tage Historie da (1333 Zeilen, 42 Buckets) --
zu wenig fuer eine Auswertung. Am 24.10.2026 waren es 12.901 Zeilen ueber
23,4 Tage, 75 distinkte Preis-Buckets -- von der Zeilenzahl her
ausreichend fuer einen ersten validen Versuch.

## Methodik (24.10.2026-Check)

Um Look-ahead-Bias zu vermeiden, zeitlich sauber gesplittet:

- **Formation-Fenster** (30.09.-11.10., ~11 Tage): daraus Buy/Sell-Netto-
  Imbalance je Preis-Bucket berechnet (`(buy-sell)/(buy+sell)`), nur
  Buckets aus der oberen Volumen-Haelfte beruecksichtigt (Rauschfilter).
- **Test-Fenster** (12.10.-24.10., ~12 Tage): geprueft, wie der Preis
  (1H-Kerzen) bei spaeteren Annaeherungen an die im Formation-Fenster als
  stark imbalanced (|Netto-Imbalance| > 5%) identifizierten Levels
  tatsaechlich reagiert hat.

17 Kandidaten-Levels gefunden: 6 Support-Kandidaten (82.500-83.100,
buy-dominiert), 10 Resistance-Kandidaten (84.700-86.600, sell-dominiert).

## Ergebnis (24.10.2026): zu wenig unabhaengige Testfaelle

Nicht die Zeilenzahl war das Problem, sondern die Anzahl **unabhaengiger**
Annaeherungs-Episoden im Test-Fenster:

- **Resistance-Seite:** Preis bewegte sich im Test-Fenster nur zwischen
  79.179 und 84.875 -- 9 von 10 Resistance-Kandidaten (85.300-86.600)
  wurden **kein einziges Mal** wieder angelaufen. Nur der niedrigste
  (84.700) wurde kurz gestreift (21.10., eine einzelne zusammenhaengende
  5-Stunden-Bewegung -- ein Einzelfall, kein wiederholter Test).
- **Support-Seite:** ~60 Kerzen-Treffer, zerfallen aber bei genauem
  Hinsehen in nur 2-3 zusammenhaengende Konsolidierungsphasen
  (12.-14.10. und 19.-22.10.) statt unabhaengiger Einzelereignisse.

**Grund:** BTC ist im Beobachtungsfenster strukturell von ~87k auf ~80k
gefallen (Trend, keine Seitwaertsrange) -- die frueh gebildeten (hoeheren)
Resistance-Levels wurden schlicht nie wieder getestet.

**Fazit:** Bewusst **kein** Ergebnis zur Hypothese gemeldet (weder "traegt"
noch "traegt nicht") -- mit effektiv 0 unabhaengigen Resistance-Tests und
2-3 nicht-unabhaengigen Support-Episoden ist die MIN_SAMPLE-Schwelle (10,
analog `lib/signalReviewContext.ts`) bei Weitem nicht erreicht. Ehrliche
"zu wenig Daten"-Kennzeichnung statt erzwungener Aussage, wie im
Projekt-Standard ueblich.

## Nachcheck 19.11.2026: wieder zu wenig Daten -- Grund diesmal deutlicher

Datengrundlage inzwischen 29.491 Zeilen, 49,6 Tage, 253 Preis-Buckets --
Zeilenzahl kein Problem mehr. Split wiederholt: Formation 30.09.-25.10.
(~25 Tage), Test 25.10.-19.11. (~25 Tage). 14 Kandidaten-Levels gefunden
(7 Support: 81.300-82.600, 7 Resistance: 80.800-85.500, je |Netto-
Imbalance| > 5%, obere Volumen-Haelfte).

**Befund:** BTC ist im Test-Fenster nicht etwa seitwaerts gelaufen,
sondern in einem einzigen anhaltenden Abwaertstrend von ~82k auf ~62k
gefallen (-29% in den sieben Wochen seit Anfang Oktober, siehe
`docs/UEBERGABE.md`/Tagescharts fuer Kontext). Entsprechend:

- **Resistance-Seite:** Nur 3 von 7 Kandidaten ueberhaupt beruehrt, und
  zwar alle in EINER zusammenhaengenden Bewegung vom 25.10. bis 05.11. --
  der Preis ist durch diese Level einmal durchgefallen, nicht wiederholt
  angelaufen. Keine unabhaengige Episode.
- **Support-Seite:** 5 von 7 Kandidaten beruehrt, aber alle innerhalb von
  nur 2 Tagen (28.-29.10.) -- wieder eine einzige durchlaufende Bewegung,
  keine wiederholten, unabhaengigen Tests.

**Effektiv 0 unabhaengige Episoden auf beiden Seiten** -- sogar weniger
als beim ersten Check am 24.10. Kein Ergebnis zur Hypothese gemeldet,
erneut ehrlich als "zu wenig Daten" gekennzeichnet.

**Wichtiger Unterschied zum ersten Check:** Es ist nicht mehr nur "noch
nicht genug Zeit vergangen" -- der Markt ist jetzt seit **sieben Wochen
ununterbrochen trendend**, nicht ein einziges Mal seitwaerts/range-bound.
Diese Test-Methodik (Formation-Fenster vs. spaeteres Retest-Fenster)
braucht aber zwingend wiederholte Annaeherungen an dieselben Level, um
unabhaengige Stichproben zu erzeugen -- die bekommt sie in einem reinen
Trendmarkt strukturell nicht, unabhaengig davon, wie viel Kalenderzeit
vergeht. Blosses Weiterwarten loest das moeglicherweise nicht.

**Offen fuer Toby zu entscheiden (noch keine neue Erinnerung gesetzt):**

1. Trotzdem weiter warten (z. B. 6 statt 3 Wochen bis zum naechsten
   Check), in der Annahme, dass der Markt irgendwann wieder in eine Range
   uebergeht, oder
2. Die Test-Methodik ueberdenken -- z. B. statt eines einzigen
   Formation/Test-Splits ueber die GESAMTE verfuegbare Historie testen,
   welche Level (unabhaengig vom Entstehungszeitpunkt) im Nachhinein
   mehrfach angelaufen wurden, und deren Reaktion auswerten, statt auf
   ein klassisches Out-of-Sample-Fenster zu bestehen (Kompromiss:
   schwaecheres Look-ahead-Schutzniveau, dafuer mehr nutzbare Faelle).

**Naechster Schritt, falls dieser Check (automatisch oder manuell durch
Toby) erneut aufgegriffen wird, bevor diese Entscheidung gefallen ist:**

1. Denselben Split-Test wiederholen, aber mit aktuellem Datenstand
   (Formation-Fenster ggf. verschieben/verlaengern, Test-Fenster bis
   heute).
2. Vor allem zaehlen: wie viele ECHT UNABHAENGIGE Annaeherungs-Episoden
   (nicht einzelne Stundenkerzen innerhalb derselben mehrtaegigen
   Bewegung) gibt es inzwischen je Seite (Support/Resistance)? Eine
   Episode = ein zusammenhaengender Annaeherungs-/Reaktionszeitraum,
   getrennt von der naechsten durch eine klare Bewegung weg vom Level.
3. Schwelle: mindestens ~10 unabhaengige Episoden je Seite noetig fuer
   eine valide Aussage.
4. Falls Schwelle erreicht: Hypothese testen (Bounce- vs.
   Durchbruchsquote), BH-FDR-maessig sauber, Ergebnis ehrlich an Toby
   melden (traegt oder traegt nicht, beides valide) und ggf. besprechen
   ob/wie es in Key Levels oder System-Briefing einfliessen soll.
5. Falls weiterhin zu wenig: wieder ehrlich melden, Grund nennen (z. B.
   weiterhin Trendmarkt statt Range), und mit Toby klaeren, ob eine neue
   Erinnerung (und mit welchem Intervall/welcher Methodik) sinnvoll ist,
   statt stillschweigend nichts zu tun oder unbegrenzt im selben Rhythmus
   weiterzumachen.
