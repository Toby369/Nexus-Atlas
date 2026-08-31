// Zentrale, wartbare Sammlung der Info-Popover-Texte fuer PanelInfo.tsx.
// Jeder Text ist an das tatsaechliche Code-Verhalten des jeweiligen Panels
// gebunden (siehe die referenzierten Komponenten/RPCs/Edge Functions) --
// keine generischen Platzhaltertexte. Texte, die vom aktuell gewaehlten
// Zeitraum abhaengen, sind als Funktion (tfLabel) => string gehalten statt
// als fest codierter String, damit z.B. "4H" nie als "2H" haengen bleibt.
//
// Struktur: jeder Text besteht aus zwei durch eine Leerzeile getrennten
// Abschnitten -- "So liest du das:" (Interpretationshilfe: was der Wert
// bedeutet, was man daraus ableiten kann/soll und was nicht) und "So
// entsteht der Wert:" (Methodik: Datenquelle(n), Formel/Schwellenwert,
// Aktualisierungsrhythmus). PanelInfo.tsx rendert die beiden Abschnitte als
// getrennte, visuell strukturierte Absaetze mit hervorgehobenem Label.

export function marktkontextInfo(tfLabel: string): string {
  return `So liest du das: Das Panel zeigt eines von vier Szenarien: Long-Aufbau, Short-Aufbau, Short-Covering oder Long-Abbau – oder „Keine klare Struktur“, wenn weder Preis noch OI einen Mindestschwellenwert überschreiten. Der Zusatz „spotbestätigt“ zeigt, ob sich der Spot-Markt in dieselbe Richtung wie die Futures-Bewegung bewegt; eine unbestätigte Bewegung gilt als eher gehebelt statt real nachfragegetrieben. Die Einordnung ist rein regelbasiert (keine KI) und keine Anlageberatung.

So entsteht der Wert: Kombiniert die Preisrichtung (Bybit), die aggregierte Open-Interest-Richtung (Summe über alle Börsen mit Daten) und den Spot-Taker-Netto-Flow (Binance) über ${tfLabel}. Reicht die OI-Historie für ${tfLabel} noch nicht aus oder ist die Spot-Datenbasis zu dünn, wird das Ergebnis als PRELIMINARY oder INSUFFICIENT DATA gekennzeichnet.`;
}

export const btcPriceInfo = `So liest du das: Zeigt den aktuellen BTC/USDT-Perpetual-Preis sowie den Preisverlauf der letzten rund 15 Stunden, ausschliesslich von Bybit als fester Referenzbörse – unabhängig davon, welche Börse weiter unten bei „OI Change“ ausgewählt ist. Bybit dient bewusst als einheitliche Preis-Referenz für das gesamte Dashboard (Marktkontext, OI-Change-Berechnung, Kurznotiz), damit alle Kennzahlen auf derselben Preisbasis beruhen. Ein „Sync-Problem“-Hinweis erscheint, wenn die letzte erfolgreiche Datenerfassung mehr als 15 Minuten zurückliegt.

So entsteht der Wert: Der Wert stammt vom letzten erfassten Datenpunkt der Sammel-Pipeline, die alle 5 Minuten neue Daten holt – kein Echtzeit-Tick-Feed.`;

export function oiChangeInfo(tfLabel: string): string {
  return `So liest du das: Steigendes OI bedeutet, dass neue Positionen eröffnet werden, fallendes OI, dass Positionen geschlossen werden; ob es sich dabei um Long- oder Short-Positionen handelt, ist daraus allein nicht ablesbar. Bei „Aggregiert“ ist das die Summe des Open Interest aller Börsen, die zu diesem Zeitpunkt Daten geliefert haben (Bitunix liefert öffentlich kein Open Interest und fehlt daher immer). Zusätzlich, unabhängig vom Zeitraum-Filter: ist oben ein Event-Anker gesetzt, erscheint hier eine separate Preis-/OI-Veränderung seit diesem frei wählbaren Zeitpunkt (Phase 1 „Anchored Analytics“) – für Event-Driven-Analysen (z. B. Reaktion seit einer Liquidation-Cascade), keine Ersetzung der Zeitraum-Kachel oben.

So entsteht der Wert: Zeigt, wie stark sich das Open Interest der ausgewählten Börse gegenüber dem Wert vor ${tfLabel} verändert hat. Berechnet wird (aktueller Wert − Referenzwert) / Referenzwert, wobei der Referenzwert der tatsächlich nächstgelegene Datenpunkt vor ${tfLabel} ist – kein geschätzter Wert. Reicht die gespeicherte Historie noch nicht bis ${tfLabel} zurück, wird stattdessen der älteste verfügbare Punkt verwendet und das im Panel vermerkt.`;
}

