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

export function exchangeDivergenceInfo(tfLabel: string): string {
  return `So liest du das: Bewegen sich die Börsen deutlich unterschiedlich (Divergenz), kann das auf eine Bewegung hindeuten, die nur auf einzelnen Börsen konzentriert ist statt breit vom Markt getragen zu werden – eine Divergenz ist dabei nicht automatisch bullisch oder bärisch zu werten. „UNAVAILABLE“ bei Bitunix bedeutet, dass diese Börse öffentlich kein Open Interest anbietet, kein fehlender Datenpunkt. Ein „*“ markiert Börsen, deren Historie für ${tfLabel} noch nicht vollständig zurückreicht.

So entsteht der Wert: Zeigt standardmässig den ungewichteten Durchschnitt der OI-Change % über alle Börsen mit vorhandenem Wert (Bitunix ausgenommen) – antippen zeigt jede Börse einzeln, macht sichtbar, welche tatsächlich in die „Aggregiert“-Summe der OI-Change-Kachel oben einfliessen. Berechnet wird pro Börse dieselbe (Wert − Referenzwert)/Referenzwert-Formel wie bei OI Change, nur separat statt summiert.`;
}

export const fundingRateInfo = `So liest du das: Ein positiver Wert bedeutet, dass Longs an Shorts zahlen (der Markt ist tendenziell long-lastig positioniert), ein negativer Wert das Gegenteil. Ein hoher positiver oder negativer Wert zeigt eine einseitige Positionierung, sagt aber allein noch nichts darüber, ob sich der Preis in dieselbe Richtung weiterbewegt. Funding ist deshalb kein eigenständiges Long-/Short-Signal, sondern nur im Zusammenspiel mit Preis, OI und Positionierung aussagekräftig.

So entsteht der Wert: Zeigt die periodische Ausgleichszahlung zwischen Long- und Short-Positionen im BTC-Perpetual, wie sie von der jeweiligen Börse selbst berechnet und über deren API bereitgestellt wird – Nexus Atlas berechnet den Wert nicht selbst. Der Chart zeigt den Verlauf der letzten rund 15 Stunden auf Bybit als Referenzbörse; der aktuelle Wert je Börse steht zusätzlich im Börsenvergleich.`;

export function spotPressureInfo(tfLabel: string): string {
  return `So liest du das: Ordnet den Netto-Taker-Flow einem von vier Verdikten zu: BUYING PRESSURE, SELLING PRESSURE, NEUTRAL oder INSUFFICIENT DATA. Das misst eine Kauf-/Verkaufs-Imbalance im Taker-Orderflow, nicht ob am Spot-Markt tatsächlich netto mehr Coins gekauft als verkauft wurden. Deckt die Stichprobe weniger als 80 % der erwarteten Kerzen im Fenster ab, gilt das Ergebnis als PRELIMINARY, unter 20 % als INSUFFICIENT DATA.

So entsteht der Wert: Datenbasis ist ausschliesslich Binance Spot BTC/USDT im 5-Minuten-Takt über ${tfLabel} – die einzige öffentliche Route mit echtem Taker-Buy/Sell-Split, keine Schätzung. Berechnet wird (Taker-Kaufvolumen − Taker-Verkaufsvolumen) / Gesamtvolumen über alle Kerzen im Fenster; ab ±5 % gilt BUYING bzw. SELLING PRESSURE, sonst NEUTRAL.`;
}

export const positioningRatiosInfo = `So liest du das: Die „Retail“-Balken zeigen den Anteil der Accounts, nicht deren eingesetztes Kapital – „70 % long“ heisst also 70 % der Accounts, nicht 70 % des Kapitals. „Top Trader (Positionen)“ ist dagegen nach Positionsgrösse gewichtet und damit aussagekräftiger für grosse Marktteilnehmer. Vier unabhängige Börsen reduzieren das Risiko, dass eine einzelne Börse die Positionierungs-Einschätzung verzerrt.

So entsteht der Wert: „Retail“ zeigt standardmässig den ungewichteten Durchschnitt long vs. short positionierter Accounts über alle Börsen mit verfügbaren Daten (nicht nach Handelsvolumen gewichtet) – antippen zeigt die einzelnen Börsen darunter auf. Bei Binance zusätzlich die Top-Trader-Positionierung getrennt nach Accounts und tatsächlicher Positionsgrösse. Quelle sind die offiziellen Positioning-Endpunkte der jeweiligen Börse: Binance liefert Retail- und Top-Trader-Ratio direkt, Bybit/OKX/Bitget nur eine globale Account-Ratio (bei OKX aus einem Long/Short-Verhältnis zurückgerechnet). Bybit, OKX und Bitget liefern öffentlich keine Top-Trader-Aufschlüsselung, dort ist nur die Retail-Account-Ratio verfügbar.`;

