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

export function oiChangeInfo(tfLabel: string): string {
  return `So liest du das: Steigendes OI bedeutet, dass neue Positionen eröffnet werden, fallendes OI, dass Positionen geschlossen werden; ob es sich dabei um Long- oder Short-Positionen handelt, ist daraus allein nicht ablesbar. Bei „Aggregiert“ ist das die Summe des Open Interest aller Börsen, die zu diesem Zeitpunkt Daten geliefert haben (Bitunix liefert öffentlich kein Open Interest und fehlt daher immer).

So entsteht der Wert: Zeigt, wie stark sich das Open Interest der ausgewählten Börse gegenüber dem Wert vor ${tfLabel} verändert hat. Berechnet wird (aktueller Wert − Referenzwert) / Referenzwert, wobei der Referenzwert der tatsächlich nächstgelegene Datenpunkt vor ${tfLabel} ist – kein geschätzter Wert. Reicht die gespeicherte Historie noch nicht bis ${tfLabel} zurück, wird stattdessen der älteste verfügbare Punkt verwendet und das im Panel vermerkt.`;
}

export function btcOiChartInfo(tfLabel: string): string {
  return `So liest du das: Die Kombination beider Linien ist aussagekräftiger als eine allein: „BTC ↑ + OI ↑“ deutet eher auf Positionsaufbau hin, „BTC ↑ + OI ↓“ eher auf Short-Covering bzw. Positionsabbau. Für die vollständige regelbasierte Einordnung dieser Kombination siehe „Marktkontext“ oben im Dashboard. Der Chart selbst bewertet nichts, er stellt nur die beiden normalisierten Verläufe nebeneinander dar.

So entsteht der Wert: Vergleicht die prozentuale Entwicklung von BTC-Preis und Open Interest über ${tfLabel} in einem gemeinsamen Chart, für dieselbe Börse wie in der OI-Change-Kachel oben ausgewählt. Beide Linien werden unabhängig voneinander auf ihren jeweils ersten verfügbaren Punkt im Fenster normalisiert (= 0 %), damit sie trotz unterschiedlicher Grössenordnung auf einer Achse vergleichbar sind.`;
}

export function exchangeDivergenceInfo(tfLabel: string): string {
  return `So liest du das: Bewegen sich die Börsen deutlich unterschiedlich (Divergenz), kann das auf eine Bewegung hindeuten, die nur auf einzelnen Börsen konzentriert ist statt breit vom Markt getragen zu werden – eine Divergenz ist dabei nicht automatisch bullisch oder bärisch zu werten. „UNAVAILABLE“ bei Bitunix bedeutet, dass diese Börse öffentlich kein Open Interest anbietet, kein fehlender Datenpunkt. Ein „*“ markiert Börsen, deren Historie für ${tfLabel} noch nicht vollständig zurückreicht.

So entsteht der Wert: Zeigt standardmässig den ungewichteten Durchschnitt der OI-Change % über alle Börsen mit vorhandenem Wert (Bitunix ausgenommen) – antippen zeigt jede Börse einzeln, macht sichtbar, welche tatsächlich in die „Aggregiert“-Summe der OI-Change-Kachel oben einfliessen. Berechnet wird pro Börse dieselbe (Wert − Referenzwert)/Referenzwert-Formel wie bei OI Change, nur separat statt summiert.`;
}

export const fundingRateInfo = `Was es misst: die Ausgleichszahlung zwischen Long- und Short-Positionen im BTC-Perpetual. Positiv heisst, Longs zahlen an Shorts; negativ heisst, Shorts zahlen an Longs.

Stufen pro 8 h:
• bis 0,01 %: Neutral. Das ist der Standardwert der Börsen, etwa 11 % pro Jahr.
• 0,01 bis 0,03 %: Erhöht, typisch in Aufwärtstrends.
• 0,03 bis 0,05 %: Hoch, deutliches Long-Crowding.
• ab 0,05 %: Extrem (dieselbe Schwelle wie in der Gesamteinschätzung), etwa 55 % pro Jahr.
• ab 0,1 %: Euphorie, Ausnahmezustand.
• unter −0,01 %: Negativ; ab −0,05 %: Extrem negativ, Shorts überfüllt.

Wie du es nutzt: Hohes Funding allein ist kein Short-Signal, es kann im Aufwärtstrend wochenlang hoch bleiben. Gefährlich wird es, wenn Funding über mehrere Intervalle extrem ist, das Open Interest stark steigt und der Preis nicht mehr vorankommt. Die Stufen sind Faustregeln, im Backtest noch nicht validiert.

Quelle: Wert von Bybit (Referenzbörse), von der Börse selbst berechnet. Der Chart zeigt die letzten rund 15 Stunden; der aktuelle Wert je Börse steht im Börsenvergleich.

Positionierung (unten in der Kachel): Kontrakte sind immer 50:50, jeder Long hat einen Short. Die Zahlen zeigen nur, wer auf welcher Seite steht.
• Masse long: Anteil der Konten mit Long-Position, Mittel über Binance, Bybit, OKX und Bitget. Üblich sind 55–62 %. Ab 65 % ist die Masse stark long, ab 70 % extrem; unter 50 % ist sie mehrheitlich short.
• Top-Trader long: Binance-Top-Trader nach Positionsgrösse, also wo das grosse Geld liegt.
• Abstand: Top-Trader minus Masse (Binance). Normal sind etwa +5 bis +20 Pp. Bei 0 oder darunter stehen die grossen Konten eher auf der Gegenseite der kleinen.
So liest du es zusammen: Masse stark long, Funding hoch, OI steigt und der Preis kommt nicht voran: Die Longs sind der Treibstoff für den nächsten Flush nach unten. Spiegelbildlich gilt das für eine Short-lastige Masse mit negativem Funding. Schwellen aus der eigenen Historie seit 24.08.2026, nicht validiert.`;