export function btcOiChartInfo(tfLabel: string): string {
  return `So liest du das: Die Kombination beider Linien ist aussagekräftiger als eine allein: „BTC ↑ + OI ↑“ deutet eher auf Positionsaufbau hin, „BTC ↑ + OI ↓“ eher auf Short-Covering bzw. Positionsabbau. Für die vollständige regelbasierte Einordnung dieser Kombination siehe „Marktkontext“ oben im Dashboard. Der Chart selbst bewertet nichts, er stellt nur die beiden normalisierten Verläufe nebeneinander dar.

So entsteht der Wert: Vergleicht die prozentuale Entwicklung von BTC-Preis und Open Interest über ${tfLabel} in einem gemeinsamen Chart, für dieselbe Börse wie in der OI-Change-Kachel oben ausgewählt. Beide Linien werden unabhängig voneinander auf ihren jeweils ersten verfügbaren Punkt im Fenster normalisiert (= 0 %), damit sie trotz unterschiedlicher Grössenordnung auf einer Achse vergleichbar sind.`;
}

export const kurznotizInfo = `So liest du das: Automatisch generierter Kurztext, der dieselbe market_states-Zeile wie „Gesamteinschätzung“ oben zusammenfasst (Gesamtzustand, Confidence, Datenabdeckung, ggf. führendes Muster, Risk) – kein eigener, unabhängiger Rechenweg mehr (bis vor Kurzem generierte diese Kachel ihre eigene, ausschliesslich preisbasierte Bybit-Einschätzung, was zu widersprüchlichen Aussagen zwischen Kurznotiz und Gesamteinschätzung führen konnte; seit der Zusammenführung gibt es nur noch eine Quelle). Für die volle Faktor-Aufschlüsselung siehe „Gesamteinschätzung“ ganz oben im Dashboard.

So entsteht der Wert: Kein KI-Modell, keine freie Formulierung – reine Textzusammenfassung bereits vorhandener Werte. Wird alle 15 Minuten neu berechnet, unabhängig vom oben gewählten Zeitraum-Filter.`;

export const exchangeComparisonInfo = `So liest du das: Grössere Abweichungen zwischen den Börsen können auf unterschiedliche Liquidität, regionale Nachfrage oder kurzfristige Marktineffizienzen hindeuten. Liefert eine Börse gerade keine aktuellen Daten, fehlt sie in der Liste, statt einen falschen Wert zu zeigen. Die Karte erscheint nur, wenn mindestens zwei Börsen aktuell Daten liefern.

So entsteht der Wert: Zeigt Preis und Funding Rate desselben BTC-Perpetual über bis zu 6 Börsen (Bybit, Binance, OKX, Bitget, Bitunix, Pionex) im Vergleich, jeweils der letzte bekannte Datenpunkt je Börse. Die Abweichung wird in Prozent gegenüber Bybit als Referenzbörse berechnet; ab 0,15 % Abweichung wird der Wert farblich als auffällig markiert.`;

export function exchangeDivergenceInfo(tfLabel: string): string {
  return `So liest du das: Bewegen sich die Börsen deutlich unterschiedlich (Divergenz), kann das auf eine Bewegung hindeuten, die nur auf einzelnen Börsen konzentriert ist statt breit vom Markt getragen zu werden – eine Divergenz ist dabei nicht automatisch bullisch oder bärisch zu werten. „UNAVAILABLE“ bei Bitunix bedeutet, dass diese Börse öffentlich kein Open Interest anbietet, kein fehlender Datenpunkt. Ein „*“ markiert Börsen, deren Historie für ${tfLabel} noch nicht vollständig zurückreicht.

So entsteht der Wert: Zeigt die OI-Change % jeder einzelnen Börse über ${tfLabel} und macht damit sichtbar, welche Börsen tatsächlich in die „Aggregiert“-Summe der OI-Change-Kachel oben einfliessen. Berechnet wird pro Börse dieselbe (Wert − Referenzwert)/Referenzwert-Formel wie bei OI Change, nur separat statt summiert.`;
}