export const takerFlowInfo = `So liest du das: Ein Wert über 1 bedeutet mehr aggressive Käufe als Verkäufe, ein Wert unter 1 das Gegenteil. Das bezieht sich ausschliesslich auf den Futures-Markt, nicht auf den Spot-Markt (dafür siehe „Spot Pressure“), und ist allein kein eigenständiges Handelssignal, sondern fliesst zusammen mit der Retail-/Top-Trader-Positionierung in die Einschätzung unten ein.

So entsteht der Wert: Zeigt das Verhältnis von aggressivem Kauf- zu Verkaufsvolumen (Taker Buy/Sell Ratio) im BTC-Futures-Markt auf Binance, im 5-Minuten-Fenster. Der Wert kommt direkt vom Binance-Futures-Endpoint und wird nicht selbst nachberechnet.`;

export const positioningAssessmentInfo = `So liest du das: Der „Score“ (−100 bis +100) beschreibt die Positionierungs-Tendenz, nicht eine Kursprognose; „Confidence“ steigt, wenn mehrere Kennzahlen (z. B. Taker-Flow und Retail-Richtung) übereinstimmen, und sinkt bei Divergenz zwischen Retail und Top Trader. Das Ergebnis ist eine datenbasierte Einordnung möglicher Crowding-/Squeeze-Risiken (z. B. Long-Crowding- oder Short-Squeeze-Risiko), keine Kauf-/Verkaufsempfehlung und keine Vorhersage. Fehlt eine der nötigen Binance-Kennzahlen, wird kein Signal erzeugt, statt eine unvollständige Einschätzung anzuzeigen.

So entsteht der Wert: Kombiniert Retail- vs. Top-Trader-Positionierung, Taker-Flow, OI-Trend und Preistrend zu einer regelbasierten Positionierungs-Einordnung. Basis ist ausschliesslich Binance als vollständigster öffentlicher Datensatz, betrachtet über ein rollierendes Fenster von rund 2 Stunden.`;

export const liquidationsInfo = `So liest du das: Ein Hinweis auf eine mögliche Cascade erscheint, wenn mindestens 3 Liquidationen innerhalb von 2 Minuten auftreten. Wegen der Stichprobenerfassung ist die Zahl eine Annäherung, kein vollständiges Bild aller tatsächlichen Liquidationen, und kein eigenständiges Handelssignal. Zusätzlich, unabhängig vom 6-Stunden-Fenster oben: ist ein Event-Anker gesetzt, erscheint hier die kumulierte Long-/Short-Liquidationssumme seit diesem frei wählbaren Zeitpunkt (Phase 1 „Anchored Analytics“).

So entsteht der Wert: Zeigt das Long- und Short-Liquidationsvolumen der letzten 6 Stunden. Datenquelle sind Binance und Bybit, per Stichprobenerfassung (~25 Sekunden Erfassungsfenster alle 5 Minuten je Börse) – kein lückenloser Vollstream. Die Balken zeigen die Summe des liquidierten Notional-Werts je Seite. Darunter: die Liquidationsrate (zu-/abnehmend ggü. vorherigen 15-Minuten-Fenstern), ein Häufungspunkt im Preisband (falls mindestens 30 % des Volumens auf einen einzelnen $200-Bucket entfallen) sowie der Anteil am aktuellen aggregierten Open Interest.`;

export const etfMacroInfo = `So liest du das: Momentum zeigt den Trend „beschleunigend“/„abflachend“/„stabil“ ab ±15 % Abweichung. Der Fliesstext vergleicht zusätzlich, ob die ETF-Flow-Richtung (netto positiv/negativ) mit der Mehrheitsrichtung markbewegender Makro-News der letzten 72h (Kategorien Fed/Treasury/CPI/ETF) übereinstimmt oder auseinanderläuft – dieselbe News-Basis wie im News-Risk-Panel. Das sind einfache Gegenüberstellungen, keine gewichtete Analyse und kein Handelssignal. Dieses Panel fliesst nicht in das regelbasierte Marktkontext-Assessment oben ein, sondern ist eine eigenständige, separate Betrachtung.

So entsteht der Wert: Zeigt den Netto-Kapitalfluss der US-Spot-BTC-ETFs für den letzten gemeldeten Handelstag sowie die Summe der letzten 5 Handelstage. Quelle ist SoSoValue (offizielle API), bei älteren Einträgen noch Farside Investors – die Daten kommen mit T+1-Verzögerung, nicht in Echtzeit. Momentum vergleicht die Flow-Summe der jüngeren mit der älteren Hälfte eines 10-Handelstage-Fensters; daneben die Preis- und Open-Interest-Veränderung im selben Zeitraum – letztere basiert auf der bereits bestehenden aggregierten OI-Historie und zeigt „nicht verfügbar“ statt eines erfundenen Werts, wenn dafür keine Historie vorliegt.`;