export function spotPressureInfo(tfLabel: string): string {
  return `So liest du das: Ordnet den Netto-Taker-Flow einem von vier Verdikten zu: BUYING PRESSURE, SELLING PRESSURE, NEUTRAL oder INSUFFICIENT DATA. Das misst eine Kauf-/Verkaufs-Imbalance im Taker-Orderflow, nicht ob am Spot-Markt tatsächlich netto mehr Coins gekauft als verkauft wurden. Deckt die Stichprobe weniger als 80 % der erwarteten Kerzen im Fenster ab, gilt das Ergebnis als PRELIMINARY, unter 20 % als INSUFFICIENT DATA.

So entsteht der Wert: Datenbasis ist ausschliesslich Binance Spot BTC/USDT im 5-Minuten-Takt über ${tfLabel} – die einzige öffentliche Route mit echtem Taker-Buy/Sell-Split, keine Schätzung. Berechnet wird (Taker-Kaufvolumen − Taker-Verkaufsvolumen) / Gesamtvolumen über alle Kerzen im Fenster; ab ±5 % gilt BUYING bzw. SELLING PRESSURE, sonst NEUTRAL.`;
}

// Spot-Volumen-Profil -- nutzt dieselbe get_spot_volume_profile-RPC wie die
// Key Levels in der Struktur-Kachel, hier als eigene Grafik. Anders als der
// Chart darueber (WANN gekauft/verkauft wurde) zeigt es, BEI WELCHEM PREIS.
export function spotVolumeProfileInfo(tfLabel: string): string {
  return `So liest du das: Je Preis-Bucket ($200-Schritte) ein grüner Balken nach rechts (Kaufvolumen) und ein roter Balken nach links (Verkaufsvolumen) -- gespiegelt an der Nulllinie, wie ein klassisches Volume Profile. Ein Bucket mit deutlich mehr Kauf- als Verkaufsvolumen ist ein Hinweis auf eine mögliche Unterstützung (dort wurde bereits aktiv gekauft), deutlich mehr Verkaufsvolumen auf einen möglichen Widerstand (dort wurde bereits aktiv verkauft) -- eine Beobachtungshilfe, kein geprüftes/validiertes Signal und keine Anlageberatung.

So entsteht der Wert: Binance Spot BTC/USDT Aggregated-Trades (echte Taker-Buy/Sell-Klassifikation, keine Schätzung), lückenlos per Cursor erfasst (alle 5 Minuten) und direkt beim Erfassen in $200-Preis-Buckets aggregiert. Zeitraum: derselbe ${tfLabel}, der oben im Dashboard gewählt ist. Dieselben Preis-Buckets fliessen auch als Bestätigung in die Key Levels der Struktur-Kachel ein (Seite "Lernen" → Mein System).`;
}

export const etfMacroInfo = `So liest du das: Momentum zeigt den Trend „beschleunigend“/„abflachend“/„stabil“ ab ±15 % Abweichung. Der Fliesstext vergleicht zusätzlich, ob die ETF-Flow-Richtung (netto positiv/negativ) mit der Mehrheitsrichtung markbewegender Makro-News der letzten 72h (Kategorien Fed/Treasury/CPI/ETF) übereinstimmt oder auseinanderläuft – dieselbe News-Basis wie im News-Risk-Panel. Das sind einfache Gegenüberstellungen, keine gewichtete Analyse und kein Handelssignal. Dieses Panel fliesst nicht in das regelbasierte Marktkontext-Assessment oben ein, sondern ist eine eigenständige, separate Betrachtung.

So entsteht der Wert: Zeigt den Netto-Kapitalfluss der US-Spot-BTC-ETFs für den letzten gemeldeten Handelstag sowie die Summe der letzten 5 Handelstage. Quelle ist SoSoValue (offizielle API), bei älteren Einträgen noch Farside Investors – die Daten kommen mit T+1-Verzögerung, nicht in Echtzeit. Momentum vergleicht die Flow-Summe der jüngeren mit der älteren Hälfte eines 10-Handelstage-Fensters; daneben die Preis- und Open-Interest-Veränderung im selben Zeitraum – letztere basiert auf der bereits bestehenden aggregierten OI-Historie und zeigt „nicht verfügbar“ statt eines erfundenen Werts, wenn dafür keine Historie vorliegt.`;

