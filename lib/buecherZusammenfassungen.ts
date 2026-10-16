// Ausführliche Lese-Zusammenfassungen je Buch (Tab "Bücher" → "Zusammenfassung").
//
// Wie lib/buecherContent.ts: Kernideen in eigenen Worten aus Claudes Wissen,
// NICHT aus dem Buchtext gelesen. Keine Zitate, keine Kapitelnachbildung.
// Abschnitte "So wendest du es an" übertragen die Ideen ausdrücklich auf
// BTC-Trading und Nexus-Atlas – das steht so nicht in den Büchern.

export type Abschnitt = {
  titel: string;
  text?: string[];
  punkte?: string[];
};

export const ZUSAMMENFASSUNGEN: Record<string, Abschnitt[]> = {
  // ---------------------------------------------------------------- Harris
  harris: [
    {
      titel: "Worum es geht",
      text: [
        "Harris schreibt über die Mechanik von Märkten: Wer handelt, warum, mit welchen Orders, und wie daraus Preise, Spreads und Volatilität entstehen. Das Buch ist kein Strategie-Ratgeber, sondern eine Landkarte des Marktes. Wer es verstanden hat, sieht hinter jeder Kerze Menschen und Algorithmen mit unterschiedlichen Zielen.",
        "Der rote Faden: Ein Markt ist ein Ort, an dem Händler Liquidität anbieten und andere sie nachfragen. Wer sofort handeln will, zahlt dafür. Wer Geduld hat, verdient daran – trägt aber das Risiko, von besser Informierten überrollt zu werden.",
      ],
    },
    {
      titel: "Die Marktteilnehmer",
      text: [
        "Harris unterscheidet zwei grosse Gruppen. Nutzenorientierte Trader handeln, weil der Handel selbst ihnen einen Vorteil bringt, der nichts mit Trading-Gewinn zu tun hat: Investoren verschieben Konsum in die Zukunft, Absicherer reduzieren Risiko, Kreditnehmer finanzieren sich, Spieler suchen Unterhaltung. Sie sind bereit, für diesen Nutzen etwas zu bezahlen.",
        "Gewinnorientierte Trader handeln nur, weil sie Gewinn erwarten. Dazu gehören informierte Trader, die mehr über den Wert wissen als der Preis zeigt; Value-Trader, die Abweichungen vom fairen Wert ausnutzen; Trader, die die Orders anderer vorhersehen (Front-Runner, Stop-Jäger, Sentiment-Trader); Arbitrageure, die Preisunterschiede zwischen Märkten schliessen; und Händler, die Liquidität verkaufen.",
        "Daraus folgt die vielleicht wichtigste Einsicht des Buchs: Gemessen am Markt ist Trading ein Nullsummenspiel. Gewinne der einen sind Verluste der anderen. Wer als gewinnorientierter Trader dauerhaft verdienen will, braucht eine klare Antwort darauf, wer auf der anderen Seite verliert – und warum diese Person bereit ist, das zu tun.",
      ],
    },
    {
      titel: "Orders, Orderbuch und Börsenregeln",
      text: [
        "Market-Orders kaufen Sofortigkeit: Sie werden sofort zum besten verfügbaren Preis ausgeführt und zahlen dafür den Spread. Limit-Orders bieten Sofortigkeit an: Sie warten zu einem festen Preis und verdienen den Spread, wenn sie ausgeführt werden.",
        "Eine Limit-Order ist dabei wie eine kostenlose Option für den Rest des Marktes. Die anderen entscheiden, ob und wann sie ausführen. Gefüllt wird eine Kauf-Limit-Order besonders gern dann, wenn der Preis gleich noch weiter fällt. Dieses Risiko nennt man auch Adverse Selection beim Limit-Trader.",
        "Orderbücher folgen Prioritätsregeln, meist erst Preis, dann Zeit. Wer vorne in der Schlange stehen will, muss früh oder zu einem besseren Preis kommen. Viele Details der Marktstruktur – Tick-Grösse, Sichtbarkeit von Orders, versteckte Orders – entscheiden darüber, wer im Vorteil ist.",
      ],
    },
    {
      titel: "Liquidität und Market Maker",
      text: [
        "Liquidität hat mehrere Dimensionen: Sofortigkeit, Breite (Spread), Tiefe (wie viel Volumen nah am Preis liegt) und Erholung (wie schnell sich der Preis nach einer grossen Order wieder einpendelt). Ein enger Spread allein sagt wenig, wenn dahinter kaum Volumen liegt.",
        "Market Maker stellen fortlaufend Kauf- und Verkaufskurse. Sie verdienen am Spread, tragen aber zwei Risiken: das Lagerrisiko (sie halten Positionen, die sie nicht wollen) und die Adverse Selection (informierte Trader handeln genau dann mit ihnen, wenn sich der Preis gleich bewegt). Der Spread muss beides bezahlen. Darum werden Spreads breiter, wenn mehr Informierte im Markt sind, etwa vor Nachrichten.",
      ],
    },
    {
      titel: "Information, Volatilität und Manipulation",
      text: [
        "Harris trennt fundamentale Volatilität, die aus neuer Information über den Wert entsteht, von vorübergehender Volatilität, die aus Orderdruck entsteht und sich wieder auflöst. Grosse Orders verschieben den Preis kurzfristig; danach kehrt er zurück. Für Händler mit Geduld ist genau das die Gelegenheit, Liquidität teuer zu verkaufen.",
        "Weil grosse Trader wissen, dass andere ihre Orders vorwegnehmen wollen, teilen sie Orders auf und verstecken ihre Absicht. Umgekehrt versuchen Bluffer und Manipulatoren, andere zu falschen Schlüssen über Angebot und Nachfrage zu verleiten. Ein Teil der Marktregeln existiert nur, um das einzudämmen.",
      ],
    },
    {
      titel: "Was du mitnehmen solltest",
      punkte: [
        "Frage bei jedem Setup: Wer ist auf der anderen Seite, und warum verliert gerade diese Person?",
        "Market-Order = Sofortigkeit kaufen, Limit-Order = Sofortigkeit verkaufen und Risiko tragen.",
        "Spreads bezahlen Market Maker für Lagerrisiko und Verluste an Informierte.",
        "Nicht jede Bewegung ist Information; viel davon ist Orderdruck, der wieder verschwindet.",
      ],
    },
    {
      titel: "So wendest du es an (Übertragung auf BTC)",
      text: [
        "Bei BTC-Perpetuals treffen Hedger (Miner, Basis-Trader), gehebelte Spieler, Market Maker und informierte Trader aufeinander. Liquidationen sind ein Sonderfall: erzwungene Market-Orders von Tradern, die gar nicht handeln wollten. Sie erzeugen vorübergehende Volatilität – Stop-Runs und Liquidations-Kaskaden, nach denen der Preis oft zurückkommt.",
        "Unsere Backtests haben genau diese Rückkehr (Sweep-Umkehr) gemessen: Vor Kosten gab es kaum einen Vorteil. Harris erklärt warum: Wer an solchen Stellen Liquidität anbietet, konkurriert mit professionellen Market Makern, die das billiger und schneller können.",
      ],
    },
    {
      titel: "Grenzen",
      text: [
        "Das Buch stammt von 2003 und beschreibt vor allem Aktien- und Terminmärkte vor dem Siegeszug des Hochfrequenzhandels. Die Prinzipien gelten weiter, die konkreten Börsenregeln und Gebührenmodelle haben sich geändert, und Kryptomärkte kommen nicht vor.",
      ],
    },
  ],

  // ------------------------------------------------------------------ Hull
  hull: [
    {
      titel: "Worum es geht",
      text: [
        "Hulls Lehrbuch ist der Standard für Derivate an Hochschulen und in Banken. Es erklärt, wie Futures, Forwards, Swaps und Optionen funktionieren, wie man ihren fairen Preis herleitet und wie man mit ihnen Risiken absichert oder eingeht. Für dich sind vor allem die Kapitel zu Futures, Margin, Basis und den Grundlagen der Optionen wichtig.",
      ],
    },
    {
      titel: "Futures und Margin",
      text: [
        "Ein Future ist ein standardisierter Vertrag, einen Basiswert zu einem festgelegten Preis an einem späteren Termin zu kaufen oder zu verkaufen. Gehandelt wird an einer Börse, die als Gegenpartei für alle auftritt und so das Ausfallrisiko übernimmt.",
        "Dafür verlangt die Börse eine Sicherheit, die Initial Margin. Gewinne und Verluste werden täglich abgerechnet (Mark-to-Market). Fällt das Margin-Konto unter die Maintenance Margin, muss nachgeschossen werden, sonst wird die Position geschlossen. Der Hebel entsteht, weil nur ein Bruchteil des Kontraktwerts hinterlegt wird, Gewinn und Verlust sich aber auf den vollen Wert beziehen.",
      ],
    },
    {
      titel: "Wie Futures bewertet werden",
      text: [
        "Der faire Futurepreis folgt aus einem Arbitrage-Argument. Ohne Erträge oder Lagerkosten gilt vereinfacht: Futurepreis = Spotpreis × e^(r·T), also Spot plus Finanzierungskosten bis zum Verfall. Liegt der Future darüber, kauft man Spot auf Kredit und verkauft den Future (Cash-and-Carry) – risikoloser Gewinn, bis der Abstand verschwindet.",
        "Die Differenz zwischen Future und Spot heisst Basis. Zum Verfall läuft sie gegen null, weil der Future dann dem Spot entsprechen muss. Bei Rohstoffen kommen Lagerkosten und der Nutzen des physischen Besitzes dazu, bei Aktienindizes die Dividenden.",
      ],
    },
    {
      titel: "Absicherung",
      text: [
        "Mit Futures lässt sich ein bestehendes Preisrisiko absichern: Wer den Basiswert hält, verkauft Futures. Perfekt ist das selten. Weil Future und abgesicherte Position nicht exakt gleich schwanken und die Basis sich bewegt, bleibt ein Basisrisiko. Hull zeigt, wie man die varianzminimierende Hedge-Ratio aus Korrelation und Volatilitäten berechnet.",
      ],
    },
    {
      titel: "Optionen",
      text: [
        "Ein Call gibt das Recht, zum Strike zu kaufen, ein Put das Recht, zum Strike zu verkaufen. Der Käufer zahlt eine Prämie und riskiert höchstens diese; der Verkäufer kassiert die Prämie und trägt das grosse Risiko.",
        "Der Optionspreis besteht aus innerem Wert und Zeitwert. Die Put-Call-Parität verbindet Calls, Puts, Basiswert und abgezinsten Strike zu einer festen Beziehung; weicht der Markt davon ab, gibt es Arbitrage.",
        "Das Black-Scholes-Modell bewertet Optionen aus fünf Grössen: Spot, Strike, Laufzeit, Zins und Volatilität. Nur die Volatilität ist nicht direkt beobachtbar. Rechnet man sie aus dem Marktpreis zurück, erhält man die implizite Volatilität – die Erwartung des Marktes. Die Greeks (Delta, Gamma, Vega, Theta) messen, wie empfindlich der Optionswert auf diese Grössen reagiert.",
      ],
    },
    {
      titel: "Was du mitnehmen solltest",
      punkte: [
        "Hebel heisst: kleine Bewegung im Basiswert, grosse Bewegung im Konto – in beide Richtungen.",
        "Die Basis ist der Preis für Finanzierung und läuft beim klassischen Future zum Verfall gegen null.",
        "Ein Hedge tauscht Preisrisiko gegen Basisrisiko.",
        "Optionen handeln heisst Volatilität handeln.",
      ],
    },
    {
      titel: "So wendest du es an (Perpetuals – nicht in Hull)",
      text: [
        "Perpetual Futures haben keinen Verfall. Die Konvergenz, die klassische Futures an den Spot bindet, fehlt. Funding übernimmt diese Aufgabe: Liegt der Perp über Spot, zahlen Longs regelmässig an Shorts, und umgekehrt. Funding ist damit Hulls Cost of Carry in Raten – und zugleich ein Mass dafür, wie gedrängt eine Seite ist.",
        "Liquidation statt Margin Call: Bei 10× Hebel reicht eine Bewegung von grob 9–10 % gegen dich bis zur Liquidation, je nach Maintenance Margin der Börse. In Nexus zeigen Funding, Basis und CME-Basis, wie viel Hebel im Markt ist.",
      ],
    },
    {
      titel: "Grenzen",
      text: [
        "Das Buch ist mathematisch und umfangreich. Für Trading reichen die ersten Kapitel zu Futures und die Optionsgrundlagen; Zinsderivate und Kreditrisiko kannst du überspringen.",
      ],
    },
  ],

  // ---------------------------------------------------------------- Murphy
  murphy: [
    {
      titel: "Worum es geht",
      text: [
        "Murphy liefert das Standard-Nachschlagewerk der technischen Analyse: Trends, Unterstützung und Widerstand, Formationen, gleitende Durchschnitte, Oszillatoren, Volumen, Zeitebenen und Zusammenhänge zwischen Märkten. Wer das Buch kennt, versteht das Vokabular, mit dem die meisten Trader über Charts sprechen.",
      ],
    },
    {
      titel: "Grundannahmen und Dow-Theorie",
      text: [
        "Die technische Analyse ruht auf drei Annahmen: Der Preis spiegelt alle verfügbaren Informationen, Preise bewegen sich in Trends, und Verhaltensmuster wiederholen sich.",
        "Aus der Dow-Theorie stammt die Unterscheidung von Primär-, Sekundär- und kleinen Trends, die Idee von Trendphasen (Akkumulation, breite Beteiligung, Distribution) und die Regel, dass ein Trend gilt, bis ein klares Umkehrsignal vorliegt. Ein Aufwärtstrend ist eine Folge höherer Hochs und höherer Tiefs; Volumen soll den Trend bestätigen.",
      ],
    },
    {
      titel: "Unterstützung, Widerstand, Trendlinien",
      text: [
        "Unterstützung ist ein Bereich, in dem Kaufinteresse den Fall stoppt; Widerstand stoppt Anstiege. Wird eine Marke durchbrochen, tauscht sie oft die Rolle: Alter Widerstand wird Unterstützung. Bedeutsam ist eine Marke umso mehr, je öfter sie gehalten hat, je länger sie zurückliegt und je mehr Volumen dort gehandelt wurde.",
        "Trendlinien verbinden Tiefs im Aufwärtstrend bzw. Hochs im Abwärtstrend; Kanäle ergänzen eine Parallele. Ihr Bruch gilt als frühes Warnsignal, nicht als Beweis.",
      ],
    },
    {
      titel: "Formationen",
      text: [
        "Umkehrformationen wie Kopf-Schulter oder Doppel-Hoch kündigen einen Trendwechsel an, Fortsetzungsformationen wie Dreiecke, Flaggen und Wimpel eine Pause im Trend. Viele Formationen haben ein Kursziel, das sich aus ihrer Höhe ergibt. Fertig ist eine Formation erst mit dem Ausbruch, der idealerweise von steigendem Volumen begleitet wird.",
      ],
    },
    {
      titel: "Indikatoren",
      text: [
        "Gleitende Durchschnitte glätten den Preis und zeigen den Trend, aber mit Verzögerung. Kreuzungen zweier Durchschnitte sind beliebte Signale; in Seitwärtsphasen liefern sie jedoch viele Fehlsignale.",
        "Oszillatoren wie RSI, Stochastik und MACD messen Momentum. Sie zeigen überkaufte und überverkaufte Zustände und Divergenzen zwischen Preis und Momentum. Murphy betont, dass sie in Seitwärtsmärkten am besten funktionieren; in starken Trends bleiben sie lange im Extrembereich, und Gegensignale sind gefährlich.",
        "Weitere Kapitel behandeln Volumen und Open Interest, mehrere Zeitebenen (den höheren Zeitrahmen zuerst lesen) und Zusammenhänge zwischen Anleihen, Rohstoffen, Aktien und Währungen.",
      ],
    },
    {
      titel: "Was du mitnehmen solltest",
      punkte: [
        "Die Sprache der Chartanalyse: Trend, Unterstützung, Widerstand, Rollentausch, Formation, Divergenz.",
        "Den höheren Zeitrahmen zuerst lesen, dann den niedrigeren.",
        "Trendfolge-Werkzeuge für Trends, Oszillatoren für Seitwärtsmärkte.",
        "Volumen als Bestätigung, nicht als Signal allein.",
      ],
    },
    {
      titel: "So wendest du es an",
      text: [
        "Nutze Murphy als Wörterbuch: Es hilft zu verstehen, was andere Trader im Chart sehen und wo ihre Orders liegen könnten. Jede Regel, die du daraus ableitest, ist eine Hypothese. In unseren Backtests hat zum Beispiel der RSI/MACD-Filter das Ergebnis verschlechtert, und die Breakout-Retest-Idee (Rollentausch) ist noch ungetestet.",
      ],
    },
    {
      titel: "Grenzen",
      text: [
        "Das Buch beschreibt Werkzeuge, liefert aber kaum Belege, dass sie nach Kosten Geld verdienen. Viele Muster sind im Nachhinein offensichtlich und vorher schwer eindeutig zu definieren. Lies es zusammen mit einem Buch über Backtesting (Chan oder Carver).",
      ],
    },
  ],

  // ------------------------------------------------------------ Quantopian
  quantopian: [
    {
      titel: "Worum es geht",
      text: [
        "Die Quantopian Lecture Series ist ein kostenloser Kurs aus Jupyter-Notebooks, den die Plattform Quantopian bis 2020 veröffentlichte. Er führt in Python, Statistik und quantitative Finanzmethoden ein. Eine auf Python 3 aktualisierte Fassung pflegt heute QuantRocket.",
        "Der Kurs ist in drei Teile gegliedert: Werkzeuge (Python, NumPy, pandas, Plotten), Statistik (Mittelwerte, Varianz, Verteilungen, Tests, Regression) und Finanzthemen (Backtesting, Faktoren, Portfolios, Risiko).",
      ],
    },
    {
      titel: "Statistik-Grundlagen",
      text: [
        "Statistische Analysen arbeiten mit Renditen, nicht mit Preisen, weil Preise kein festes Niveau haben. Mittelwert und Standardabweichung beschreiben Ertrag und Schwankung, höhere Momente die Form der Verteilung.",
        "Finanzrenditen sind nicht normalverteilt: Extreme Bewegungen kommen häufiger vor, als die Normalverteilung erwarten lässt (fette Ränder). Wer Risiko mit der Normalverteilung schätzt, unterschätzt Crashs.",
      ],
    },
    {
      titel: "Testen, ohne sich selbst zu täuschen",
      text: [
        "Ein Hypothesentest fragt, wie wahrscheinlich ein Ergebnis wäre, wenn es in Wahrheit keinen Effekt gibt. Der p-Wert ist diese Wahrscheinlichkeit, nicht die Wahrscheinlichkeit, dass deine Idee stimmt.",
        "Das grösste Problem ist das Mehrfachtesten: Wer viele Varianten probiert, findet zufällig scheinbar signifikante Ergebnisse. Gegenmittel sind vorab festgelegte Hypothesen, Korrekturen für die Anzahl der Tests und Prüfung auf neuen Daten.",
        "Regression misst Zusammenhänge, beweist aber keine Ursache. Trendende Reihen erzeugen leicht Scheinkorrelationen; Autokorrelation und fehlende Stationarität verfälschen Standardtests.",
      ],
    },
    {
      titel: "Backtesting und Portfolio",
      text: [
        "Die Finanz-Lektionen zeigen typische Backtest-Fehler: Look-Ahead-Bias, Survivorship-Bias, Überanpassung und vergessene Kosten. Weitere Lektionen behandeln Faktormodelle, Beta-Absicherung, Long-Short-Portfolios, Positionskonzentration und Transaktionskosten.",
        "Ein wiederkehrendes Thema: Risiko entsteht im Zusammenspiel der Positionen. Diversifikation über unkorrelierte Quellen reduziert Schwankung, ohne den erwarteten Ertrag gleich stark zu senken.",
      ],
    },
    {
      titel: "Was du mitnehmen solltest",
      punkte: [
        "Mit Renditen rechnen und mit Extremen rechnen.",
        "Je mehr du testest, desto weniger bedeutet ein einzelner Treffer.",
        "Korrelation ist keine Kausalität, besonders bei trendenden Reihen.",
        "Kosten, Look-Ahead und Survivorship zuerst prüfen, bevor du einem Backtest glaubst.",
      ],
    },
    {
      titel: "So wendest du es an",
      text: [
        "Die Notebooks sind ideal, um die Methoden in research-python nachzuvollziehen. Arbeite die Statistik-Lektionen durch und prüfe danach einen unserer Backtests selbst: Wie viele Varianten wurden getestet? Wo könnte Look-Ahead stecken? Welche Kosten sind drin?",
      ],
    },
    {
      titel: "Grenzen",
      text: [
        "Der Kurs ist auf US-Aktien ausgerichtet, und einige Beispiele hängen an Datenquellen, die es so nicht mehr gibt. Die Statistik ist aber zeitlos und überträgt sich direkt auf Krypto.",
      ],
    },
  ],

  // ---------------------------------------------------------------- Carver
  carver: [
    {
      titel: "Worum es geht",
      text: [
        "Robert Carver, früher bei einem grossen systematischen Hedgefonds, beschreibt, wie man ein regelbasiertes Handelssystem baut, das realistisch bleibt. Das Buch ist ein Baukasten: Handelsregeln, Prognosen, Kombination, Positionsgrösse, Diversifikation und Kosten.",
      ],
    },
    {
      titel: "Warum systematisch",
      text: [
        "Menschen machen beim Trading vorhersehbare Fehler: Sie lassen Verluste laufen, nehmen Gewinne zu früh, jagen Mustern hinterher und überschätzen sich nach Glückssträhnen. Feste Regeln schützen davor.",
        "Aber Regeln haben ihre eigene Falle: Überanpassung. Wer ein System so lange optimiert, bis der Backtest glänzt, passt es an Zufall an. Carver plädiert deshalb für wenige, einfache, gut begründete Regeln und für bescheidene Erwartungen an die erreichbare Sharpe-Ratio.",
      ],
    },
    {
      titel: "Prognosen und ihre Kombination",
      text: [
        "Jede Handelsregel liefert keine Ja/Nein-Entscheidung, sondern eine Prognose mit Stärke. Carver skaliert sie so, dass der durchschnittliche Betrag bei etwa 10 liegt, und deckelt sie bei ±20. Typische Regeln sind Trendfolge mit gleitenden Durchschnitten unterschiedlicher Geschwindigkeit und Carry, also der Ertrag fürs Halten einer Position.",
        "Mehrere Regeln werden gewichtet zu einer Gesamtprognose kombiniert. Die Gewichte legt man lieber grob und robust fest als fein optimiert. Weil sich unkorrelierte Regeln gegenseitig glätten, ist die Kombination stabiler als jede einzelne.",
      ],
    },
    {
      titel: "Volatilität und Positionsgrösse",
      text: [
        "Zuerst wird ein Risikoziel für das ganze Konto festgelegt, zum Beispiel eine bestimmte erwartete jährliche Schwankung. Daraus und aus der aktuellen Volatilität des Instruments ergibt sich, wie gross eine Position bei durchschnittlicher Prognose sein soll. Die tatsächliche Position skaliert dann mit der Prognosestärke.",
        "Steigt die Volatilität, schrumpft die Position automatisch. Das Risikoziel sollte unter dem liegen, was das Kelly-Kriterium erlauben würde, typischerweise bei höchstens halbem Kelly, weil die Schätzungen unsicher sind.",
      ],
    },
    {
      titel: "Diversifikation und Kosten",
      text: [
        "Diversifikation über mehrere Instrumente und Regeln ist der grösste Vorteil, den man ohne zusätzliches Wissen bekommt. Gleichzeitig begrenzen Kosten, wie oft ein System handeln darf: Schnelle Regeln mit hohen Kosten verlieren ihren Vorteil.",
        "Carver unterscheidet schliesslich Trader-Typen, vom reinen Systemtrader bis zum halbautomatischen Trader, der Signale selbst auswählt, aber die Positionsgrössen-Regeln übernimmt. Seine Warnung: Eingriffe ins System folgen meist genau den Gefühlen, vor denen es schützen soll.",
      ],
    },
    {
      titel: "Was du mitnehmen solltest",
      punkte: [
        "Einfach und robust schlägt komplex und optimiert.",
        "Prognosen mit Stärke statt binärer Signale.",
        "Erst das Risiko festlegen, die Positionsgrösse folgt.",
        "Nicht schneller handeln, als die Kosten erlauben.",
        "Das System im Labor ändern, nicht während des Trades.",
      ],
    },
    {
      titel: "So wendest du es an",
      text: [
        "Der Wechsel von 15m auf 1h im MTF-Backtest hat die Kosten pro R halbiert – genau Carvers Kostenargument. Und statt Confluence als lange UND-Kette (wenige Trades, viel Zufall) lieber einen gewichteten Score nutzen, wie Variante G. Der Positionsgrössen-Rechner im Grundlagen-Tab folgt derselben Logik: Risiko zuerst.",
      ],
    },
    {
      titel: "Grenzen",
      text: [
        "Carver denkt in diversifizierten Futures-Portfolios über viele Märkte. Mit nur BTC fehlt der grösste Hebel, die Diversifikation. Die Prinzipien zu Risiko, Kosten und Einfachheit gelten trotzdem.",
      ],
    },
  ],

  // ------------------------------------------------------------------ Chan
  chan: [
    {
      titel: "Worum es geht",
      text: [
        "Ernest Chan schreibt für Einzelpersonen, die mit begrenzten Mitteln quantitativ handeln wollen. Das Buch führt durch den ganzen Weg: Ideen finden, backtesten, Risiko steuern, ausführen und live betreiben. Es ist praktischer und kürzer als die meisten Lehrbücher.",
      ],
    },
    {
      titel: "Ideen finden und aussortieren",
      text: [
        "Strategie-Ideen gibt es in Büchern, Foren, Blogs und Fachartikeln. Die Kunst liegt im schnellen Aussortieren. Chan prüft zuerst: Sharpe-Ratio, maximaler Drawdown und seine Dauer, Kapazität, Datenverfügbarkeit und ob die Strategie zu deinen Mitteln und deiner Zeit passt.",
        "Misstrauisch werden sollte man bei sehr hohen Renditen mit wenigen Trades, bei Strategien, die nur in einer Marktphase funktionierten, und bei allem, was ohne Kosten gerechnet wurde.",
      ],
    },
    {
      titel: "Backtesting",
      text: [
        "Chan listet die klassischen Fehler: Look-Ahead-Bias, Data-Snooping durch zu viele Parameter, Survivorship-Bias, fehlerhafte oder unbereinigte Daten und fehlende Transaktionskosten. Seine Gegenmittel: wenige Parameter, Out-of-Sample-Tests, Sensitivitätsanalyse (funktioniert die Strategie auch mit leicht anderen Parametern?) und Paper Trading vor dem Live-Gang.",
      ],
    },
    {
      titel: "Strategietypen",
      text: [
        "Die zwei Grundtypen sind Mean Reversion (Preise kehren zurück) und Momentum (Bewegungen setzen sich fort). Beide können im selben Markt auf unterschiedlichen Zeitskalen auftreten. Pairs Trading nutzt Mean Reversion zwischen zwei verwandten Werten; entscheidend ist Kointegration, nicht blosse Korrelation.",
        "Chan weist auch auf Regimewechsel hin: Eine Strategie kann jahrelang funktionieren und dann aufhören, weil sich die Marktstruktur ändert.",
      ],
    },
    {
      titel: "Risiko und Kelly",
      text: [
        "Für die Positionsgrösse stellt Chan das Kelly-Kriterium vor: Der wachstumsoptimale Hebel entspricht ungefähr der mittleren Überrendite geteilt durch die Varianz der Renditen. Weil diese Schätzungen unsicher sind, empfiehlt er halbes Kelly oder weniger. Jenseits des Kelly-Optimums sinkt das langfristige Wachstum, während das Ruinrisiko steigt.",
        "Der Hebel sollte regelmässig an das aktuelle Kapital angepasst werden: nach Verlusten kleiner, nach Gewinnen grösser.",
      ],
    },
    {
      titel: "Live gehen",
      text: [
        "Ausführung möglichst automatisieren, Live-Ergebnisse laufend mit dem Backtest vergleichen und auf Drawdowns psychologisch vorbereitet sein. Grosse Abweichungen zwischen Live und Backtest sind ein Hinweis auf Datenfehler, unterschätzte Kosten oder einen Regimewechsel.",
      ],
    },
    {
      titel: "Was du mitnehmen solltest",
      punkte: [
        "Die meisten Ideen sind schlecht – billig aussortieren ist eine Kernkompetenz.",
        "Weniger Parameter, mehr Out-of-Sample.",
        "Kläre, ob du auf Rückkehr oder Fortsetzung wettest.",
        "Kelly ist eine Obergrenze, keine Empfehlung.",
      ],
    },
    {
      titel: "So wendest du es an",
      text: [
        "Die Gemini-Variante im MTF-Backtest mit 17 Trades in knapp 7 Jahren ist ein Lehrbuchfall für Chans Warnung vor wenigen Trades. Sweep-Umkehr ist Mean Reversion, Breakout + Retest Momentum – beide auf dieselbe Preisaktion, beide müssen separat getestet werden.",
      ],
    },
    {
      titel: "Grenzen",
      text: [
        "Die erste Auflage nutzt MATLAB und Excel und ist auf Aktien ausgerichtet. Die zweite Auflage (2021) ist aktueller. Die Methodik ist auf Krypto übertragbar, die Beispiele nicht direkt.",
      ],
    },
  ],

  // ----------------------------------------------------------- López de Prado
  lopez: [
    {
      titel: "Worum es geht",
      text: [
        "Marcos López de Prado beschreibt, warum die meisten Machine-Learning-Ansätze in der Finanzwelt scheitern, und liefert Methoden dagegen. Der Kern: Finanzdaten verletzen die Annahmen klassischer ML-Verfahren (unabhängige, gleich verteilte Beobachtungen). Wer das ignoriert, baut Modelle, die im Backtest glänzen und live versagen.",
        "Das Buch ist anspruchsvoll und setzt Python, Statistik und ML-Grundlagen voraus. Nexus-Atlas nutzt bereits mehrere seiner Methoden.",
      ],
    },
    {
      titel: "Daten richtig aufbereiten",
      text: [
        "Zeitkerzen sammeln gleich viel Zeit, aber sehr unterschiedlich viel Handel. López de Prado schlägt Volumen- und Dollar-Bars vor, die schliessen, wenn eine feste Menge gehandelt wurde, sowie informationsgetriebene Bars, die schliessen, wenn das Orderflow-Ungleichgewicht ungewöhnlich wird. Ihre Renditen sind statistisch gutmütiger.",
        "Fraktionelles Differenzieren macht eine Preisreihe stationär, ohne ihr Gedächtnis ganz zu löschen – ein Mittelweg zwischen Preis (Gedächtnis, nicht stationär) und Rendite (stationär, ohne Gedächtnis).",
      ],
    },
    {
      titel: "Labeling und Gewichtung",
      text: [
        "Die Triple-Barrier-Methode markiert jedes Signal danach, welche von drei Schranken zuerst erreicht wird: Take-Profit, Stop-Loss oder Zeitlimit. So entsprechen die Labels echten Trades. Meta-Labeling trennt Richtung und Einsatz: Ein Grundmodell bestimmt die Richtung, ein zweites Modell entscheidet, ob und wie gross gehandelt wird.",
        "Überlappen Trades zeitlich, sind die Beobachtungen nicht unabhängig. Gewichte nach Einzigartigkeit und der Sequential Bootstrap verhindern, dass man die Stichprobe für grösser hält, als sie ist.",
      ],
    },
    {
      titel: "Kreuzvalidierung und Feature-Wichtigkeit",
      text: [
        "Normale k-fache Kreuzvalidierung lässt Information durchsickern, weil Labels über die Grenze zwischen Training und Test reichen. Purging entfernt solche Beobachtungen aus dem Training, ein Embargo lässt zusätzlich eine Lücke nach dem Testzeitraum. Combinatorial Purged Cross-Validation erzeugt viele Testpfade statt nur einen.",
        "Statt Backtests als Forschungswerkzeug zu missbrauchen, soll man mit Feature-Wichtigkeit (MDI, MDA, SFI) verstehen, welche Merkmale überhaupt Information tragen.",
      ],
    },
    {
      titel: "Backtest-Überanpassung",
      text: [
        "Je mehr Varianten man testet, desto höher fällt die beste Sharpe-Ratio rein zufällig aus. Der Deflated Sharpe Ratio korrigiert dafür. Die Probability of Backtest Overfitting (PBO) schätzt, wie oft die im Test beste Variante ausserhalb davon unterdurchschnittlich abschneidet. Die Botschaft: Zähle deine Versuche, sie gehören zum Ergebnis.",
      ],
    },
    {
      titel: "Was du mitnehmen solltest",
      punkte: [
        "Finanzdaten sind nicht unabhängig – klassische ML-Rezepte brauchen Anpassung.",
        "Signale so bewerten, wie man sie handeln würde: mit Stop, Ziel und Zeit.",
        "Zwischen Training und Test muss eine echte Wand stehen (Purging, Embargo).",
        "Die Anzahl der Versuche gehört zur Bewertung jedes Backtests.",
      ],
    },
    {
      titel: "So wendest du es an",
      text: [
        "In research-python findest du PurgedWalkForwardCV, Combinatorial Purged CV und PBO (src/validation/walk_forward.py) sowie die Triple-Barrier-Auswertung des RSI-Reversal-Tests in docs/research. Lies die passenden Kapitel und vergleiche sie mit dem Code.",
      ],
    },
    {
      titel: "Grenzen",
      text: [
        "Das Buch ist dicht und teils schwer zugänglich; einige Methoden sind in der Fachwelt umstritten oder aufwendig umzusetzen. Für den Einstieg erst Chan und Carver lesen.",
      ],
    },
  ],

  // ---------------------------------------------------------------- Douglas
  douglas: [
    {
      titel: "Worum es geht",
      text: [
        "Mark Douglas argumentiert, dass die meisten Trader nicht an fehlendem Wissen scheitern, sondern an ihrer Denkweise. Sie kennen ihre Setups, handeln sie aber nicht konsequent, weil Angst, Hoffnung und das Bedürfnis, recht zu haben, dazwischenfunken. Das Buch will diese Denkweise durch Denken in Wahrscheinlichkeiten ersetzen.",
      ],
    },
    {
      titel: "Warum gute Analyse nicht reicht",
      text: [
        "Douglas beschreibt typische Ängste: falsch zu liegen, Geld zu verlieren, eine Gelegenheit zu verpassen und Gewinn liegen zu lassen. Diese Ängste verzerren die Wahrnehmung. Man sieht im Chart, was man fürchtet oder hofft, steigt zu spät ein, verschiebt den Stop oder nimmt Gewinne zu früh.",
        "Der Markt selbst ist neutral. Er erzeugt nur Information; was sie bedeutet, entscheidet der Trader. Wer jeden Trade persönlich nimmt, wird von jeder Bewegung emotional getroffen.",
      ],
    },
    {
      titel: "Die fünf Grundwahrheiten",
      punkte: [
        "Alles kann passieren.",
        "Du musst nicht wissen, was als Nächstes passiert, um Geld zu verdienen.",
        "Gewinne und Verluste sind bei einem Vorteil zufällig verteilt.",
        "Ein Vorteil ist nur eine höhere Wahrscheinlichkeit für ein Ergebnis.",
        "Jeder Moment im Markt ist einzigartig.",
      ],
      text: [
        "Wer diese Sätze wirklich glaubt, hört auf, den einzelnen Trade vorhersagen zu wollen. Ein Verlust widerlegt das System nicht, ein Gewinn bestätigt es nicht. Erst die Serie zählt.",
      ],
    },
    {
      titel: "Wie ein Casino denken",
      text: [
        "Ein Casino weiss nie, wer am nächsten Tisch gewinnt, aber es weiss, dass es über viele Spiele vorn liegt. Genau so soll ein Trader denken: Der Vorteil zeigt sich nur über eine Stichprobe, Verluste sind Betriebskosten.",
        "Dazu gehört, das Risiko vor dem Trade vollständig zu akzeptieren: festlegen, wo man falsch liegt und wie viel das kostet, und diesen Betrag innerlich abhaken. Wer das getan hat, muss den Stop nicht mehr verschieben.",
      ],
    },
    {
      titel: "Konsequenz trainieren",
      text: [
        "Douglas schlägt eine Übung vor: eine feste Stichprobe von 20 Trades nach exakt denselben, schriftlich festgelegten Regeln, mit fester Positionsgrösse und ohne Eingriffe. Erst danach wird ausgewertet. Die Übung trainiert nicht das Setup, sondern die Fähigkeit, es konsequent umzusetzen.",
      ],
    },
    {
      titel: "Was du mitnehmen solltest",
      punkte: [
        "In Serien denken, nicht in Einzeltrades.",
        "Risiko vor dem Trade akzeptieren, nicht danach verdrängen.",
        "Ein Vorteil ist eine Wahrscheinlichkeit, keine Gewissheit.",
        "Regeln konsequent umsetzen ist eine eigene Fähigkeit, die man üben muss.",
      ],
    },
    {
      titel: "So wendest du es an",
      text: [
        "Douglas setzt voraus, dass du einen Vorteil hast. Unsere Backtests zeigen, wie schwer es ist, einen nachzuweisen. Deshalb: zuerst den Vorteil im Backtest finden, dann mit Douglas lernen, ihn konsequent umzusetzen. Im Journal Stop und Risiko in R vor jedem Trade eintragen und die 20-Trades-Übung im Paper Trading machen.",
      ],
    },
    {
      titel: "Grenzen",
      text: [
        "Das Buch ist sehr wiederholend und liefert keine Belege im wissenschaftlichen Sinn. Gefährlich wird es, wenn man es als Erlaubnis liest, ein System ohne nachgewiesenen Vorteil einfach „mit der richtigen Einstellung“ zu handeln.",
      ],
    },
  ],

  // ------------------------------------------------------------ Steenbarger
  steenbarger: [
    {
      titel: "Worum es geht",
      text: [
        "Brett Steenbarger ist Psychologe und hat lange mit professionellen Tradern gearbeitet. Seine Bücher – unter anderem The Psychology of Trading, Enhancing Trader Performance und The Daily Trading Coach – übertragen Methoden aus Leistungs- und Kurzzeittherapie auf das Trading. Die Grundidee: Trading ist eine Leistung, die man wie Sport oder Musik trainieren kann.",
      ],
    },
    {
      titel: "Trader als Performer",
      text: [
        "Können entsteht durch gezieltes Üben: eine bestimmte Fähigkeit isolieren, wiederholen und das Ergebnis messen. Stundenlanges Zuschauen am Bildschirm ist kein Üben, weil Ziel und Feedback fehlen.",
        "Steenbarger betont, dass Trader unterschiedlich sind. Es gibt nicht die eine richtige Art zu traden; der eigene Stil sollte zu Persönlichkeit, Stärken und Lebenssituation passen.",
      ],
    },
    {
      titel: "Auf Stärken aufbauen",
      text: [
        "Statt nur Fehler zu analysieren, fragt Steenbarger: Was tust du anders, wenn du gut tradest? Diese Muster werden bewusst gemacht und häufiger wiederholt. Dieser lösungsorientierte Ansatz stammt aus der Kurzzeittherapie und ist oft wirksamer als das ständige Bekämpfen von Schwächen.",
      ],
    },
    {
      titel: "Gefühle und Zustände",
      text: [
        "Gefühle sind nicht nur Störung, sondern auch Information. Unruhe kann darauf hinweisen, dass der Markt anders läuft als geplant. Entscheidend ist, das Gefühl zu bemerken, bevor es zur Handlung wird – etwa mit kurzen Pausen, Atemübungen oder einem Blick auf die eigenen Notizen.",
        "Der eigene Zustand – Müdigkeit, Stress, Ärger nach einem Verlust – verändert, wie man den Markt wahrnimmt. Wer seine Zustände kennt, kann Regeln dafür aufstellen, zum Beispiel nach zwei Verlusten in Folge eine Pause.",
      ],
    },
    {
      titel: "Selbst-Coaching",
      text: [
        "Das Journal ist das wichtigste Werkzeug. Es hält nicht nur Trades fest, sondern auch Zustände, Entscheidungen und Lehren. Regelmässig ausgewertet, wird es zur Grundlage für konkrete Ziele der nächsten Woche.",
        "Steenbarger empfiehlt Prozessziele statt Ergebnisziele: nicht „500 Franken Gewinn“, sondern „alle Trades nach Plan“. Das Ergebnis eines Tages ist stark zufällig, den Prozess hat man in der Hand.",
      ],
    },
    {
      titel: "Was du mitnehmen solltest",
      punkte: [
        "Übung braucht ein Ziel und Feedback.",
        "Finde heraus, was du an guten Tagen tust, und mach mehr davon.",
        "Bemerke das Gefühl, bevor es den Klick macht.",
        "Bewerte Tage am Prozess, nicht nur am Ergebnis.",
      ],
    },
    {
      titel: "So wendest du es an",
      text: [
        "Die Checklisten im Wissen-Tab (Welz, Salomon, Mein System) sind solche Routinen. Ergänze sie im Journal um zwei Fragen pro Tag: Habe ich meinen Plan befolgt? Was habe ich an meinem besten Trade anders gemacht?",
      ],
    },
    {
      titel: "Grenzen",
      text: [
        "Die Bücher richten sich oft an professionelle Daytrader mit nachgewiesenem Vorteil. Psychologie kann einen vorhandenen Vorteil besser umsetzen, aber keinen fehlenden ersetzen.",
      ],
    },
  ],
};