export const marketStateInfo = `So liest du das: Confidence kombiniert Datenabdeckung mit der Einigkeit der Faktoren. „Signal-Stärke“ zeigt, wie viele Faktoren überhaupt eine Richtung zeigen, „Konsens“, wie einig sich diese sind – so erkennst du, ob eine niedrige Confidence an fehlender Aussage oder an echtem Widerspruch liegt. Risk misst unabhängig davon die Fragilität der Lage (Warn-Muster, uneinige Zeitrahmen, Funding-Crowding, hohe Volatilität). MTF-Alignment zeigt die Trend-Übereinstimmung über 1H/4H/1D; Muster wie „Short Squeeze“ sind Interpretationshilfen, keine Handelssignale. Unter 35/100 Confidence wird ein berechnetes Bullisch/Bärisch bewusst als „Unklar / kein Zustand“ angezeigt – reine Anzeige-Entscheidung, der gespeicherte Zustand bleibt für Backtests unverändert.

So entsteht der Wert: Kombiniert vierzehn unabhängige Kennzahlen aus sechs Bereichen (Struktur/Trend, Momentum, Orderflow/Derivate, Positionierung, Optionen, Makro/Sentiment) zu einem Gesamtzustand – kein Black-Box-Score, jeder Faktor ist unter „Faktoren anzeigen“ einzeln mit Rohwert einsehbar (z. B. „RSI 37.2“). Fehlt eine Datenquelle oder ist sie veraltet, zählt sie als „keine Daten“ statt als neutral, was die Verlässlichkeit senkt. Wird alle 15 Minuten neu berechnet.`;

export const marketStateMatrixInfo = `So liest du das: Die fünf möglichen Regimes sind „Trendausweitung“ (bullisch/bärisch, wenn ADX ≥25 und Trendrichtung/Regressionssteigung übereinstimmen), „Volatilitäts-Squeeze“ (niedriger ADX bei komprimierten Bollinger-Bändern – typische Phase vor einem Ausbruch), „Hohe Volatilität/Reversion“ (Volatilitätsspitze bei gleichzeitig weit vom Mittelwert entferntem Preis) oder „Unklar / kein Regime“ als bewusst nicht erfundenes Ergebnis, wenn die Signale nicht übereinstimmen oder Kerndaten fehlen. Das ist eine von der 14-Faktoren-„Gesamteinschätzung“ oben unabhängige, zusätzliche Einordnung, kein Ersatz dafür. Dieselbe Confidence-Sperre wie beim Gesamtzustand gilt auch hier: Liegt die Confidence der Gesamteinschätzung unter 35/100, werden die gerichteten Trendausweitungs-Regimes hier ebenfalls nicht als solche angezeigt, sondern als unklar gekennzeichnet. Zusätzlich wird angezeigt, wenn die Richtung dieser Regime-Einordnung und die Richtung des 14-Faktoren-Gesamtzustands übereinstimmen oder sich widersprechen (Engine-Divergenz) – nur sichtbar, wenn beide Engines eine eindeutige Richtung liefern und die Confidence-Sperre nicht bereits greift. Ein optionales „TradingView Context“-Badge zeigt das jüngste externe Signal (Pine-Script-Alert, per Webhook empfangen) der letzten 24 Stunden – rein informativ, fließt nicht in Score, Confidence oder Regime ein und wird nach 24 Stunden automatisch ausgeblendet. Ist oben ein Event-Anker gesetzt, zeigt „Seit Anker“ zusätzlich das Regime zum Anker-Zeitpunkt neben dem aktuellen (Phase 1 „Anchored Analytics“) – dieselbe Confidence-Sperre gilt dabei auch rückwirkend für den historischen Wert.

So entsteht der Wert: Führt fünf unabhängige Feature-Säulen (Trend: ADX/DMI + Regressionssteigung; Volatilität: Bollinger-Breite + Normalized-ATR-Ratio; Momentum/Mean-Reversion: RSI + Distanz-zu-SMA50-Z-Score; Mikrostruktur/Derivate: Funding-Z-Score, OI-vs-Preis-Quadrant, CVD-Z-Score; Makro/Sentiment: Liquidation-Cluster-Density, Net-Taker-Flow-Ratio) zusammen. Basiert auf stündlichen Kerzen (Binance), wird alle 15 Minuten neu berechnet. Regelbasiert, kein KI-Modell, keine Anlageberatung.`;