export const fundingRateInfo = `So liest du das: Ein positiver Wert bedeutet, dass Longs an Shorts zahlen (der Markt ist tendenziell long-lastig positioniert), ein negativer Wert das Gegenteil. Ein hoher positiver oder negativer Wert zeigt eine einseitige Positionierung, sagt aber allein noch nichts darüber, ob sich der Preis in dieselbe Richtung weiterbewegt. Funding ist deshalb kein eigenständiges Long-/Short-Signal, sondern nur im Zusammenspiel mit Preis, OI und Positionierung aussagekräftig.

So entsteht der Wert: Zeigt die periodische Ausgleichszahlung zwischen Long- und Short-Positionen im BTC-Perpetual, wie sie von der jeweiligen Börse selbst berechnet und über deren API bereitgestellt wird – Nexus Atlas berechnet den Wert nicht selbst. Der Chart zeigt den Verlauf der letzten rund 15 Stunden auf Bybit als Referenzbörse; der aktuelle Wert je Börse steht zusätzlich im Börsenvergleich.`;

export function spotPressureInfo(tfLabel: string): string {
  return `So liest du das: Ordnet den Netto-Taker-Flow einem von vier Verdikten zu: BUYING PRESSURE, SELLING PRESSURE, NEUTRAL oder INSUFFICIENT DATA. Das misst eine Kauf-/Verkaufs-Imbalance im Taker-Orderflow, nicht ob am Spot-Markt tatsächlich netto mehr Coins gekauft als verkauft wurden. Deckt die Stichprobe weniger als 80 % der erwarteten Kerzen im Fenster ab, gilt das Ergebnis als PRELIMINARY, unter 20 % als INSUFFICIENT DATA.

So entsteht der Wert: Datenbasis ist ausschliesslich Binance Spot BTC/USDT im 5-Minuten-Takt über ${tfLabel} – die einzige öffentliche Route mit echtem Taker-Buy/Sell-Split, keine Schätzung. Berechnet wird (Taker-Kaufvolumen − Taker-Verkaufsvolumen) / Gesamtvolumen über alle Kerzen im Fenster; ab ±5 % gilt BUYING bzw. SELLING PRESSURE, sonst NEUTRAL.`;
}

export const positioningRatiosInfo = `So liest du das: Die „Retail“-Balken zeigen den Anteil der Accounts, nicht deren eingesetztes Kapital – „70 % long“ heisst also 70 % der Accounts, nicht 70 % des Kapitals. „Top Trader (Positionen)“ ist dagegen nach Positionsgrösse gewichtet und damit aussagekräftiger für grosse Marktteilnehmer. Vier unabhängige Börsen reduzieren das Risiko, dass eine einzelne Börse die Positionierungs-Einschätzung verzerrt.

So entsteht der Wert: Zeigt je Börse den Anteil long vs. short positionierter Accounts (Retail) sowie bei Binance zusätzlich die Top-Trader-Positionierung getrennt nach Accounts und tatsächlicher Positionsgrösse. Quelle sind die offiziellen Positioning-Endpunkte der jeweiligen Börse: Binance liefert Retail- und Top-Trader-Ratio direkt, Bybit/OKX/Bitget nur eine globale Account-Ratio (bei OKX aus einem Long/Short-Verhältnis zurückgerechnet). Bybit, OKX und Bitget liefern öffentlich keine Top-Trader-Aufschlüsselung, dort ist nur die Retail-Account-Ratio verfügbar.`;

export const takerFlowInfo = `So liest du das: Ein Wert über 1 bedeutet mehr aggressive Käufe als Verkäufe, ein Wert unter 1 das Gegenteil. Das bezieht sich ausschliesslich auf den Futures-Markt, nicht auf den Spot-Markt (dafür siehe „Spot Pressure“), und ist allein kein eigenständiges Handelssignal, sondern fliesst zusammen mit der Retail-/Top-Trader-Positionierung in die Einschätzung unten ein.

So entsteht der Wert: Zeigt das Verhältnis von aggressivem Kauf- zu Verkaufsvolumen (Taker Buy/Sell Ratio) im BTC-Futures-Markt auf Binance, im 5-Minuten-Fenster. Der Wert kommt direkt vom Binance-Futures-Endpoint und wird nicht selbst nachberechnet.`;