export const marketStateInfo = `So liest du das: Confidence kombiniert Datenabdeckung mit der Einigkeit der Faktoren. „Signal-Stärke“ zeigt, wie viele Faktoren überhaupt eine Richtung zeigen, „Konsens“, wie einig sich diese sind – so erkennst du, ob eine niedrige Confidence an fehlender Aussage oder an echtem Widerspruch liegt. Risk misst unabhängig davon die Fragilität der Lage (Warn-Muster, uneinige Zeitrahmen, Funding-Crowding, hohe Volatilität). MTF-Alignment zeigt die gewichtete Trend-Übereinstimmung über 1H/4H/1D als eine Zahl; Muster wie „Short Squeeze“ sind Interpretationshilfen, keine Handelssignale. Unter 35/100 Confidence wird ein berechnetes Bullisch/Bärisch bewusst als „Unklar / kein Zustand“ angezeigt – reine Anzeige-Entscheidung, der gespeicherte Zustand bleibt für Backtests unverändert. Die „MTF-Ampel“ darunter (22.09.2026, 1W seit 02.10.2026 ergänzt) zeigt zusätzlich die Rohwerte pro Zeitrahmen: je ein Punkt für 15M/1H/4H/1D/1W, grün/rot = bestätigter Trend (ADX ≥25), hohler grüner/roter Ring = Trendbildung in diese Richtung (ADX <25, Struktur aber schon eindeutig), grau = neutral, ausgegraut = keine aktuellen Daten für diesen Zeitrahmen – tippe/hover einen Punkt für den genauen Wert.

So entsteht der Wert: Kombiniert vierzehn unabhängige Kennzahlen aus sechs Bereichen (Struktur/Trend, Momentum, Orderflow/Derivate, Positionierung, Optionen, Makro/Sentiment) zu einem Gesamtzustand – kein Black-Box-Score, jeder Faktor ist unter „Faktoren anzeigen“ einzeln mit Rohwert einsehbar (z. B. „RSI 37.2“). Fehlt eine Datenquelle oder ist sie veraltet, zählt sie als „keine Daten“ statt als neutral, was die Verlässlichkeit senkt. Wird alle 15 Minuten neu berechnet.

„Wird neu validiert“: Anders als der Setup-Score daneben (dreifach out-of-sample gegen echte Setup-Trefferquoten getestet) ist die 14-Faktoren-Formel hier bisher nicht gegen eine eigene Zielgrösse statistisch validiert. Institutionelle Praxis trennt Regime-Einschätzung von Trade-Signal-Scoring strikt (siehe docs/research/NEXUS-STRUKTUR-KONZEPT_2026-09-12.md, Abschnitt 5) – ein eigenes, vorregistriertes Gesamteinschätzung-Score-Protokoll ist als nächstes eigenständiges Vorhaben vorgesehen.`;

export const marketStateMatrixInfo = `So liest du das: Die sieben möglichen Regimes sind „Trendausweitung“ (bullisch/bärisch, wenn ADX ≥25 und Trendrichtung/Regressionssteigung übereinstimmen), „Trendbildung“ (dieselbe Übereinstimmung, aber ADX noch zwischen 20 und 25 – ein schwächerer, noch nicht vollständig bestätigter Trend, seit 21.09.2026 ergänzt), „Volatilitäts-Squeeze“ (niedriger ADX bei komprimierten Bollinger-Bändern – typische Phase vor einem Ausbruch), „Hohe Volatilität/Reversion“ (Volatilitätsspitze bei gleichzeitig weit vom Mittelwert entferntem Preis) oder „Unklar / kein Regime“ als bewusst nicht erfundenes Ergebnis, wenn die Signale nicht übereinstimmen oder Kerndaten fehlen. Das ist eine von der 14-Faktoren-„Gesamteinschätzung“ oben unabhängige, zusätzliche Einordnung, kein Ersatz dafür. Dieselbe Confidence-Sperre wie beim Gesamtzustand gilt auch hier: Liegt die Confidence der Gesamteinschätzung unter 35/100, werden die gerichteten Regimes (Trendausweitung UND Trendbildung) hier ebenfalls nicht als solche angezeigt, sondern als unklar gekennzeichnet. Zusätzlich wird angezeigt, wenn die Richtung dieser Regime-Einordnung und die Richtung des 14-Faktoren-Gesamtzustands übereinstimmen oder sich widersprechen (Engine-Divergenz) – nur sichtbar, wenn beide Engines eine eindeutige Richtung liefern und die Confidence-Sperre nicht bereits greift. Ein optionales „TradingView Context“-Badge zeigt das jüngste externe Signal (Pine-Script-Alert, per Webhook empfangen) der letzten 24 Stunden – rein informativ, fließt nicht in Score, Confidence oder Regime ein und wird nach 24 Stunden automatisch ausgeblendet. Zusätzlicher Hinweis „Kurzfristig bereits seitwärts“ (nur bei aktiver Trendausweitung sichtbar): die 1h-Engine kann nach einem abgeschlossenen Trendimpuls mehrere Stunden nachlaufen, da ADX/Regressionssteigung noch die vorherige Bewegung widerspiegeln – ein separater, unabhängiger Check auf den letzten 16 15-Minuten-Kerzen (4h) markiert das, wenn der ADX dort unter 20 liegt UND die Bollinger-Bänder eng sind (dieselben Schwellen wie beim Volatilitäts-Squeeze-Regime oben, nur auf kürzerer Zeitbasis). Die fünf kleinen Punkte oben rechts neben dem Titel sind die „MTF-Ampel“ (22.09.2026, 1W seit 02.10.2026 ergänzt): je ein Punkt für 15M/1H/4H/1D/1W, grün/rot = bestätigter Trend (ADX ≥25), hohler grüner/roter Ring = Trendbildung in diese Richtung (ADX <25, aber Struktur schon eindeutig), grau = neutral/seitwärts, ausgegraut mit Rahmen = keine aktuellen Daten für diesen Zeitrahmen. Tippe/hover einen Punkt für den genauen Wert. Eigenständig von den fünf Feature-Säulen unten (die sind reine 1H-Werte) – hier geht es nur darum, ob sich Struktur/ADX über mehrere Zeitrahmen hinweg gleich oder unterschiedlich lesen.

So entsteht der Wert: Führt fünf unabhängige Feature-Säulen (Trend: ADX/DMI + Regressionssteigung; Volatilität: Bollinger-Breite + Normalized-ATR-Ratio; Momentum/Mean-Reversion: RSI + Distanz-zu-SMA50-Z-Score; Mikrostruktur/Derivate: Funding-Z-Score, OI-vs-Preis-Quadrant, CVD-Z-Score; Makro/Sentiment: Liquidation-Cluster-Density, Net-Taker-Flow-Ratio) zusammen. Der Kerzen-Zeitrahmen folgt der Zeitraum-Auswahl oben (15M und 1H → 1H, 4H, 24H → 1D, 1W/1M → 1W, Binance). 1H wird alle 15 Minuten gespeichert, die übrigen Zeitrahmen werden beim Laden aus den letzten 400 Kerzen berechnet. Die Schwellen (z. B. ADX 25) sind für Stundenkerzen gewählt: Auf 1D/1W reagiert die Phase deshalb träger. Gesamteinschätzung, Briefing und Scores nutzen immer 1H. Regelbasiert, kein KI-Modell, keine Anlageberatung.`;

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

  oi_price: `So liest du das: Nur bei spürbarer OI-Bewegung (über 0,3%) überhaupt eine Aussage – die Richtung kommt dann vom Preis relativ zum 20er-EMA, nicht vom OI-Vorzeichen allein (steigendes wie fallendes OI können je nach Kontext beides bedeuten). Die feinere 4-Felder-Version derselben Idee (Long-/Short-Aufbau, Short-Covering, Long-Abbau) zeigt die Marktkontext-Kachel.

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

  priceChange: `So liest du das: Prozentuale Preisänderung der letzten 6 Stunden, direkt ablesbar. Für sich allein nur die halbe Information – die Kombination mit der OI-Änderung zeigt die Marktkontext-Kachel.