// Pro-Faktor-Infotexte fuer die aufgeklappte Faktoren-Ansicht in
// MarketStateCard.tsx (Nutzer-Wunsch: "bei jedem Indikator ein Info-Button,
// kurz strukturiert was/wie lesbar, evt. was es zusammen/gegen spielt").
// Gleiche zwei-Abschnitt-Konvention wie oben, hier bewusst kompakter (ein
// einzelner Faktor braucht keinen so langen Text wie das ganze Panel).
// Schwellenwerte/Formeln 1:1 aus compute-market-state uebernommen (siehe
// docs/research/phase6-ist-zustand-audit.md Abschnitt 1 fuer die
// verifizierte Quelle).
export const MARKET_STATE_FACTOR_INFO: Record<string, string> = {
  structure: `So liest du das: Bullisch/bärisch, wenn die 1H-Marktstruktur höhere Hochs/Tiefs (bullisch) bzw. tiefere Tiefs/Hochs (bärisch) bildet; BOS (Break of Structure) und CHoCH (Change of Character) daneben zeigen, ob gerade eine Struktur bestätigt oder gebrochen wurde. Spielt eng mit trend_strength und trend_regime zusammen – widersprechen sich diese drei, ist das ein Warnsignal (siehe Muster „Fragile Bullish").

So entsteht der Wert: Direkt aus dem erkannten Struktur-Trend der letzten 1H-Kerzen, alle 15 Minuten aktualisiert.`,

  momentum: `So liest du das: Zeigt nur dann eine Richtung, wenn RSI(14) UND MACD-Histogramm gemeinsam übereinstimmen – bullisch nur bei RSI>55 und positivem MACD-Histogramm zugleich, bärisch nur bei RSI<45 und negativem MACD-Histogramm zugleich. Bewusst konservativ: bei Uneinigkeit der beiden Indikatoren neutral statt eines erzwungenen Signals.

So entsteht der Wert: RSI>55 UND MACD-Histogramm>0 → bullisch; RSI<45 UND MACD-Histogramm<0 → bärisch; sonst neutral, alle 15 Minuten aktualisiert.`,

  cvd: `So liest du das: Cumulative Volume Delta – Trend im aggressiven Kauf-/Verkaufsdruck. Steigend gilt als bullisch, fallend als bärisch. Sollte mit orderbook (passive Liquidität) übereinstimmen; läuft der Preis dem CVD entgegen, ist das eine klassische Divergenz-Warnung (siehe Muster „Distribution Warning").

So entsteht der Wert: Direkt aus dem CVD-Trend (steigend/fallend/neutral), alle 15 Minuten aktualisiert.`,

  oi_price: `So liest du das: Nur bei spürbarer OI-Bewegung (über 0,3%) überhaupt eine Aussage – die Richtung kommt dann vom Preis relativ zum 20er-EMA, nicht vom OI-Vorzeichen allein (steigendes wie fallendes OI können je nach Kontext beides bedeuten). Die feinere 4-Felder-Version derselben Idee steht als OI/Preis-Quadrant in der Marktphase-Kachel.

So entsteht der Wert: |OI-Δ| > 0,3% → (Preis>EMA20 ? bullisch : bärisch), sonst neutral; alle 15 Minuten aktualisiert.`,

  positioning: `So liest du das: Divergenz zwischen Retail- und Top-Trader-Positionierung über 4 Börsen – ein positiver Score deutet auf eine für Top-Trader typischerweise vorteilhafte Divergenz hin. Am ehesten verwandt mit funding (beide messen Positionierungs-Crowding aus unterschiedlichen Quellen); stimmen beide überein, ist das ein stärkeres Signal.

So entsteht der Wert: Score>10 → bullisch / Score<-10 → bärisch, sonst neutral (Divergence Engine, 4 Börsen), alle 5 Minuten aktualisiert.`,

  orderbook: `So liest du das: Durchschnittliche Orderbuch-Tiefen-Imbalance über mehrere Börsen – positiv bedeutet mehr Kauf- als Verkaufsvolumen im Buch. Zeigt passive/stehende Liquidität, im Unterschied zu cvd (aktiv ausgeführte Trades); Übereinstimmung beider stärkt die Aussage, Divergenz ist informativ.

So entsteht der Wert: Ø Depth-Imbalance über die Börsen mit Daten; über 0,08 → bullisch / unter -0,08 → bärisch, sonst neutral, alle 5 Minuten aktualisiert.`,

  options: `So liest du das: Put/Call-Open-Interest-Ratio auf Deribit – niedrige Ratio (mehr Calls) gilt als bullisch, hohe Ratio (mehr Puts) als bärisch. Bewusst als eigenständige, unabhängige Säule gehalten, da Options-Marktteilnehmer oft anders positioniert sind als Spot-/Perp-Trader.

So entsteht der Wert: Put/Call-OI-Ratio unter 0,7 → bullisch / über 1,1 → bärisch, sonst neutral, alle 30 Minuten aktualisiert.`,

  macro: `So liest du das: Makro-Risikoregime aus VIX, S&P500, Nasdaq, US-Dollar-Index und Fed-Netto-Liquidität – Risk-On gilt als bullisch für BTC, Risk-Off als bärisch. Einziger Faktor komplett unabhängig von Krypto-Marktdaten – bei Übereinstimmung mit den übrigen 13 besonders aussagekräftig, da aus einer ganz anderen Datenquelle.

So entsteht der Wert: Mehrheitszählung Risk-On-/Risk-Off-Signale über die genannten Kennzahlen, alle 30 Minuten aktualisiert.`,

  funding: `So liest du das: Bewusst gegenteilig gewertet (Contrarian): eine hohe positive Funding-Rate (Longs zahlen viel) gilt als bärisches Crowding-Warnsignal, stark negative Funding als bullisch. Dieselbe Crowding-Logik wie basis, nur über einen anderen Kanal – bei Extremwerten fließen beide zusätzlich als eigene Risk-Flags ein.

So entsteht der Wert: Ø Funding-Rate über 4 Börsen; über 0,05% → bärisch / unter -0,05% → bullisch, sonst neutral, alle 5 Minuten aktualisiert.`,

  sentiment: `So liest du das: Crypto Fear & Greed Index, bewusst gegenteilig (Contrarian) gewertet – Extreme Angst gilt als bullisch, Extreme Gier als bärisch. Kann in starken Trends bewusst gegen die anderen Faktoren laufen (Gier bei Rallyes, Angst bei Crashs) – das ist beabsichtigt, kein Fehler.

So entsteht der Wert: „Extreme Fear" → bullisch / „Extreme Greed" → bärisch, sonst neutral (Quelle: alternative.me), stündlich aktualisiert.`,

  trend_strength: `So liest du das: ADX(14) mit +DI/−DI – unter 20 gilt als kein klarer Trend (neutral), darüber entscheidet, welcher Richtungsindikator dominiert. Sollte bei einem sauberen Trend mit structure übereinstimmen; dieselbe ADX/+DI/−DI-Logik (mit Schwelle 25 statt 20) bestimmt auch das Trend-Verdikt in der Marktphase-Kachel.

So entsteht der Wert: ADX<20 → neutral, sonst +DI>−DI → bullisch / −DI>+DI → bärisch, alle 15 Minuten aktualisiert.`,

  trend_regime: `So liest du das: Klassische Golden-/Death-Cross-Struktur – bullisch nur wenn Preis > EMA50 > EMA200 gleichzeitig gilt, bärisch bei umgekehrter Reihenfolge. Strengste der drei Trend-Kennzahlen (structure/trend_strength/trend_regime), reagiert deshalb langsamer/seltener als die anderen beiden.

So entsteht der Wert: Preis>EMA50>EMA200 → bullisch; Preis<EMA50<EMA200 → bärisch; sonst neutral, alle 15 Minuten aktualisiert.`,

  vwap_position: `So liest du das: Abstand des Preises zum rollierenden 20er-VWAP – deutlich darüber gilt als bullisch, deutlich darunter als bärisch. Verwandt mit, aber methodisch anders als das TradingView-Signal „VWAP Extreme Stretch" (session-verankerter VWAP mit Stddev-Bändern statt rollierendem 20er-Fenster) – ähnliches Terrain, keine unabhängige Bestätigung.

So entsteht der Wert: (Preis−VWAP)/VWAP über 0,15% → bullisch / unter -0,15% → bärisch, sonst neutral, alle 15 Minuten aktualisiert.`,

  basis: `So liest du das: Bewusst gegenteilig gewertet (Contrarian) – eine hohe positive Perpetual-Prämie gegenüber Spot gilt als bärisches Crowding-Signal, negative Prämie als bullisch. Derselbe Crowding-Gedanke wie funding, nur über einen anderen Kanal gemessen – beide zusammen ergeben die Risk-Flags funding_crowding/basis_crowding.

So entsteht der Wert: Basis-% über 0,15% → bärisch / unter -0,15% → bullisch, sonst neutral, alle 15 Minuten aktualisiert.`,
};