export const positioningAssessmentInfo = `So liest du das: Der „Score“ (−100 bis +100) beschreibt die Positionierungs-Tendenz, nicht eine Kursprognose; „Confidence“ steigt, wenn mehrere Kennzahlen (z. B. Taker-Flow und Retail-Richtung) übereinstimmen, und sinkt bei Divergenz zwischen Retail und Top Trader. Das Ergebnis ist eine datenbasierte Einordnung möglicher Crowding-/Squeeze-Risiken (z. B. Long-Crowding- oder Short-Squeeze-Risiko), keine Kauf-/Verkaufsempfehlung und keine Vorhersage. Fehlt eine der nötigen Binance-Kennzahlen, wird kein Signal erzeugt, statt eine unvollständige Einschätzung anzuzeigen.

So entsteht der Wert: Kombiniert Retail- vs. Top-Trader-Positionierung, Taker-Flow, OI-Trend und Preistrend zu einer regelbasierten Positionierungs-Einordnung. Basis ist ausschliesslich Binance als vollständigster öffentlicher Datensatz, betrachtet über ein rollierendes Fenster von rund 2 Stunden.`;

export const liquidationsInfo = `So liest du das: Ein Hinweis auf eine mögliche Cascade erscheint, wenn mindestens 3 Liquidationen innerhalb von 2 Minuten auftreten. Wegen der Stichprobenerfassung ist die Zahl eine Annäherung, kein vollständiges Bild aller tatsächlichen Liquidationen, und kein eigenständiges Handelssignal. Zusätzlich, unabhängig vom 6-Stunden-Fenster oben: ist ein Event-Anker gesetzt, erscheint hier die kumulierte Long-/Short-Liquidationssumme seit diesem frei wählbaren Zeitpunkt (Phase 1 „Anchored Analytics“).

So entsteht der Wert: Zeigt das Long- und Short-Liquidationsvolumen der letzten 6 Stunden. Datenquelle sind Binance und Bybit, per Stichprobenerfassung (~25 Sekunden Erfassungsfenster alle 5 Minuten je Börse) – kein lückenloser Vollstream. Die Balken zeigen die Summe des liquidierten Notional-Werts je Seite. Darunter: die Liquidationsrate (zu-/abnehmend ggü. vorherigen 15-Minuten-Fenstern), ein Häufungspunkt im Preisband (falls mindestens 30 % des Volumens auf einen einzelnen $200-Bucket entfallen) sowie der Anteil am aktuellen aggregierten Open Interest.`;

export const etfMacroInfo = `So liest du das: Momentum zeigt den Trend „beschleunigend“/„abflachend“/„stabil“ ab ±15 % Abweichung. Der Fliesstext vergleicht zusätzlich, ob die ETF-Flow-Richtung (netto positiv/negativ) mit der Mehrheitsrichtung markbewegender Makro-News der letzten 72h (Kategorien Fed/Treasury/CPI/ETF) übereinstimmt oder auseinanderläuft – dieselbe News-Basis wie im News-Risk-Panel. Das sind einfache Gegenüberstellungen, keine gewichtete Analyse und kein Handelssignal. Dieses Panel fliesst nicht in das regelbasierte Marktkontext-Assessment oben ein, sondern ist eine eigenständige, separate Betrachtung.

So entsteht der Wert: Zeigt den Netto-Kapitalfluss der US-Spot-BTC-ETFs für den letzten gemeldeten Handelstag sowie die Summe der letzten 5 Handelstage. Quelle ist SoSoValue (offizielle API), bei älteren Einträgen noch Farside Investors – die Daten kommen mit T+1-Verzögerung, nicht in Echtzeit. Momentum vergleicht die Flow-Summe der jüngeren mit der älteren Hälfte eines 10-Handelstage-Fensters; daneben die Preis- und Open-Interest-Veränderung im selben Zeitraum – letztere basiert auf der bereits bestehenden aggregierten OI-Historie und zeigt „nicht verfügbar“ statt eines erfundenen Werts, wenn dafür keine Historie vorliegt.`;

export const marketStateInfo = `So liest du das: Confidence kombiniert Datenabdeckung mit der Einigkeit der Faktoren. „Signal-Stärke“ zeigt, wie viele Faktoren überhaupt eine Richtung zeigen, „Konsens“, wie einig sich diese sind – so erkennst du, ob eine niedrige Confidence an fehlender Aussage oder an echtem Widerspruch liegt. Risk misst unabhängig davon die Fragilität der Lage (Warn-Muster, uneinige Zeitrahmen, Funding-Crowding, hohe Volatilität). MTF-Alignment zeigt die Trend-Übereinstimmung über 1H/4H/1D; Muster wie „Short Squeeze“ sind Interpretationshilfen, keine Handelssignale. Unter 35/100 Confidence wird ein berechnetes Bullisch/Bärisch bewusst als „Unklar / kein Zustand“ angezeigt – reine Anzeige-Entscheidung, der gespeicherte Zustand bleibt für Backtests unverändert.

So entsteht der Wert: Kombiniert vierzehn unabhängige Kennzahlen aus sechs Bereichen (Struktur/Trend, Momentum, Orderflow/Derivate, Positionierung, Optionen, Makro/Sentiment) zu einem Gesamtzustand – kein Black-Box-Score, jeder Faktor ist unter „Faktoren anzeigen“ einzeln mit Rohwert einsehbar (z. B. „RSI 37.2“). Fehlt eine Datenquelle oder ist sie veraltet, zählt sie als „keine Daten“ statt als neutral, was die Confidence senkt. Wird alle 15 Minuten neu berechnet.`;