So entsteht der Wert: (aktueller Preis − Preis vor 6h) / Preis vor 6h, alle 15 Minuten neu berechnet.`,

  oiChange: `So liest du das: Prozentuale Open-Interest-Änderung der letzten 6 Stunden. Bewusst ohne eigenes Richtungs-Badge – steigendes wie fallendes OI können beide bullisch oder bärisch sein, je nachdem ob gleichzeitig long oder short aufgebaut wird. Erst zusammen mit Preis-Δ aussagekräftig – diese Kombination zeigt die Marktkontext-Kachel.

So entsteht der Wert: (aktuelles OI − OI vor 6h) / OI vor 6h, alle 15 Minuten neu berechnet.`,

  liqClusterDensity: `So liest du das: Wie dicht geschätzte Liquidations-Level aktuell um den Preis herum liegen, standardisiert. Ein hoher Wert bedeutet viele mögliche Liquidations-Trigger in der Nähe – potenziell schnellere/heftigere Bewegungen bei Erreichen dieser Level, aber ohne eigene Richtung. Reine Magnitude/Fragilitäts-Kennzahl, kein Richtungs-Badge.

So entsteht der Wert: Standardisierte Dichte geschätzter Liquidations-Cluster um den aktuellen Preis, alle 15 Minuten neu berechnet.`,

  netTakerFlow: `So liest du das: (aggressive Käufe − aggressive Verkäufe) / Gesamtvolumen, Wertebereich −1 bis +1. +1 bedeutet ausschließlich aggressive Käufer, −1 ausschließlich aggressive Verkäufer. Ähnliches Terrain wie CVD-Z-Score (beide messen Orderflow-Aggressivität), aber andere Berechnung (Verhältnis statt kumulativer Trend) – Übereinstimmung beider stärkt die Aussage.

So entsteht der Wert: Netto-Taker-Flow-Ratio über das jüngste Zeitfenster, alle 15 Minuten neu berechnet.`,
};

export const newsRiskInfo = `So liest du das: Gezeigt werden nur Meldungen zu Fed und CPI (Inflation). Als „markbewegend“ gilt eine Meldung ab einem Impact-Score von 75, der sich aus Kategorie (z. B. Fed, Treasury, ETF) und Keyword-Treffern ergibt. Die Einordnung ist eine automatisierte Klassifikation, keine redaktionelle Prüfung durch eine Person. Sie ist rein informativ und keine Anlageberatung.