// Pro-Kennzahl-Infotexte fuer die aufgeklappte Saeulen-Ansicht in
// RegimeMatrixCard.tsx -- gleiches Bedarfsmuster wie MARKET_STATE_FACTOR_INFO
// oben, hier auf die rohen 5-Saeulen-Kennzahlen der Regime Matrix (siehe
// lib/marketRegime.ts fuer die Richtungs-Badge-Herleitung derselben Werte).
export const REGIME_MATRIX_METRIC_INFO: Record<string, string> = {
  adx: `So liest du das: Trendstärke (nicht Richtung) – ab 25 gilt der Markt als „im Trend" (Wilders Originalschwelle). Bildet zusammen mit +DI/−DI und der Regressionssteigung EIN gemeinsames Trend-Verdikt (Badge daneben); R² darunter zeigt zusätzlich, wie sauber dieser Trend tatsächlich verläuft.

So entsteht der Wert: Average Directional Index über 14 Perioden auf 1H-Kerzen, alle 15 Minuten neu berechnet.`,

  di: `So liest du das: Zeigt, welche Seite (Aufwärts- oder Abwärtsbewegung) gerade dominiert – nur relevant, wenn ADX gleichzeitig Trendstärke bestätigt. +DI>−DI bedeutet Aufwärtsdruck dominiert, umgekehrt Abwärtsdruck.

So entsteht der Wert: Directional-Movement-Indikatoren aus demselben Wilder-System wie ADX, alle 15 Minuten neu berechnet.`,

  slope: `So liest du das: Steigung einer linearen Regressionsgeraden durch die jüngsten Schlusskurse – positiv bedeutet Aufwärtstrend, negativ Abwärtstrend, nahe 0 Seitwärts. R² daneben zeigt, wie gut diese Gerade tatsächlich passt; hohe Steigung bei niedrigem R² ist weniger verlässlich.

So entsteht der Wert: Lineare Regression über ein rollierendes Fenster stündlicher Schlusskurse, alle 15 Minuten neu berechnet.`,

  r2: `So liest du das: Bestimmtheitsmaß der Regressionsgeraden (0–1) – wie eng der Preis der Trendlinie tatsächlich folgt statt zu streuen. Nahe 1 bedeutet einen sauberen, linearen Trend, nahe 0 viel Rauschen um die Linie. Bewusst ohne Richtungs-Badge – reine Gütekennzahl, keine Richtungsaussage.

So entsteht der Wert: Bestimmtheitsmaß derselben Regressionsgeraden wie die Regressionssteigung daneben, alle 15 Minuten neu berechnet.`,

  garmanKlassVol: `So liest du das: Volatilitätsschätzer, der Open/High/Low/Close jeder Kerze einbezieht (genauer als reine Schlusskurs-Volatilität). Reine Magnitude ohne Richtung – bewusst kein Richtungs-Badge. In Kombination mit weiter Preisabweichung vom Mittel (Dist-Z SMA50) kann ein hoher Wert Richtung des Regimes „Hohe Volatilität/Reversion" deuten (Badge oben).

So entsteht der Wert: Garman-Klass-Schätzer über stündliche OHLC-Kerzen, alle 15 Minuten neu berechnet.`,

  bbWidth: `So liest du das: (oberes Band − unteres Band) / mittleres Band – wie eng oder weit die Bollinger-Bänder gerade sind. Niedrige Werte (unter 0,05) gelten als Kompression/„Squeeze", Kernbestandteil des Regimes „Volatilitäts-Squeeze" (zusammen mit niedrigem ADX). Sagt selbst keine Richtung voraus, nur dass ein Ausbruch wahrscheinlicher wird.

So entsteht der Wert: Aus denselben Bollinger-Bändern wie Bollinger %b daneben, 20-Perioden-Basis, alle 15 Minuten neu berechnet.`,

  bbPercentB: `So liest du das: Position des Preises innerhalb der Bollinger-Bänder, normiert auf 0–1 (0 = unteres Band, 1 = oberes Band, 0,5 = Mitte). Über 0,8 bedeutet nahe/über dem oberen Band, unter 0,2 nahe/unter dem unteren Band. Unabhängig von der Bollinger-Breite daneben (die misst die Bandbreite, %b die Position darin).

So entsteht der Wert: Aus denselben Bollinger-Bändern wie die Bollinger-Breite, alle 15 Minuten neu berechnet.`,

  atrRatio: `So liest du das: Aktuelle ATR im Verhältnis zu ihrem eigenen 20er-Durchschnitt – deutlich über 1 bedeutet aktuell überdurchschnittlich volatil. Über 1,5, kombiniert mit weiter Preisabweichung vom Mittel (Dist-Z SMA50), zählt es als Volatilitäts-Spike – Vorbedingung für das Regime „Hohe Volatilität/Reversion". Reine Magnitude, keine Richtung.

So entsteht der Wert: Average True Range (14 Perioden) im Verhältnis zu ihrem eigenen 20-Perioden-Durchschnitt, alle 15 Minuten neu berechnet.`,

  rsi: `So liest du das: Hier um die 50er-Mittellinie gelesen (über 55 Momentum eher bullisch, unter 45 eher bärisch) – bewusst NICHT die „70=überkauft"-Reversion-Lesart, die ist in der Praxis umstritten. Eigenständiger Wert, separat vom momentum-Faktor in der Gesamteinschätzung-Kachel, der RSI zusätzlich mit MACD kombiniert.

So entsteht der Wert: Relative Strength Index über 14 Perioden auf 1H-Kerzen, alle 15 Minuten neu berechnet.`,

  distZ20: `So liest du das: Wie viele Standardabweichungen der Preis aktuell vom gleitenden 20-Perioden-Durchschnitt entfernt ist. Positiv bedeutet Preis über dem Durchschnitt, negativ darunter; |Wert| über 2 gilt als statistisch „gestreckt". Kürzestes der drei Fenster (20/50/200) – reagiert am empfindlichsten/kurzfristigsten.

So entsteht der Wert: Z-Score der Distanz Preis-zu-SMA20 relativ zur eigenen jüngeren Historie, alle 15 Minuten neu berechnet.`,

  distZ50: `So liest du das: Wie viele Standardabweichungen der Preis aktuell vom gleitenden 50-Perioden-Durchschnitt entfernt ist. Direkt Teil der Bedingung für das Regime „Hohe Volatilität/Reversion" (zusammen mit ATR-Ratio) – |Wert| über 2 bei gleichzeitigem Volatilitäts-Spike löst dieses Regime aus.

So entsteht der Wert: Z-Score der Distanz Preis-zu-SMA50 relativ zur eigenen jüngeren Historie, alle 15 Minuten neu berechnet – dieselbe Kennzahl, die auch die Regime-Klassifikation direkt verwendet.`,

  distZ200: `So liest du das: Wie viele Standardabweichungen der Preis aktuell vom gleitenden 200-Perioden-Durchschnitt entfernt ist – längstes der drei Fenster, zeigt die langfristigste Preis-Abweichung. Reagiert am trägsten, am wenigsten auf kurzfristiges Rauschen.

So entsteht der Wert: Z-Score der Distanz Preis-zu-SMA200 relativ zur eigenen jüngeren Historie, alle 15 Minuten neu berechnet.`,

  fundingZ: `So liest du das: Aktuelle Funding-Rate, standardisiert relativ zu ihrer eigenen jüngeren Historie – positiv bedeutet Funding aktuell höher als üblich (Longs dominieren). Verwandt mit dem funding-Faktor in der Gesamteinschätzung-Kachel, dort aber kontrafaktisch als Crowding-Warnung gelesen statt hier direkt als Richtungstendenz – bewusst unterschiedliche Lesart je Kachel.

So entsteht der Wert: Z-Score der Funding-Rate relativ zu ihrer eigenen jüngeren Historie, alle 15 Minuten neu berechnet.`,

  cvdZ: `So liest du das: Cumulative Volume Delta, standardisiert relativ zur eigenen Historie – positiv bedeutet aktuell mehr aggressive Käufe als üblich. Verwandt mit dem cvd-Faktor in der Gesamteinschätzung-Kachel (dort einfacher Trend statt Z-Score) – beide sollten grob dieselbe Richtung zeigen.

So entsteht der Wert: Z-Score des CVD relativ zu seiner eigenen jüngeren Historie, alle 15 Minuten neu berechnet.`,

  priceChange: `So liest du das: Prozentuale Preisänderung der letzten 6 Stunden, direkt ablesbar. Wird zusammen mit OI-Δ (6h) daneben zum OI/Preis-Quadranten kombiniert – für sich allein nur die halbe Information.

So entsteht der Wert: (aktueller Preis − Preis vor 6h) / Preis vor 6h, alle 15 Minuten neu berechnet.`,

  oiChange: `So liest du das: Prozentuale Open-Interest-Änderung der letzten 6 Stunden. Bewusst ohne eigenes Richtungs-Badge – steigendes wie fallendes OI können beide bullisch oder bärisch sein, je nachdem ob gleichzeitig long oder short aufgebaut wird. Erst zusammen mit Preis-Δ (siehe OI/Preis-Quadrant darunter) aussagekräftig.

So entsteht der Wert: (aktuelles OI − OI vor 6h) / OI vor 6h, alle 15 Minuten neu berechnet.`,

  oiPriceQuadrant: `So liest du das: Kombiniert Preis-Δ und OI-Δ zu einem von vier Zuständen: Long-Aufbau (Preis↑, OI↑), Short-Aufbau (Preis↓, OI↑), Short-Covering (Preis↑, OI↓), Long-Abbau (Preis↓, OI↓). Long-Aufbau/Short-Covering gelten als eher bullisch, Short-Aufbau/Long-Abbau als eher bärisch – der eigentliche Mehrwert gegenüber den beiden Einzelwerten daneben.

So entsteht der Wert: Vorzeichen-Kombination aus Preis-Δ und OI-Δ (6h), alle 15 Minuten neu berechnet.`,

  liqClusterDensity: `So liest du das: Wie dicht geschätzte Liquidations-Level aktuell um den Preis herum liegen, standardisiert. Ein hoher Wert bedeutet viele mögliche Liquidations-Trigger in der Nähe – potenziell schnellere/heftigere Bewegungen bei Erreichen dieser Level, aber ohne eigene Richtung. Reine Magnitude/Fragilitäts-Kennzahl, kein Richtungs-Badge.

So entsteht der Wert: Standardisierte Dichte geschätzter Liquidations-Cluster um den aktuellen Preis, alle 15 Minuten neu berechnet.`,

  netTakerFlow: `So liest du das: (aggressive Käufe − aggressive Verkäufe) / Gesamtvolumen, Wertebereich −1 bis +1. +1 bedeutet ausschließlich aggressive Käufer, −1 ausschließlich aggressive Verkäufer. Ähnliches Terrain wie CVD-Z-Score (beide messen Orderflow-Aggressivität), aber andere Berechnung (Verhältnis statt kumulativer Trend) – Übereinstimmung beider stärkt die Aussage.

So entsteht der Wert: Netto-Taker-Flow-Ratio über das jüngste Zeitfenster, alle 15 Minuten neu berechnet.`,
};