export const marketStateMatrixInfo = `So liest du das: Die fünf möglichen Regimes sind „Trendausweitung“ (bullisch/bärisch, wenn ADX ≥25 und Trendrichtung/Regressionssteigung übereinstimmen), „Volatilitäts-Squeeze“ (niedriger ADX bei komprimierten Bollinger-Bändern – typische Phase vor einem Ausbruch), „Hohe Volatilität/Reversion“ (Volatilitätsspitze bei gleichzeitig weit vom Mittelwert entferntem Preis) oder „Unklar / kein Regime“ als bewusst nicht erfundenes Ergebnis, wenn die Signale nicht übereinstimmen oder Kerndaten fehlen. Das ist eine von der 14-Faktoren-„Gesamteinschätzung“ oben unabhängige, zusätzliche Einordnung, kein Ersatz dafür. Dieselbe Confidence-Sperre wie beim Gesamtzustand gilt auch hier: Liegt die Confidence der Gesamteinschätzung unter 35/100, werden die gerichteten Trendausweitungs-Regimes hier ebenfalls nicht als solche angezeigt, sondern als unklar gekennzeichnet. Zusätzlich wird angezeigt, wenn die Richtung dieser Regime-Einordnung und die Richtung des 14-Faktoren-Gesamtzustands übereinstimmen oder sich widersprechen (Engine-Divergenz) – nur sichtbar, wenn beide Engines eine eindeutige Richtung liefern und die Confidence-Sperre nicht bereits greift. Ein optionales „TradingView Context“-Badge zeigt das jüngste externe Signal (Pine-Script-Alert, per Webhook empfangen) der letzten 24 Stunden – rein informativ, fließt nicht in Score, Confidence oder Regime ein und wird nach 24 Stunden automatisch ausgeblendet. Ist oben ein Event-Anker gesetzt, zeigt „Seit Anker“ zusätzlich das Regime zum Anker-Zeitpunkt neben dem aktuellen (Phase 1 „Anchored Analytics“) – dieselbe Confidence-Sperre gilt dabei auch rückwirkend für den historischen Wert.

So entsteht der Wert: Führt fünf unabhängige Feature-Säulen (Trend: ADX/DMI + Regressionssteigung; Volatilität: Bollinger-Breite + Normalized-ATR-Ratio; Momentum/Mean-Reversion: RSI + Distanz-zu-SMA50-Z-Score; Mikrostruktur/Derivate: Funding-Z-Score, OI-vs-Preis-Quadrant, CVD-Z-Score; Makro/Sentiment: Liquidation-Cluster-Density, Net-Taker-Flow-Ratio) zusammen. Basiert auf stündlichen Kerzen (Binance), wird alle 15 Minuten neu berechnet. Regelbasiert, kein KI-Modell, keine Anlageberatung.`;

export const newsRiskInfo = `So liest du das: Als „markbewegend“ gilt eine Meldung ab einem Impact-Score von 75, der sich aus Kategorie (z. B. Fed, Treasury, ETF) und Keyword-Treffern ergibt. Die Einordnung ist eine automatisierte Klassifikation, keine redaktionelle Prüfung durch eine Person. Sie ist rein informativ und keine Anlageberatung.

So entsteht der Wert: Zeigt markbewegende Nachrichten der letzten 72 Stunden. Quellen sind RSS-Feeds von Fed, BLS und SEC (primär, hohe Verlässlichkeit) sowie Google-News-Suchen zu BTC-Makro-Themen (Wire-Quellen, geringere Verlässlichkeit), alle 15 Minuten neu abgerufen. Kategorie und Richtung (positiv/negativ/neutral) werden regelbasiert über feste Schlüsselwortlisten bestimmt – kein KI-Modell.`;