So entsteht der Wert: Zeigt markbewegende Nachrichten der letzten 72 Stunden. Quellen sind RSS-Feeds von Fed, BLS und SEC (primär, hohe Verlässlichkeit) sowie Google-News-Suchen zu BTC-Makro-Themen (Wire-Quellen, geringere Verlässlichkeit), alle 15 Minuten neu abgerufen. Kategorie und Richtung (positiv/negativ/neutral) werden regelbasiert über feste Schlüsselwortlisten bestimmt – kein KI-Modell.`;

export const economicCalendarInfo = `So liest du das: Deckt gezielt die vier für BTC relevantesten US-Makrotermine ab (CPI, PCE, Nonfarm Payrolls, FOMC-Zinsentscheid) – kein vollständiger, globaler Wirtschaftskalender. Die BTC-Einordnung je Termin beschreibt die allgemein bekannte, historisch beobachtete Wirkungsrichtung, keine Prognose für den konkreten kommenden Termin und keine Anlageberatung. Die Pfeil/Farb-Legende zeigt, was ein Ergebnis höher oder tiefer als erwartet bedeuten würde (🔴 bärisch/🟢 bullisch für BTC). Sobald nach dem Termin die ersten Schlagzeilen da sind, fasst eine KI das Ergebnis in 1–2 Sätzen zusammen und ordnet es als bullisch/bärisch/neutral ein – hier, im Lagebild (1 Stunde lang) und per Push. Du wirst zusätzlich 60 und 15 Minuten vor jedem Termin per Push gewarnt.

So entsteht der Wert: CPI/PCE/NFP-Termine kommen von FRED (St. Louis Fed, fred/release/dates), der FOMC-Termin aus dem offiziellen Fed-Sitzungskalender – einmal täglich aktualisiert. Das Ergebnis stammt aus den gesammelten News-Schlagzeilen ab dem Termin (passend zum Ereignis, z. B. „CPI“/„Inflation“); die KI erfindet keine Zahlen, die nicht in den Schlagzeilen stehen. Uhrzeiten in Schweizer Zeit.`;


// GUSS/VWAP-Vector/CVD (Umsetzungsplan "Exakte Faktoren", Phase 1-3): Tobys
// eigene TradingView-Indikatoren, serverseitig nachgebaut in
// lib/tradingIndicatorsContext.ts.
export const gussSignalInfo = `So liest du das: GUSS ist ein Pullback-Einstiegs-Indikator (Original-Skript nicht einsehbar, Regel von Toby spezifiziert). "Berührt" heisst, der Docht einer Kerze seit dem letzten Swing-Hoch (im Aufwärtstrend) bzw. Swing-Tief (im Abwärtstrend) hat den EMA-Wert erreicht – eine Körper-Berührung ist nicht nötig. "Sauber" heisst, keine Kerze auf diesem Weg schloss entgegen der Pullback-Richtung. Beide Bedingungen müssen erfüllt sein, plus: Nexus' Regime-Engine muss den Markt aktuell als Trend einstufen (Trendausweitung bullisch/bärisch) – bei Seitwärts/Volatilitäts-Squeeze oder unklarem Regime wird GUSS bewusst als nicht anwendbar angezeigt statt eines erfundenen Signals. Da unklar ist, ob EMA21 oder EMA50 gemeint ist, werden beide Varianten parallel angezeigt. Reine Entscheidungsunterstützung, kein automatisches Handelssignal.