export const newsRiskInfo = `So liest du das: Als „markbewegend“ gilt eine Meldung ab einem Impact-Score von 75, der sich aus Kategorie (z. B. Fed, Treasury, ETF) und Keyword-Treffern ergibt. Die Einordnung ist eine automatisierte Klassifikation, keine redaktionelle Prüfung durch eine Person. Sie ist rein informativ und keine Anlageberatung.

So entsteht der Wert: Zeigt markbewegende Nachrichten der letzten 72 Stunden. Quellen sind RSS-Feeds von Fed, BLS und SEC (primär, hohe Verlässlichkeit) sowie Google-News-Suchen zu BTC-Makro-Themen (Wire-Quellen, geringere Verlässlichkeit), alle 15 Minuten neu abgerufen. Kategorie und Richtung (positiv/negativ/neutral) werden regelbasiert über feste Schlüsselwortlisten bestimmt – kein KI-Modell.`;

export const economicCalendarInfo = `So liest du das: Deckt gezielt die vier für BTC relevantesten US-Makrotermine ab (CPI, PCE, Nonfarm Payrolls, FOMC-Zinsentscheid) – kein vollständiger, globaler Wirtschaftskalender. Die BTC-Einordnung je Termin beschreibt die allgemein bekannte, historisch beobachtete Wirkungsrichtung, keine Prognose für den konkreten kommenden Termin und keine Anlageberatung.

So entsteht der Wert: CPI/PCE/NFP-Termine kommen direkt von FRED (St. Louis Fed, fred/release/dates), der FOMC-Termin aus dem offiziell veröffentlichten Fed-Sitzungskalender. Einmal täglich aktualisiert – Kalendertermine ändern sich selten und meist mit Vorlauf.`;

export const institutionalPlaybookInfo = `So liest du das: Ein reiner Lese-Leitfaden, keine eigene Datenquelle – zeigt, wie die bereits vorhandenen Kacheln (Gesamteinschätzung, Spot Pressure, OI Change, Liquidationen, Marktphase) sinnvoll zusammen gelesen werden können. Die Signal-Matrix greift dieselbe Long-Aufbau/Short-Aufbau/Short-Covering/Long-Abbau-Einteilung wieder auf, die auch in der Marktphasen-Kachel als „OI-Preis-Quadrant“ erscheint.

So entsteht der Wert: Statischer, fest hinterlegter Text – kein KI-Modell, keine Berechnung, keine Aktualisierung nötig. Die vier Markt-Muster und die Tages-Routine sind Interpretationshilfen zur Orientierung, kein Handelssignal und keine Anlageberatung.`;
