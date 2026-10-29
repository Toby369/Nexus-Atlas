# Spot-Volumen als Support/Resistance -- Status & offener Nachcheck

**Datum:** 24.10.2026 (erster valider Testversuch), Folgecheck geplant fuer 18.11.2026.

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

## Offener Nachcheck

Geplant fuer **18.11.2026** -- sowohl als automatische Erinnerung
(Claude-Scheduled-Trigger `trig_01R8xaSMvjy99XpBiRmNNhaS`) als auch hier
im Repo dokumentiert, falls die Erinnerung durch eine laengere Pause (Abo
pausiert/gestoppt) nicht feuert oder verloren geht.

**Naechster Schritt, falls dieser Check (automatisch oder manuell durch
Toby) aufgegriffen wird:**

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
   weiterhin Trendmarkt statt Range), und erneut eine neue, datenbasierte
   Erinnerung vorschlagen statt stillschweigend nichts zu tun.