So entsteht der Wert: Letzte 300 1H-Kerzen (Swing-Erkennung mit Lookback 20, wie Mo's VWAP-Vector-Skript), EMA21/EMA50 als volle Zeitreihe berechnet (nicht nur der aktuelle Endwert), Regime aus market_state_matrix.regime – bei jedem Seitenaufruf neu berechnet.`;

export const vwapVectorInfo = `So liest du das: Fünf VWAP-Varianten (Tag/Woche/Monat/seit letztem Swing-Hoch/seit letztem Swing-Tief) zeigen den volumengewichteten Durchschnittspreis seit unterschiedlichen Ankerpunkten – Preis darüber deutet auf Käuferkontrolle seit diesem Anker, darunter auf Verkäuferkontrolle. Der EMA-Fächer (1H und 4H) ist unverändert aus den bestehenden Nexus-Kennzahlen übernommen, keine Neuberechnung. Die Fibonacci-Retracement-Stufen liegen zwischen dem jüngsten Swing-Hoch und -Tief – ein reines Rechengitter (0–100%), keine erkannte ATR-Erweiterung wie im Original-Skript (dessen Quellcode nicht einsehbar ist). Reine Entscheidungsunterstützung, kein automatisches Handelssignal.

So entsteht der Wert: Wochen-/Monats-/Swing-VWAP über get_anchored_vwap_summary(), Tag-/Swing-Hoch-/Swing-Tief-VWAP über die neue RPC get_vwap_since() (gleiche Arithmetik, anderer Anker) – Swing-Anker aus derselben Swing-Erkennung wie beim GUSS-Signal (Lookback 20). Bei jedem Seitenaufruf neu berechnet.`;

export const cvdFootprintInfo = `So liest du das: Zeigt die tatsächliche Käufer-/Verkäufer-Aggressivität INNERHALB jeder 1H-Kerze (aus echten 1-Minuten-Taker-Buy/Sell-Volumina) – ein positives Delta bedeutet mehr aggressive Käufe als Verkäufe in dieser Stunde. "Kumulativ" ist nur über das geladene Zeitfenster aufsummiert, kein Wert seit Symbol-Beginn – gedacht für Trend-/Divergenz-Einordnung, nicht als absolute Zahl. Eine Divergenz-Meldung erscheint, wenn der Preis ein neues Hoch/Tief markiert, der CVD-Wert an diesem Punkt aber NICHT mitzieht – eine Interpretationshilfe (wie bei RSI-/MACD-Divergenz), kein automatisches Handelssignal. WICHTIG: unterscheidet sich bewusst von "cvd_delta"/"cvd_trend" in der Marktzustand-Kachel – dort wird dieselbe Kennzahl AM NATIVEN INTERVALL selbst berechnet (kein Intrabar-Rollup aus 1-Minuten-Daten), also ein gröberes, anderes Konzept.

So entsteht der Wert: Alle 1-Minuten-Kerzen innerhalb der letzten 48 Stunden werden ihrer jeweiligen 1H-Kerze zugeordnet und dort aufsummiert (2×Taker-Buy-Volumen − Gesamtvolumen je Minute – echte Binance-Aggressor-Daten, keine Schätzung). Divergenz-Check über Preis-Pivots mit Lookback 10 (wie Mo's Original-Skript). Bei jedem Seitenaufruf neu berechnet.`;

// Momentum-Divergenz-Warnhinweis (Prototyp, siehe lib/momentumDivergence.ts)
// -- reine Anzeige-Ableitung, keine neue Berechnung/Query.
export const momentumDivergenceInfo = `So liest du das: Erscheint, wenn die Gesamteinschätzung (Bullisch/Bärisch) von einem bereits etablierten Trend (ADX ≥ 25) getragen wird, das Momentum (MACD-Histogramm) diesem Trend aber inzwischen widerspricht – ein klassisches Warnzeichen für nachlassenden Schwung VOR einer möglichen Trendwende. Eine erste Rückblick-Auswertung (19.09.2026, Stand ~3,5 Wochen Historie) zeigte für Bullisch-Aufrufe: mit bestätigendem Momentum 58,8% Trefferquote (n=17) über 24h, bei widersprechendem Momentum dagegen 0 von 8 Treffern (Ø −2,8%). Das Muster ist durchgängig und mechanistisch plausibel, aber die Stichprobe ist noch klein – deshalb ausdrücklich nur ein Hinweis, keine bewiesene Regel und kein Handelssignal. Ändert nichts an der gespeicherten Gesamteinschätzung selbst.

So entsteht der Wert: Rein clientseitig aus den ohnehin bereits geladenen 14-Faktoren-Rohwerten abgeleitet (ADX aus "Trend-Stärke", MACD-Histogramm aus "Momentum") – keine zusätzliche Datenbankabfrage, keine neue Berechnung in compute-market-state.`;

// Struktur: Key Levels, AVWAP, Trendlinien, Muster (siehe
// lib/chartStructureContext.ts) -- reine Berechnung, kein KI-Aufruf.
export const chartStructureInfo = `So liest du das: Sechs eigenständige, rein rechnerisch (keine KI) ermittelte Struktur-Bausteine, die meisten auf den letzten 300 1H-Kerzen – Key Levels bilden davon die Ausnahme (siehe unten, vier Zeitrahmen gleichzeitig).

Kerzenmuster: klassische Umkehrformationen (Doji, Hammer/Hanging Man, Engulfing, Morning/Evening Star) nach Stefan Salomons Definitionen – ein Rückblick-Backtest fand dafür KEINE statistisch signifikante Edge (nach BH-FDR-Korrektur), rein informativ.

AVWAP-Pivot: an jedem bestätigten Pivot-Hoch/-Tief (Schlusskurs, kurze Pivot-Länge) startet eine volumengewichtete Durchschnittspreis-Linie, die aktiv bleibt, bis ein Schlusskurs sie eindeutig durchbricht – mehrere Linien gleichzeitig als Konfluenzzonen. Ebenfalls ohne nachgewiesene Backtest-Edge.

Trendlinien: verbindet die zwei jüngsten Swing-Tiefs (Aufwärtslinie) bzw. Swing-Hochs (Abwärtslinie) – "bestätigt" ab mindestens 3 Berührungspunkten (Stefan Salomon: "Eine Linie ist erst dann ein statistisch relevanter Trend, wenn sie mindestens drei Berührungspunkte hat"), sonst als unbestätigt markiert, aber trotzdem gezeigt.

Chart-Formationen: Doppel-Top/-Boden (zwei ähnlich hohe Hochs/Tiefs mit einem Gegenpunkt dazwischen als Nackenlinie), Kopf-Schulter/inverse Kopf-Schulter (drei Hochs/Tiefs, die mittlere am extremsten, die äußeren ähnlich hoch), sowie Dreiecke (steigend/fallend/symmetrisch, aus denselben zwei Trendlinien oben). "Bestätigt" heißt: der Schlusskurs hat die Nackenlinie nach dem zweiten Top/Bottom bzw. der zweiten Schulter bereits durchbrochen – sonst als unbestätigt markiert, aber trotzdem gezeigt (Dreiecke haben keine Nackenlinie, sind rein beschreibend).

Flaggen/Wimpel/Keile: ein eigenständiger, lokaler Baustein – erst wird ein scharfer vorangehender Kursimpuls gesucht (der "Flaggenmast", mind. das 3-fache der durchschnittlichen Kerzenspanne), danach eine kurze Konsolidierung direkt danach klassifiziert: bleibt der Kanal etwa gleich breit → Flagge, verengt er sich mit gegenläufigen Linien → Wimpel, mit gleichgerichteten Linien → Keil. Bewusst OHNE Richtungs-Prognose (kein "bullisch/bärisch" wie bei Doppel-Top) – ob ein Keil in diesem Kontext eher Fortsetzung oder Umkehr bedeutet, ist in der Chartanalyse-Literatur selbst uneinheitlich, rein strukturelle Beschreibung.

Key Levels: Pivot-Punkte (fraktale Schwenkpunkte, gleicher Massstab wie AVWAP-Pivot) auf vier Zeitrahmen gleichzeitig – Wochen/Tag/4H/1H. Liegen Pivots aus mehreren Zeitrahmen nahe beieinander (±0,3%), werden sie zu einer Zone gebündelt – je mehr Zeitrahmen, desto stärker die Zone. Zusätzlich verstärkt, wenn eine Zone mit einem Liquidations-Cluster der letzten 6 Stunden, einer EMA (13/50/200), einer VWAP-Linie (Tag/Woche/Swing) oder einem Spot-Volumen-Knoten zusammenfällt – jeweils als eigenes Kürzel neben der Zone sichtbar. Spot-Volumen-Knoten zeigen, wo sich tatsächlich gehandeltes Kauf-/Verkaufsvolumen der letzten 6 Stunden konzentriert (Binance-Spot, alle 5 Min vollständig erfasst, keine Stichprobe) – Kauf-Übergewicht gilt als Support-, Verkaufs-Übergewicht als Widerstand-Hinweis; kann auch ganz ohne nahen Pivot eine eigene Zone bilden. Bewusst ohne Fibonacci/Orderbook-Wände, die stehen bereits in eigenen Kacheln auf dieser Seite.

Reine Entscheidungsunterstützung, kein automatisches Handelssignal und keine Anlageberatung.

So entsteht der Wert: Bei jedem Seitenaufruf neu berechnet, keine gespeicherten Snapshots.`;

export const levelStructureInfo = `So liest du das: Je Key-Level (die zwei nächstgelegenen pro Seite, nur mit Pivot-Anker) wird nachgezeichnet, ob die Zone seit ihrem Pivot noch hält ("keine höheren Hochs" bei Widerstand, "keine tieferen Tiefs" bei Unterstützung) oder bereits gebrochen wurde – inkl. ehrlichem Hinweis auf einen etwaigen Gegentest nach dem Bruch (z.B. ein tieferer Dip kurz nach dem Durchbruch, der die Zone nochmal berührt, bevor die Struktur sich wieder dreht).

Konfluenz-Stufe: Schwach = nur das Key-Level selbst, Mittel = zusätzlich EMA50 ODER Swing-VWAP nahe dran, Stark = beides gleichzeitig – liest dieselbe Konfluenz-Markierung, die auch bei "Struktur: Key Levels..." neben der Zone steht.

Andere Signale: zeigt, wie viele der aktuell laufenden Nexus-Signale (CVD-Trend, Warn-Muster, MTF-Ampel) gerade bullisch bzw. bärisch stehen – bewusst ungewichtet (einfache Zählung) und bewusst der AKTUELLE Stand, keine Rückrechnung, wie diese Signale zum Zeitpunkt der Ablehnung/des Bruchs selbst standen.

So entsteht der Wert: Bruch-Erkennung über den Schlusskurs der letzten bis zu 270 Tage (1H-Kerzen), Gegentest-Erkennung über market_features.swing_type (dieselbe Swing-Hoch/-Tief-Klassifikation, die auch die MTF-Ampel/Markt-Struktur-Faktoren nutzen) – reine Berechnung, kein KI-Modell. Keine Anlageberatung.`;

export function spotPerpFlowInfo(tfLabel: string): string {
  return `Was es misst: den Netto-Taker-Flow (aggressive Käufe minus aggressive Verkäufe, in % des Volumens) über ${tfLabel}, getrennt für Binance Spot und Binance Perp. So siehst du, wer eine Bewegung trägt: echte Spot-Käufer oder Hebel-Trader.

Schwellen: Spot gilt ab ±5 % als kaufend oder verkaufend (wie Spot Pressure), Perp ab ±2 %. Perp-Flow schwankt deutlich weniger; beide Schwellen liegen etwa beim typischen Tageswert der letzten 60 Tage.

Wie du es nutzt: Spot kauft, Perp flach = organische Nachfrage, tendenziell nachhaltig. Spot flach, Perp kauft = hebelgetrieben, fragil. Spot verkauft, Perp kauft = Warnsignal für gefangene Longs. Das sind Tendenzen, keine validierten Signale. Binance-Spot zeigt nicht die US-Nachfrage; dafür steht darunter die Coinbase-Premium.

Verlauf: Der Chart zeigt Spot-CVD und Perp-CVD kumuliert über den Zeitraum, jeweils in % des eigenen Volumens. So sind beide trotz des etwa zehnfach höheren Perp-Volumens vergleichbar, und die Linien enden genau bei den Werten oben. Divergenz = Spot minus Perp: Steigt sie, kauft Spot relativ stärker als die Perps (eher organisch); fällt sie, treiben die Perps.

Quelle: Binance Spot (5-Min-Kerzen) und Binance Futures (Kerzen aus collect-candles), jeweils mit echtem Taker-Kauf-Anteil.`;
}

export const coinbasePremiumInfo = `Was es misst: den Preisabstand von Coinbase (BTC-USD) zu Binance (BTC-USDT) in Prozent, über dieselben 5-Minuten-Kerzen verglichen. Coinbase ist die Hauptbörse der US-Institutionen und ETF-Verwahrer.

Stufen:
• unter ±0,03 %: Neutral (Rauschen aus Spread und Umrechnung)
• ab +0,03 %: US-Kaufdruck; ab +0,1 %: stark
• ab −0,03 %: US-Verkaufsdruck; ab −0,1 %: stark

Wie du es nutzt: Zählt nur, wenn die Prämie über Stunden anhält. Eine positive Prämie bei steigendem Preis bestätigt US-Nachfrage; fällt der Preis trotz positiver Prämie, verkaufen andere Regionen oder die Perps. Die Stufen sind Faustregeln, nicht im Backtest geprüft.

Quelle: Coinbase-Exchange-API (letzte 300 Kerzen = 25 h), Binance aus der Nexus-Datenbank. Der Binance-Preis in USDT wird mit dem USDT-USD-Kurs von Coinbase in echte USD umgerechnet. Sonst stünde ein USDT-Abschlag (z. B. 0,9987 USD = −0,13 %) fälschlich als US-Verkaufsdruck da.`;

// RSI-/MACD-Divergenz-Hinweis im Lagebild (lib/oscillatorDivergence.ts).
export const oscillatorDivergenceInfo = `So liest du das: Zeigt aktuelle RSI- und MACD-Divergenzen auf 1H, 4H und 1D. Klassisch bärisch: Kurs macht ein höheres Hoch, der Oszillator ein tieferes (Schwung lässt nach). Versteckt bärisch: Kurs tieferes Hoch, Oszillator höheres (Abwärtstrend setzt sich eher fort). Bullisch spiegelbildlich an den Tiefs. Laut deinem Regelwerk immer nur ein Hinweis bzw. eine Warnung, keine Pflicht und keine Sperre. StochRSI wird nicht mehr verwendet.

So entsteht der Wert: Schlusskurs-Pivots mit je 5 Kerzen links und rechts, verglichen mit RSI(14) bzw. dem MACD-Histogramm an denselben Kerzen. Angezeigt wird nur, wenn das jüngere Pivot höchstens 15 Kerzen zurückliegt. Weil ein Pivot erst nach 5 Folgekerzen bestätigt ist, erscheint eine Divergenz entsprechend verzögert (1H: 5 Stunden, 4H: 20 Stunden, 1D: 5 Tage).`;

// TP-Standard-Vorschlag im Lagebild (lib/tpStandard.ts).
export const tpStandardInfo = `So liest du das: Je Richtung der nächste Widerstand (Long) bzw. die nächste Unterstützung (Short) und der grösste deiner vier Standards, dessen TP noch vor diesem Level liegt: ab 1,75 % Abstand Standard 1 (TP 35 % Marge), ab 1,5 % Standard 2 (30 %), ab 1,25 % Standard 3 (25 %), ab 1,0 % Standard 4 (20 %). Unter 1,0 % Abstand gilt laut deinem Regelwerk „kein Trade“, weil das CRV bei SL −0,5 % unter 2:1 fällt. Läuft die Richtung gegen den 1D-Trend (MTF-Ampel), steht „⚠ gegen 1D“ und es gilt höchstens Standard 4. Rein rechnerischer Vorschlag, kein Handelssignal. Laut deinem Regelwerk gelten deine im Chart gezeichneten Levels; Nexus' automatische Levels sind nur der Abgleich – liegt dein nächstes Level anders, rechne mit deinem.

So entsteht der Wert: Das Level, an dem der Kurs gerade steht (bis ±0,25 %, also dein Retest-Level), wird übersprungen. Keylevels wie in der Kachel „Chart-Struktur“ (Pivot-Konfluenz über mehrere Zeitrahmen, Liquidations-Cluster, Spot-Volumen), berechnet beim Laden der Seite. Der Abstand wird mit dem Live-Preis gerechnet; ein Level zählt als Widerstand, wenn es über dem aktuellen Kurs liegt, und als Unterstützung, wenn es darunter liegt.`;

export const termBasisInfo = `Was es misst: die Prämie des vordersten Deribit-Futures (mindestens 30 Tage Restlaufzeit) gegenüber dem Deribit-Index, auf ein Jahr hochgerechnet. Es ist eine Näherung für die CME-Basis, die es nicht kostenlos über eine offizielle Schnittstelle gibt. Die beiden laufen meist ähnlich, sind aber nicht identisch.

Stufen (pro Jahr):
• unter 0 %: Negativ, Termin unter Spot (Stress)
• 0 bis 5 %: Schwach, Basis-Trades lohnen kaum
• 5 bis 10 %: Normal
• 10 bis 15 %: Erhöht
• ab 15 %: Überhitzt, historisch oft in späten Rally-Phasen

Wie du es nutzt: Hedgefonds kaufen Spot oder ETF-Anteile und verkaufen Futures, um diese Prämie risikoarm zu kassieren (Basis-Trade). Fällt die Basis deutlich, lösen sie den Trade auf. Dann entstehen ETF-Abflüsse ohne bärische Meinung. Fallen Basis und ETF-Flows gemeinsam, erscheint ein Hinweis. Kontext für Tage bis Wochen, kein Timing-Signal und nicht im Backtest geprüft; fliesst nicht in die Gesamteinschätzung ein.

Quelle: Deribit, stündlich (collect-term-basis). Ältere Tageswerte nachgeladen, dort dient BTC-PERPETUAL als Index-Näherung.`;
