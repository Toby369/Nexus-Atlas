// Inhalte des Bücher-Lernpfads (Tab "Bücher" auf /lernen).
//
// Wichtig: Das sind Zusammenfassungen der Kernideen in eigenen Worten aus
// Claudes Wissen, NICHT aus dem Buchtext gelesen (die Bücher sind
// urheberrechtlich geschützt und lagen nicht vor). Einzelheiten, Formeln und
// Kapitelzuordnungen im Original prüfen. Bezüge zu Nexus-Atlas und zu Kryptos
// (z.B. Perpetuals) sind ausdrücklich als Übertragung markiert.

export type Frage = {
  text: string;
  optionen: string[];
  richtig: number; // Index in `optionen`
  erklaerung: string;
};

export type Lektion = {
  titel: string;
  kern: string[];
  merksatz: string;
  bezug?: string; // Übertragung auf BTC-Trading / Nexus-Atlas
  frage: Frage;
};

export type Buch = {
  id: string;
  titel: string;
  autor: string;
  jahr: string;
  gruppe: "Marktmechanik & Derivate" | "Systematisches Trading" | "Risiko & Psychologie";
  niveau: "Einstieg" | "Mittel" | "Fortgeschritten";
  warum: string;
  lektionen: Lektion[];
};

export const BUECHER: Buch[] = [
  // ---------------------------------------------------------------- Harris
  {
    id: "harris",
    titel: "Trading and Exchanges",
    autor: "Larry Harris",
    jahr: "2003",
    gruppe: "Marktmechanik & Derivate",
    niveau: "Mittel",
    warum:
      "Erklärt, wer an der Börse warum handelt und wie Orderbuch, Liquidität und Market Maker funktionieren. Die Grundlage, um Fragen wie „wer macht den Retest?“ zu beantworten.",
    lektionen: [
      {
        titel: "Wer handelt warum?",
        kern: [
          "Harris teilt Marktteilnehmer nach ihrem Motiv ein. Nutzenorientierte Trader handeln, weil der Handel selbst ihnen etwas bringt: Investoren, Absicherer (Hedger), Kreditnehmer, Spieler.",
          "Gewinnorientierte Trader handeln nur, weil sie Gewinn erwarten: informierte Trader, Value-Trader, Trader, die die Orders anderer vorwegnehmen, und Händler (Dealer), die Liquidität verkaufen.",
          "Handel ist gemessen am Markt ein Nullsummenspiel. Was die gewinnorientierten Trader verdienen, verlieren andere – vor allem die nutzenorientierten, die dafür aber einen anderen Nutzen erhalten (Absicherung, Anlage).",
        ],
        merksatz: "Bevor du einen Trade machst: Wer ist auf der anderen Seite – und warum sollte gerade er verlieren?",
        bezug:
          "Übertragung auf BTC: Hedger (Miner, Basis-Trader), Spieler (Retail mit Hebel), informierte Trader und Market Maker treffen auf denselben Perp. Liquidationen sind erzwungene, nicht freiwillige Trades.",
        frage: {
          text: "Woher kommen nach Harris die Gewinne der gewinnorientierten Trader?",
          optionen: [
            "Aus dem allgemeinen Wachstum des Marktes",
            "Aus den Verlusten anderer Trader, vor allem der nutzenorientierten",
            "Aus den Gebühren der Börse",
          ],
          richtig: 1,
          erklaerung:
            "Handel ist relativ zum Markt ein Nullsummenspiel. Gewinne gewinnorientierter Trader sind Verluste anderer – oft von Tradern, die aus anderen Gründen handeln und den Preis dafür bewusst oder unbewusst zahlen.",
        },
      },
      {
        titel: "Orders und Orderbuch",
        kern: [
          "Eine Market-Order verlangt sofortige Ausführung und nimmt dafür den schlechteren Preis in Kauf. Eine Limit-Order legt den Preis fest und nimmt in Kauf, vielleicht gar nicht ausgeführt zu werden.",
          "Eine Limit-Order ist wie eine kostenlose Option für alle anderen: Sie dürfen sie ausführen, wann es ihnen passt – zum Beispiel genau dann, wenn neue Informationen sie wertlos machen.",
          "Orderbücher arbeiten meist nach Preis- und dann Zeitpriorität: bester Preis zuerst, bei gleichem Preis wer zuerst da war.",
        ],
        merksatz: "Market-Order = Sofortigkeit kaufen. Limit-Order = Sofortigkeit verkaufen und das Risiko tragen, überrollt zu werden.",
        frage: {
          text: "Warum ist eine Limit-Order laut Harris riskant für den, der sie stellt?",
          optionen: [
            "Weil sie höhere Gebühren kostet",
            "Weil andere sie ausführen können, wenn sich die Lage gegen ihn gedreht hat",
            "Weil sie nie ausgeführt wird",
          ],
          richtig: 1,
          erklaerung:
            "Wer ein Limit stellt, schenkt dem Markt eine Option. Ausgeführt wird sie bevorzugt dann, wenn sie für den Steller ungünstig geworden ist (z.B. Kauf-Limit wird gefüllt, kurz bevor der Preis weiter fällt).",
        },
      },
      {
        titel: "Liquidität hat vier Dimensionen",
        kern: [
          "Sofortigkeit: Wie schnell kann ich handeln?",
          "Breite: Wie gross ist der Spread, also die Kosten für sofortige Ausführung?",
          "Tiefe: Wie viel Volumen kann ich handeln, ohne den Preis stark zu bewegen?",
          "Erholung: Wie schnell kehrt der Preis nach einer grossen Order zurück?",
        ],
        merksatz: "Ein enger Spread allein heisst nicht liquide – Tiefe und Erholung zählen genauso.",
        bezug:
          "Übertragung: Abends und am Wochenende ist das BTC-Orderbuch dünner. Gleiches Volumen bewegt den Preis dann weiter – so wie im Chart-Beispiel mit wenig Volumen im Rücklauf.",
        frage: {
          text: "Ein Markt hat einen sehr engen Spread, aber kaum Volumen in den ersten Preisstufen. Was fehlt?",
          optionen: ["Breite", "Tiefe", "Sofortigkeit"],
          richtig: 1,
          erklaerung:
            "Der enge Spread steht für gute Breite. Fehlt Volumen in den Stufen dahinter, ist die Tiefe gering – grössere Orders bewegen den Preis dann stark.",
        },
      },
      {
        titel: "Market Maker und Adverse Selection",
        kern: [
          "Händler (Dealer, Market Maker) stellen Kauf- und Verkaufskurse und verdienen am Spread.",
          "Sie verlieren an informierte Trader: Wer mehr weiss, handelt gegen sie, kurz bevor sich der Preis bewegt (Adverse Selection).",
          "Der Spread deckt deshalb nicht nur Kosten und Lagerrisiko, sondern auch die erwarteten Verluste an Informierte. Je mehr Informierte im Markt, desto breiter der Spread.",
        ],
        merksatz: "Der Spread ist der Preis, den alle zahlen, weil einige mehr wissen.",
        frage: {
          text: "Warum verbreitern Market Maker ihren Spread vor wichtigen Nachrichten?",
          optionen: [
            "Weil dann mehr informierte Trader gegen sie handeln könnten",
            "Weil die Börse es vorschreibt",
            "Weil sie dann weniger Kapital haben",
          ],
          richtig: 0,
          erklaerung:
            "Vor Nachrichten steigt das Risiko, an Informierte zu verlieren. Der breitere Spread gleicht diese erwarteten Verluste aus.",
        },
      },
      {
        titel: "Wer die Orders anderer vorwegnimmt",
        kern: [
          "Manche Trader leben davon, die Orders anderer vorherzusehen: grosse Orders, Stop-Cluster, absehbare Umschichtungen.",
          "Grosse Trader teilen ihre Orders deshalb auf und verbergen sie, um ihre Absicht nicht zu verraten.",
          "Harris unterscheidet fundamentale Volatilität (neue Information) von vorübergehender Volatilität (Druck durch Orders, der sich wieder auflöst).",
        ],
        merksatz: "Nicht jede Bewegung ist Information – viel davon ist Order-Druck, der wieder verschwindet.",
        bezug:
          "Übertragung: Stop-Runs und Liquidations-Kaskaden sind vorübergehende Volatilität. Unsere Sweep-Backtests messen genau, ob sich diese Rückkehr handeln lässt – bisher kaum nach Kosten.",
        frage: {
          text: "Ein Preis-Spike durch ausgelöste Stops, der danach komplett zurückläuft, ist nach Harris eher …",
          optionen: ["fundamentale Volatilität", "vorübergehende Volatilität", "kein Volatilitätsereignis"],
          richtig: 1,
          erklaerung:
            "Die Bewegung kam aus Order-Druck, nicht aus neuer Information über den Wert – typisch vorübergehende Volatilität.",
        },
      },
    ],
  },

  // ------------------------------------------------------------------ Hull
  {
    id: "hull",
    titel: "Options, Futures and Other Derivatives",
    autor: "John C. Hull",
    jahr: "1. Aufl. 1989, viele Neuauflagen",
    gruppe: "Marktmechanik & Derivate",
    niveau: "Mittel",
    warum:
      "Standardlehrbuch zu Futures und Optionen. Für BTC-Perpetuals wichtig, weil Margin, Hebel, Basis und Absicherung hier sauber hergeleitet werden.",
    lektionen: [
      {
        titel: "Futures, Margin und tägliche Abrechnung",
        kern: [
          "Ein Future ist die Vereinbarung, einen Basiswert zu einem festen Preis an einem späteren Termin zu kaufen (long) oder zu verkaufen (short).",
          "Man hinterlegt nur eine Sicherheit (Initial Margin). Gewinne und Verluste werden täglich gutgeschrieben bzw. belastet (Mark-to-Market).",
          "Fällt das Konto unter die Maintenance Margin, kommt ein Margin Call – nachschiessen oder die Position wird geschlossen.",
        ],
        merksatz: "Hebel entsteht, weil nur die Margin hinterlegt wird – Gewinne und Verluste beziehen sich auf die volle Positionsgrösse.",
        bezug:
          "Übertragung auf Perps: Bei 10× Hebel (isolated) reicht eine Bewegung von grob 9–10 % gegen dich bis zur Liquidation (abhängig von der Maintenance Margin der Börse).",
        frage: {
          text: "Was passiert, wenn das Margin-Konto unter die Maintenance Margin fällt?",
          optionen: [
            "Nichts bis zum Verfallstag",
            "Margin Call: nachschiessen, sonst wird geschlossen",
            "Der Hebel wird automatisch erhöht",
          ],
          richtig: 1,
          erklaerung:
            "Unterhalb der Maintenance Margin muss Sicherheit nachgeschossen werden. Bei Krypto-Börsen geschieht das Schliessen automatisch als Liquidation.",
        },
      },
      {
        titel: "Preis eines Futures: Cost of Carry und Basis",
        kern: [
          "Ohne Erträge des Basiswerts gilt vereinfacht: Futurepreis = Spotpreis × e^(r·T). Der Aufschlag entspricht den Finanzierungskosten bis zum Verfall.",
          "Die Differenz zwischen Future- und Spotpreis heisst Basis. Zum Verfall läuft sie gegen null (Konvergenz).",
          "Weicht der Future zu stark ab, lohnt sich Arbitrage (Cash-and-Carry): Spot kaufen, Future verkaufen.",
        ],
        merksatz: "Die Basis ist der Preis für Finanzierung – und bei Krypto zusätzlich ein Mass für die Lust auf Hebel.",
        bezug:
          "Übertragung: Die CME-Basis und die Perp-Prämie in Nexus messen genau das. Eine sehr hohe Basis heisst: Viele wollen gehebelt long sein.",
        frage: {
          text: "Was passiert mit der Basis eines Futures bis zum Verfall?",
          optionen: ["Sie steigt immer", "Sie läuft gegen null", "Sie bleibt konstant"],
          richtig: 1,
          erklaerung:
            "Am Verfallstag muss der Future dem Spotpreis entsprechen, sonst gäbe es risikolosen Gewinn. Die Basis konvergiert daher gegen null.",
        },
      },
      {
        titel: "Absichern mit Futures",
        kern: [
          "Wer einen Basiswert hält, kann mit einer Short-Future-Position das Preisrisiko absichern.",
          "Perfekt ist das selten: Das Basisrisiko bleibt, weil sich Future und abgesicherter Wert nicht exakt gleich bewegen.",
          "Die varianzminimierende Hedge-Ratio hängt von der Korrelation und dem Volatilitätsverhältnis beider Preise ab.",
        ],
        merksatz: "Ein Hedge tauscht Preisrisiko gegen Basisrisiko – er beseitigt Risiko nicht ganz.",
        frage: {
          text: "Welches Risiko bleibt bei einer Absicherung mit Futures typischerweise übrig?",
          optionen: ["Gar keines", "Das Basisrisiko", "Nur das Zinsrisiko"],
          richtig: 1,
          erklaerung:
            "Weil Future und Basiswert nicht perfekt gleichlaufen und die Basis schwankt, bleibt das Basisrisiko.",
        },
      },
      {
        titel: "Optionen: Rechte statt Pflichten",
        kern: [
          "Ein Call gibt das Recht, zu einem festen Preis (Strike) zu kaufen, ein Put das Recht zu verkaufen. Der Käufer zahlt dafür eine Prämie.",
          "Der Optionswert besteht aus innerem Wert (was die Option sofort wert wäre) und Zeitwert (Chance auf mehr bis zum Verfall).",
          "Put-Call-Parität: Call und Put mit gleichem Strike und Verfall stehen in einer festen Beziehung zum Basiswert und zum abgezinsten Strike.",
        ],
        merksatz: "Optionskäufer riskieren nur die Prämie, Optionsverkäufer kassieren sie – und tragen das grosse Risiko.",
        frage: {
          text: "Was riskiert der Käufer einer Option maximal?",
          optionen: ["Die gezahlte Prämie", "Den Strike-Preis", "Unbegrenzt viel"],
          richtig: 0,
          erklaerung:
            "Der Käufer hat ein Recht, keine Pflicht. Im schlechtesten Fall verfällt die Option wertlos, verloren ist dann die Prämie.",
        },
      },
      {
        titel: "Volatilität und die Greeks",
        kern: [
          "Das Black-Scholes-Modell bewertet Optionen aus Spotpreis, Strike, Laufzeit, Zins und Volatilität. Nur die Volatilität ist nicht direkt beobachtbar.",
          "Implizite Volatilität ist die Volatilität, die der Marktpreis einer Option „einpreist“ – die Erwartung des Marktes.",
          "Die Greeks messen Empfindlichkeiten: Delta (Preis), Gamma (Änderung von Delta), Vega (Volatilität), Theta (Zeitverfall).",
        ],
        merksatz: "Optionen handeln heisst vor allem Volatilität handeln.",
        bezug: "Übertragung: Die implizite BTC-Volatilität (z.B. DVOL von Deribit) zeigt, wie stark der Markt eine Bewegung erwartet.",
        frage: {
          text: "Welcher Greek misst den Wertverlust einer Option durch Zeitablauf?",
          optionen: ["Delta", "Vega", "Theta"],
          richtig: 2,
          erklaerung: "Theta misst den Zeitverfall: Jeder Tag ohne Bewegung kostet den Optionskäufer Zeitwert.",
        },
      },
      {
        titel: "Übertragung: Perpetuals und Funding",
        kern: [
          "Nicht aus Hull: Perpetual Futures haben keinen Verfall. Damit fehlt die Konvergenz, die klassische Futures an den Spotpreis bindet.",
          "Stattdessen zahlen Longs und Shorts sich regelmässig Funding (bei Binance alle 8 Stunden). Liegt der Perp über Spot, zahlen Longs an Shorts.",
          "Funding ersetzt also Hulls Cost of Carry: Es ist der laufende Preis dafür, gehebelt auf einer Seite zu sein.",
        ],
        merksatz: "Funding ist die Basis in Raten.",
        frage: {
          text: "Was bindet den Preis eines Perpetuals an den Spotpreis?",
          optionen: ["Der Verfallstag", "Die Funding-Zahlungen", "Die Maintenance Margin"],
          richtig: 1,
          erklaerung:
            "Ohne Verfall übernimmt Funding diese Rolle: Weicht der Perp ab, zahlt die überfüllte Seite und es lohnt sich, dagegenzuhalten.",
        },
      },
    ],
  },

  // ---------------------------------------------------------------- Murphy
  {
    id: "murphy",
    titel: "Technical Analysis of the Financial Markets",
    autor: "John J. Murphy",
    jahr: "1999 (Neufassung von 1986)",
    gruppe: "Marktmechanik & Derivate",
    niveau: "Einstieg",
    warum:
      "Das Standard-Vokabular der Chartanalyse. Wichtig, um zu verstehen, was andere Trader sehen – nicht als Beweis, dass es funktioniert.",
    lektionen: [
      {
        titel: "Die drei Grundannahmen und Dow-Theorie",
        kern: [
          "Grundannahmen der technischen Analyse: Der Preis enthält alle Informationen, Preise bewegen sich in Trends, Geschichte wiederholt sich.",
          "Dow-Theorie: Es gibt Primär-, Sekundär- und kleine Trends. Ein Primärtrend hat Phasen (Akkumulation, breite Beteiligung, Distribution).",
          "Ein Trend gilt, bis ein klares Umkehrsignal kommt. Volumen soll den Trend bestätigen.",
        ],
        merksatz: "Ein Aufwärtstrend ist eine Folge höherer Hochs und höherer Tiefs – bis das Gegenteil bewiesen ist.",
        frage: {
          text: "Wann gilt ein Trend nach der Dow-Theorie als beendet?",
          optionen: [
            "Nach einer festen Anzahl Tage",
            "Wenn ein klares Umkehrsignal vorliegt",
            "Sobald der RSI über 70 steigt",
          ],
          richtig: 1,
          erklaerung: "Die Dow-Theorie unterstellt, dass ein Trend weiterläuft, bis ein eindeutiges Umkehrsignal kommt.",
        },
      },
      {
        titel: "Unterstützung, Widerstand, Rollentausch",
        kern: [
          "Unterstützung ist ein Bereich, in dem Kaufinteresse den Fall stoppt; Widerstand stoppt Anstiege.",
          "Wird ein Widerstand durchbrochen, wird er oft zur Unterstützung (Rollentausch) – das ist die Idee hinter dem Retest.",
          "Je öfter und je länger ein Level gehalten hat und je mehr Volumen dort lief, desto bedeutsamer gilt es.",
        ],
        merksatz: "Gebrochener Widerstand wird Unterstützung – oft, nicht immer.",
        bezug: "Übertragung: Siehe Backlog-Eintrag „Breakout + Retest“ – ob der Rollentausch bei BTC einen Vorteil bringt, ist ungetestet.",
        frage: {
          text: "Was erwartet die klassische Lehre, wenn ein Widerstand nach oben durchbrochen wurde?",
          optionen: [
            "Er wird bedeutungslos",
            "Er wirkt künftig eher als Unterstützung",
            "Der Preis muss sofort zurückfallen",
          ],
          richtig: 1,
          erklaerung: "Das ist der Rollentausch: Der alte Widerstand wird beim Rücklauf zur Unterstützung.",
        },
      },
      {
        titel: "Formationen",
        kern: [
          "Umkehrformationen: Kopf-Schulter, Doppel-Hoch und -Tief. Fortsetzungsformationen: Dreiecke, Flaggen, Wimpel.",
          "Viele Formationen haben ein Kursziel, meist die Höhe der Formation, vom Ausbruchspunkt abgetragen.",
          "Volumen soll beim Ausbruch zunehmen, sonst gilt der Ausbruch als verdächtig.",
        ],
        merksatz: "Eine Formation ist erst mit dem Ausbruch fertig – vorher ist sie eine Vermutung.",
        frage: {
          text: "Was sollte laut Murphy einen echten Ausbruch aus einer Formation begleiten?",
          optionen: ["Fallendes Volumen", "Steigendes Volumen", "Ein RSI unter 30"],
          richtig: 1,
          erklaerung: "Zunehmendes Volumen beim Ausbruch gilt als Bestätigung; ein Ausbruch ohne Volumen ist verdächtig.",
        },
      },
      {
        titel: "Gleitende Durchschnitte und Oszillatoren",
        kern: [
          "Gleitende Durchschnitte glätten den Preis und folgen dem Trend – mit Verzögerung. In Seitwärtsphasen erzeugen sie viele Fehlsignale.",
          "Oszillatoren wie RSI und MACD zeigen überkaufte/überverkaufte Zustände und Divergenzen zwischen Preis und Momentum.",
          "In starken Trends bleiben Oszillatoren lange im Extrembereich – dort sind „überkauft“-Signale gegen den Trend gefährlich.",
        ],
        merksatz: "Trendfolger für Trends, Oszillatoren für Seitwärtsmärkte – das Problem ist, vorher zu wissen, welcher Markt gerade ist.",
        bezug: "Übertragung: Im MTF-Backtest hat der RSI/MACD-Filter das Ergebnis in beiden Timeframe-Sets verschlechtert.",
        frage: {
          text: "Wo liefern gleitende Durchschnitte typischerweise die meisten Fehlsignale?",
          optionen: ["In starken Trends", "In Seitwärtsphasen", "Bei hohem Volumen"],
          richtig: 1,
          erklaerung: "Ohne Trend kreuzt der Preis den Durchschnitt ständig hin und her (Whipsaws).",
        },
      },
      {
        titel: "Was das Buch nicht liefert",
        kern: [
          "Murphy beschreibt Werkzeuge und ihre Lesart, aber kaum statistische Belege, dass sie nach Kosten Geld verdienen.",
          "Chartmuster sind im Nachhinein leicht zu erkennen und vorher schwer eindeutig zu definieren.",
          "Nutzen: Du verstehst, was viele andere Trader sehen und wo deren Orders liegen könnten.",
        ],
        merksatz: "Technische Analyse ist eine Sprache – ob sie einen Vorteil bringt, muss man messen.",
        frage: {
          text: "Was ist der wichtigste Nutzen des Buchs für systematisches Trading?",
          optionen: [
            "Es beweist, dass Chartmuster funktionieren",
            "Es erklärt, was andere Marktteilnehmer sehen und wo deren Orders liegen könnten",
            "Es liefert fertige profitable Strategien",
          ],
          richtig: 1,
          erklaerung:
            "Das Buch ist ein Wörterbuch der Chartanalyse. Ob ein Muster einen Vorteil hat, beantwortet erst ein Backtest.",
        },
      },
    ],
  },

  // ------------------------------------------------------------ Quantopian
  {
    id: "quantopian",
    titel: "Quantopian Lecture Series",
    autor: "Quantopian (heute bei QuantRocket)",
    jahr: "ca. 2015–2020, kostenlos",
    gruppe: "Systematisches Trading",
    niveau: "Einstieg",
    warum:
      "Kostenlose Lektionen zu Statistik, Backtesting und Portfolio-Aufbau mit Python. Genau das Handwerkszeug, um Trading-Ideen zu prüfen statt zu glauben.",
    lektionen: [
      {
        titel: "Renditen statt Preise",
        kern: [
          "Statistik rechnet mit Renditen (Veränderungen), nicht mit Preisen. Preise sind nicht stationär, Renditen eher.",
          "Mittelwert, Varianz und Standardabweichung beschreiben Ertrag und Schwankung.",
          "Finanzrenditen haben „fette Ränder“: Extreme Bewegungen kommen öfter vor, als eine Normalverteilung erwarten lässt.",
        ],
        merksatz: "Rechne mit Renditen und rechne mit Extremen.",
        frage: {
          text: "Warum analysiert man statistisch eher Renditen als Preise?",
          optionen: [
            "Weil Renditen eher stationär sind als Preise",
            "Weil Preise zu gross sind",
            "Weil Renditen immer positiv sind",
          ],
          richtig: 0,
          erklaerung: "Preise driften ohne festes Niveau; die meisten statistischen Verfahren setzen aber eine stabile Verteilung voraus.",
        },
      },
      {
        titel: "Hypothesentests und p-Hacking",
        kern: [
          "Ein Hypothesentest fragt: Wie wahrscheinlich wäre das Ergebnis, wenn in Wahrheit kein Effekt existiert?",
          "Wer viele Varianten testet, findet zufällig „signifikante“ Ergebnisse (Mehrfachvergleiche). Bei 20 Tests auf 5 %-Niveau ist im Schnitt einer falsch positiv.",
          "Gegenmittel: Hypothese vorher festlegen, Anzahl der Tests berücksichtigen, auf neuen Daten prüfen.",
        ],
        merksatz: "Je mehr du testest, desto weniger bedeutet ein einzelner Treffer.",
        bezug: "Übertragung: Deshalb haben wir im MTF-Backtest die Parameter vorab festgelegt und nur wenige Varianten gerechnet.",
        frage: {
          text: "Du testest 20 zufällige Indikatoren. Wie viele erscheinen auf dem 5 %-Niveau im Schnitt signifikant, obwohl keiner wirkt?",
          optionen: ["Keiner", "Etwa einer", "Etwa zehn"],
          richtig: 1,
          erklaerung: "5 % von 20 Tests ergibt im Schnitt einen Zufallstreffer – das ist der Kern des Mehrfachvergleich-Problems.",
        },
      },
      {
        titel: "Regression und Scheinzusammenhänge",
        kern: [
          "Lineare Regression misst, wie stark eine Grösse eine andere erklärt.",
          "Korrelation ist keine Kausalität. Zwei trendende Reihen wirken oft korreliert, obwohl sie nichts miteinander zu tun haben.",
          "Autokorrelation und fehlende Stationarität verfälschen klassische Tests.",
        ],
        merksatz: "Zwei Linien, die beide steigen, beweisen nichts.",
        frage: {
          text: "Zwei Preisreihen steigen beide über Jahre und sind stark korreliert. Was folgt daraus?",
          optionen: [
            "Die eine verursacht die andere",
            "Nichts Sicheres – trendende Reihen erzeugen leicht Scheinkorrelationen",
            "Man kann die eine aus der anderen sicher vorhersagen",
          ],
          richtig: 1,
          erklaerung: "Gemeinsame Trends erzeugen Scheinkorrelation. Aussagekräftiger ist die Korrelation der Renditen.",
        },
      },
      {
        titel: "Backtest-Fallen",
        kern: [
          "Look-Ahead-Bias: Daten benutzen, die zum Entscheidungszeitpunkt noch nicht bekannt waren.",
          "Survivorship-Bias: nur die Werte testen, die heute noch existieren.",
          "Überanpassung: Regeln so lange drehen, bis die Vergangenheit gut aussieht.",
          "Kosten und Slippage weglassen – oft der Unterschied zwischen Gewinn und Verlust.",
        ],
        merksatz: "Ein Backtest ist erst glaubwürdig, wenn er alle Gründe überlebt hat, warum er lügen könnte.",
        bezug: "Übertragung: Im MTF-Backtest haben genau die Kosten den Brutto-Vorteil aufgefressen.",
        frage: {
          text: "Ein Backtest nutzt den Schlusskurs der 4h-Kerze schon in der ersten Stunde dieser Kerze. Welcher Fehler ist das?",
          optionen: ["Survivorship-Bias", "Look-Ahead-Bias", "Slippage"],
          richtig: 1,
          erklaerung: "Der Schlusskurs ist erst am Ende der 4h-Kerze bekannt. Ihn früher zu verwenden, ist Blick in die Zukunft.",
        },
      },
      {
        titel: "Positionsgrösse und Diversifikation",
        kern: [
          "Das Risiko eines Portfolios hängt nicht nur von den Einzelwerten ab, sondern von ihrer Korrelation.",
          "Eine zu grosse Einzelposition kann eine gute Strategie ruinieren, bevor sich der Vorteil zeigt.",
          "Das Kelly-Kriterium gibt die wachstumsoptimale Einsatzgrösse an – in der Praxis nutzt man einen Bruchteil davon.",
        ],
        merksatz: "Die richtige Positionsgrösse ist die, bei der du die Pechsträhne überlebst.",
        frage: {
          text: "Warum setzt man in der Praxis meist nur einen Bruchteil des Kelly-Einsatzes?",
          optionen: [
            "Weil Kelly zu wenig Rendite bringt",
            "Weil die Schätzung des Vorteils unsicher ist und volles Kelly extreme Schwankungen erzeugt",
            "Weil Kelly nur für Aktien gilt",
          ],
          richtig: 1,
          erklaerung: "Volles Kelly ist sehr aggressiv, und ist der Vorteil überschätzt, wird es ruinös. Halbes Kelly opfert wenig Wachstum für viel Ruhe.",
        },
      },
    ],
  },

  // ---------------------------------------------------------------- Carver
  {
    id: "carver",
    titel: "Systematic Trading",
    autor: "Robert Carver",
    jahr: "2015",
    gruppe: "Systematisches Trading",
    niveau: "Mittel",
    warum:
      "Wie man ein Handelssystem baut, das realistisch bleibt: Signale skalieren, Risiko steuern, Überanpassung vermeiden.",
    lektionen: [
      {
        titel: "Warum systematisch – und warum einfach",
        kern: [
          "Menschen machen beim Traden vorhersehbare Fehler: Verluste laufen lassen, Gewinne zu früh nehmen, Mustern hinterherjagen.",
          "Regeln schützen davor – aber nur, wenn sie einfach bleiben. Komplexe, optimierte Systeme sehen im Backtest gut aus und enttäuschen live.",
          "Carver mahnt realistische Erwartungen an: Selbst gute Systeme erreichen nur bescheidene Sharpe-Ratios.",
        ],
        merksatz: "Ein einfaches robustes System schlägt ein brillantes, überangepasstes.",
        frage: {
          text: "Warum warnt Carver vor stark optimierten Systemen?",
          optionen: [
            "Weil sie zu wenig handeln",
            "Weil sie meist an die Vergangenheit angepasst sind und live schlechter laufen",
            "Weil sie zu viel Rechenzeit brauchen",
          ],
          richtig: 1,
          erklaerung: "Optimierung findet Zufallsmuster der Vergangenheit. Live fehlt dieses Muster, und die Leistung bricht ein.",
        },
      },
      {
        titel: "Prognosen statt Ja/Nein-Signale",
        kern: [
          "Statt binär „kaufen/verkaufen“ liefert jede Regel eine Prognose mit Stärke, skaliert so, dass ein durchschnittlicher Betrag etwa 10 ist, gedeckelt bei ±20.",
          "Typische Regeln: Trendfolge über gleitende Durchschnitte unterschiedlicher Geschwindigkeit und Carry (Ertrag fürs Halten).",
          "Mehrere Regeln werden gewichtet kombiniert; die Kombination ist stabiler als jede einzelne Regel.",
        ],
        merksatz: "Nicht nur die Richtung zählt, sondern wie überzeugt das System ist.",
        bezug: "Übertragung: Statt Confluence als UND-Kette (wenige Trades) lieber einen gewichteten Score – wie Variante G im MTF-Backtest.",
        frage: {
          text: "Was ist der Vorteil skalierter Prognosen gegenüber Ja/Nein-Signalen?",
          optionen: [
            "Sie handeln nie",
            "Die Positionsgrösse kann der Stärke des Signals folgen",
            "Sie brauchen keine Daten",
          ],
          richtig: 1,
          erklaerung: "Ein starkes Signal bekommt eine grössere Position, ein schwaches eine kleine – statt alles oder nichts.",
        },
      },
      {
        titel: "Volatilität steuert die Positionsgrösse",
        kern: [
          "Carver legt zuerst ein Risikoziel fest, z.B. eine bestimmte jährliche Schwankung des Kontos.",
          "Die Positionsgrösse ergibt sich aus diesem Ziel, der Volatilität des Instruments und der Prognosestärke.",
          "Steigt die Volatilität, wird die Position automatisch kleiner. Das Risikoziel sollte unter dem liegen, was Kelly erlauben würde (höchstens halbes Kelly).",
        ],
        merksatz: "Risiko wird festgelegt, die Positionsgrösse ist das Ergebnis.",
        bezug: "Übertragung: Der Positionsgrössen-Rechner im Grundlagen-Tab folgt derselben Logik – Risiko zuerst, Grösse danach.",
        frage: {
          text: "Die Volatilität von BTC verdoppelt sich. Was macht ein volatilitätsgesteuertes System?",
          optionen: ["Position verdoppeln", "Position etwa halbieren", "Nichts ändern"],
          richtig: 1,
          erklaerung: "Damit das Risiko gleich bleibt, sinkt die Position etwa im selben Verhältnis, wie die Volatilität steigt.",
        },
      },
      {
        titel: "Diversifikation und Kosten",
        kern: [
          "Der grösste kostenlose Vorteil ist Diversifikation: mehrere Instrumente und mehrere unkorrelierte Regeln.",
          "Gewichte lieber grob und robust festlegen („Handcrafting“) als fein optimieren.",
          "Kosten begrenzen, wie schnell ein System handeln darf. Schnelle Regeln mit hohen Kosten zerstören den Vorteil.",
        ],
        merksatz: "Handle nicht schneller, als deine Kosten es erlauben.",
        bezug: "Übertragung: Genau das zeigte der Wechsel von 15m auf 1h im MTF-Backtest – die Kosten pro R halbierten sich.",
        frage: {
          text: "Was begrenzt laut Carver, wie häufig ein System handeln sollte?",
          optionen: ["Die Kosten pro Trade", "Die Bildschirmzeit", "Die Anzahl Indikatoren"],
          richtig: 0,
          erklaerung: "Jeder Trade kostet. Ein schnelles System braucht einen entsprechend grösseren Vorteil, sonst bleibt nach Kosten nichts.",
        },
      },
      {
        titel: "Dem System treu bleiben",
        kern: [
          "Carver beschreibt verschiedene Trader-Typen, z.B. den reinen Systemtrader und den „halbautomatischen“, der Signale selbst auswählt.",
          "Wer ins System eingreift, macht es meist schlechter – Eingriffe folgen genau den Gefühlen, vor denen das System schützen soll.",
          "Änderungen am System nur aus Forschung, nicht aus der letzten Verlustserie.",
        ],
        merksatz: "Ändere das System im Labor, nicht während des Trades.",
        frage: {
          text: "Wann sollte man laut Carver ein System ändern?",
          optionen: [
            "Nach drei Verlusten in Folge",
            "Auf Basis neuer Forschung, nicht wegen kurzfristiger Ergebnisse",
            "Immer wenn der Markt sich anders anfühlt",
          ],
          richtig: 1,
          erklaerung: "Kurzfristige Verlustserien sind normal und sagen wenig. Änderungen sollten aus sauber getesteten Erkenntnissen kommen.",
        },
      },
    ],
  },

  // ------------------------------------------------------------------ Chan
  {
    id: "chan",
    titel: "Quantitative Trading",
    autor: "Ernest P. Chan",
    jahr: "2008 (2. Aufl. 2021)",
    gruppe: "Systematisches Trading",
    niveau: "Einstieg",
    warum: "Praktischer Einstieg für Einzelpersonen: Strategien finden, backtesten, Risiko steuern und live betreiben.",
    lektionen: [
      {
        titel: "Strategien finden und vorsortieren",
        kern: [
          "Ideen gibt es überall (Bücher, Foren, Papers). Die Kunst ist, schnell die schlechten auszusortieren.",
          "Erste Prüfung: Sharpe-Ratio, maximaler Drawdown, wie lange der Drawdown dauerte, Kapazität und ob die Daten verfügbar sind.",
          "Misstrauisch werden bei sehr hohen Renditen mit wenigen Trades oder wenn die Strategie nur in einer Marktphase funktionierte.",
        ],
        merksatz: "Die meisten Ideen sind schlecht – billig aussortieren ist eine Kernkompetenz.",
        frage: {
          text: "Ein Backtest zeigt +300 % mit 12 Trades in 5 Jahren. Wie bewertest du das?",
          optionen: [
            "Sofort live handeln",
            "Skeptisch: zu wenige Trades für eine verlässliche Aussage",
            "Hebel erhöhen",
          ],
          richtig: 1,
          erklaerung: "Mit 12 Trades kann fast jedes Ergebnis Zufall sein – wie die 17 Trades der Gemini-Variante im MTF-Backtest.",
        },
      },
      {
        titel: "Backtesting richtig machen",
        kern: [
          "Typische Fehler: Look-Ahead-Bias, Data-Snooping (zu viele Parameter), Survivorship-Bias, fehlerhafte Daten, fehlende Kosten.",
          "Wenige Parameter verwenden und auf Daten prüfen, die bei der Entwicklung nicht benutzt wurden (Out-of-Sample).",
          "Paper Trading vor dem Live-Gang zeigt Fehler in Daten und Ablauf, die der Backtest nicht sieht.",
        ],
        merksatz: "Weniger Parameter, mehr Out-of-Sample.",
        frage: {
          text: "Was ist das beste Mittel gegen Data-Snooping?",
          optionen: [
            "Mehr Parameter hinzufügen",
            "Wenige Parameter und Prüfung auf ungesehenen Daten",
            "Nur die besten Jahre testen",
          ],
          richtig: 1,
          erklaerung: "Jeder zusätzliche Parameter erhöht die Gefahr, Zufall anzupassen. Ungesehene Daten decken das auf.",
        },
      },
      {
        titel: "Mean Reversion und Momentum",
        kern: [
          "Mean Reversion: Preise kehren zu einem Mittelwert zurück. Momentum: Bewegungen setzen sich fort.",
          "Beides kann im selben Markt auf unterschiedlichen Zeitskalen auftreten.",
          "Pairs Trading nutzt Mean Reversion zwischen zwei zusammenhängenden Werten (Kointegration statt blosser Korrelation).",
        ],
        merksatz: "Kläre zuerst, ob du auf Rückkehr oder Fortsetzung wettest – und auf welcher Zeitskala.",
        bezug: "Übertragung: Sweep-Umkehr ist eine Mean-Reversion-Wette, Breakout + Retest eine Momentum-Wette auf dieselbe Preisaktion.",
        frage: {
          text: "Breakout + Retest ist welche Art von Wette?",
          optionen: ["Mean Reversion", "Momentum (Fortsetzung)", "Arbitrage"],
          richtig: 1,
          erklaerung: "Man setzt darauf, dass der Ausbruch hält und sich fortsetzt – eine Momentum-Wette.",
        },
      },
      {
        titel: "Kelly und Risikosteuerung",
        kern: [
          "Chan stellt das Kelly-Kriterium vor: optimaler Hebel ≈ mittlere Überrendite geteilt durch Varianz der Renditen.",
          "Weil Schätzungen unsicher sind, empfiehlt er halbes Kelly oder weniger.",
          "Den Hebel regelmässig an das aktuelle Kapital anpassen: nach Verlusten kleiner, nach Gewinnen grösser.",
        ],
        merksatz: "Kelly sagt, wie viel maximal sinnvoll ist – nicht, wie viel du nehmen solltest.",
        frage: {
          text: "Was passiert, wenn du den Hebel über das Kelly-Optimum hinaus erhöhst?",
          optionen: [
            "Mehr Wachstum ohne Nachteil",
            "Langfristig weniger Wachstum und deutlich mehr Ruinrisiko",
            "Nichts",
          ],
          richtig: 1,
          erklaerung: "Jenseits von Kelly sinkt das langfristige Wachstum wieder, während die Schwankungen weiter zunehmen.",
        },
      },
      {
        titel: "Live gehen",
        kern: [
          "Ausführung automatisieren, wo möglich, damit Gefühle nicht eingreifen.",
          "Live-Ergebnisse mit dem Backtest vergleichen. Grosse Abweichungen zeigen Fehler oder einen Regimewechsel.",
          "Psychologisch vorbereitet sein: Drawdowns kommen, auch bei guten Strategien.",
        ],
        merksatz: "Live ist der letzte und ehrlichste Test.",
        frage: {
          text: "Deine Live-Ergebnisse weichen stark vom Backtest ab. Was ist der erste Schritt?",
          optionen: [
            "Hebel erhöhen, um aufzuholen",
            "Ursachen prüfen: Daten, Ausführung, Kosten oder geänderte Marktphase",
            "Strategie sofort wegwerfen",
          ],
          richtig: 1,
          erklaerung: "Abweichungen sind ein Hinweis. Erst die Ursache klären, dann entscheiden.",
        },
      },
    ],
  },

  // ----------------------------------------------------------- López de Prado
  {
    id: "lopez",
    titel: "Advances in Financial Machine Learning",
    autor: "Marcos López de Prado",
    jahr: "2018",
    gruppe: "Systematisches Trading",
    niveau: "Fortgeschritten",
    warum:
      "Methoden gegen Selbsttäuschung im Backtest. Nexus-Atlas nutzt bereits einige davon (Purged Walk-Forward, PBO, Triple Barrier).",
    lektionen: [
      {
        titel: "Bessere Kerzen: Volumen- und Dollar-Bars",
        kern: [
          "Zeitkerzen (1h, 4h) sammeln gleich viel Zeit, aber sehr unterschiedlich viel Aktivität.",
          "Volumen- oder Dollar-Bars schliessen, wenn eine feste Menge gehandelt wurde. Ihre Renditen sind statistisch gutmütiger.",
          "Informationsgetriebene Bars schliessen, wenn das Orderflow-Ungleichgewicht ungewöhnlich wird.",
        ],
        merksatz: "Miss den Markt in Aktivität, nicht in Uhrzeit.",
        frage: {
          text: "Warum können Dollar-Bars besser sein als Zeitkerzen?",
          optionen: [
            "Sie sind einfacher zu zeichnen",
            "Sie bilden Marktaktivität gleichmässiger ab und haben gutmütigere Statistik",
            "Sie zeigen immer Trends",
          ],
          richtig: 1,
          erklaerung: "Jede Dollar-Bar enthält gleich viel Handel. Ruhige Nachtstunden und hektische Phasen werden vergleichbar.",
        },
      },
      {
        titel: "Labeling: Triple Barrier und Meta-Labeling",
        kern: [
          "Statt „Rendite nach festen N Kerzen“ markiert die Triple-Barrier-Methode, welche Schranke zuerst berührt wird: Take-Profit, Stop oder Zeitlimit.",
          "So entsprechen die Labels echten Trades mit Stop und Ziel.",
          "Meta-Labeling: Ein Grundmodell gibt die Richtung vor, ein zweites Modell entscheidet nur, ob und wie gross gehandelt wird.",
        ],
        merksatz: "Bewerte Signale so, wie du sie handeln würdest – mit Stop, Ziel und Zeit.",
        bezug: "Übertragung: Der RSI-Reversal-Test in docs/research nutzt Triple Barrier; der MTF-Backtest folgt derselben Logik (Stop, 2R, Zeitstopp).",
        frage: {
          text: "Welche drei Schranken nutzt die Triple-Barrier-Methode?",
          optionen: [
            "Take-Profit, Stop-Loss, Zeitlimit",
            "RSI, MACD, Volumen",
            "Hoch, Tief, Schlusskurs",
          ],
          richtig: 0,
          erklaerung: "Das Label ergibt sich daraus, welche der drei Schranken der Preis zuerst erreicht.",
        },
      },
      {
        titel: "Überlappende Labels und Stationarität",
        kern: [
          "Überlappen Trades zeitlich, sind die Beobachtungen nicht unabhängig. Ohne Gewichtung überschätzt man, wie viel man weiss.",
          "Gewichte nach „Einzigartigkeit“ und Sequential Bootstrap reduzieren dieses Problem.",
          "Fraktionelles Differenzieren macht eine Preisreihe stationär, ohne ihr ganzes Gedächtnis zu löschen – ein Mittelweg zwischen Preis und Rendite.",
        ],
        merksatz: "1000 überlappende Trades sind nicht 1000 unabhängige Beweise.",
        frage: {
          text: "Warum sind überlappende Trades ein Problem für die Statistik?",
          optionen: [
            "Sie sind teurer",
            "Sie sind nicht unabhängig, die Stichprobe wirkt dadurch grösser als sie ist",
            "Sie haben immer Verluste",
          ],
          richtig: 1,
          erklaerung: "Überlappende Trades teilen dieselben Preisbewegungen. Die effektive Stichprobe ist kleiner als die Anzahl Trades.",
        },
      },
      {
        titel: "Kreuzvalidierung mit Purging und Embargo",
        kern: [
          "Normale k-fache Kreuzvalidierung lässt Information durchsickern, weil Trainings- und Testdaten zeitlich überlappen.",
          "Purging entfernt aus dem Training alle Beobachtungen, deren Labels in den Testzeitraum reichen.",
          "Ein Embargo lässt zusätzlich eine Lücke nach dem Testzeitraum.",
        ],
        merksatz: "Zwischen Lernen und Prüfen muss eine echte Wand stehen.",
        bezug: "Übertragung: research-python/src/validation/walk_forward.py implementiert PurgedWalkForwardCV und CPCV nach diesem Prinzip.",
        frage: {
          text: "Was entfernt Purging aus den Trainingsdaten?",
          optionen: [
            "Alle Daten vor 2020",
            "Beobachtungen, deren Labels in den Testzeitraum hineinreichen",
            "Die Ausreisser",
          ],
          richtig: 1,
          erklaerung: "Solche Beobachtungen enthalten Information aus dem Testzeitraum. Ohne Purging wäre der Test zu optimistisch.",
        },
      },
      {
        titel: "Backtest-Überanpassung messen",
        kern: [
          "Ein Backtest ist kein Forschungswerkzeug: Wer so lange testet, bis es gut aussieht, findet garantiert etwas.",
          "Der Deflated Sharpe Ratio korrigiert die Sharpe-Ratio dafür, wie viele Varianten ausprobiert wurden.",
          "Die Probability of Backtest Overfitting (PBO) schätzt, wie oft die im Test beste Variante ausserhalb davon unterdurchschnittlich ist.",
        ],
        merksatz: "Zähle deine Versuche – sie gehören zum Ergebnis.",
        frage: {
          text: "Wofür korrigiert der Deflated Sharpe Ratio?",
          optionen: [
            "Für die Gebühren",
            "Für die Anzahl der ausprobierten Varianten",
            "Für die Inflation",
          ],
          richtig: 1,
          erklaerung: "Je mehr Varianten getestet wurden, desto höher ist die beste Sharpe-Ratio rein zufällig. Das wird herausgerechnet.",
        },
      },
    ],
  },

  // ---------------------------------------------------------------- Douglas
  {
    id: "douglas",
    titel: "Trading in the Zone",
    autor: "Mark Douglas",
    jahr: "2000",
    gruppe: "Risiko & Psychologie",
    niveau: "Einstieg",
    warum: "Warum Trader mit gutem Setup trotzdem verlieren – und wie Denken in Wahrscheinlichkeiten das ändert.",
    lektionen: [
      {
        titel: "Das Problem ist nicht die Analyse",
        kern: [
          "Viele Trader suchen das bessere Setup, obwohl ihr Problem im Umgang mit Unsicherheit liegt.",
          "Douglas nennt typische Ängste: falsch zu liegen, Geld zu verlieren, etwas zu verpassen, Gewinn liegen zu lassen.",
          "Diese Ängste führen zu Fehlern: zu spät einsteigen, Stops verschieben, Gewinne zu früh nehmen.",
        ],
        merksatz: "Angst verzerrt, was du im Chart siehst.",
        frage: {
          text: "Was ist laut Douglas meist der Grund für inkonsistente Ergebnisse?",
          optionen: [
            "Fehlende Indikatoren",
            "Der Umgang mit Angst und Unsicherheit",
            "Zu langsame Internetverbindung",
          ],
          richtig: 1,
          erklaerung: "Douglas sieht die Ursache in der Denkweise, nicht in der Analysetechnik.",
        },
      },
      {
        titel: "Fünf Grundwahrheiten",
        kern: [
          "1. Alles kann passieren.",
          "2. Du musst nicht wissen, was als Nächstes passiert, um Geld zu verdienen.",
          "3. Gewinne und Verluste sind bei einem Vorteil zufällig verteilt.",
          "4. Ein Vorteil ist nur eine höhere Wahrscheinlichkeit für ein Ergebnis.",
          "5. Jeder Moment im Markt ist einzigartig.",
        ],
        merksatz: "Ein einzelner Trade beweist nichts – weder für noch gegen dein System.",
        frage: {
          text: "Was ist ein Vorteil (Edge) nach Douglas?",
          optionen: [
            "Eine Garantie für den nächsten Trade",
            "Nur eine höhere Wahrscheinlichkeit für ein Ergebnis",
            "Ein geheimer Indikator",
          ],
          richtig: 1,
          erklaerung: "Ein Vorteil garantiert nichts im Einzelfall. Er zeigt sich erst über viele Trades.",
        },
      },
      {
        titel: "Wie ein Casino denken",
        kern: [
          "Ein Casino weiss nicht, wer am nächsten Tisch gewinnt – aber es weiss, dass es über viele Spiele vorn liegt.",
          "Trader sollten ebenso über eine Serie von Trades denken, nicht über den einzelnen.",
          "Verluste sind Betriebskosten des Vorteils, keine persönlichen Niederlagen.",
        ],
        merksatz: "Denk in Serien, nicht in Einzeltrades.",
        frage: {
          text: "Wie sollte man einen Verlust bei einem regelkonformen Trade bewerten?",
          optionen: [
            "Als Beweis, dass das System nicht funktioniert",
            "Als normalen Teil der Verteilung – eine Art Betriebskosten",
            "Als Grund, das nächste Mal grösser zu setzen",
          ],
          richtig: 1,
          erklaerung: "Auch ein gutes System hat Verluste. Entscheidend ist die Serie, nicht der Einzelfall.",
        },
      },
      {
        titel: "Risiko vorher akzeptieren",
        kern: [
          "Vor jedem Trade festlegen: Wo liege ich falsch, wie viel verliere ich dann, und diesen Betrag innerlich akzeptieren.",
          "Wer das Risiko wirklich akzeptiert hat, muss den Stop nicht mehr verschieben.",
          "Douglas schlägt eine Übung vor: eine feste Stichprobe von 20 Trades nach exakt denselben Regeln, ohne einzugreifen.",
        ],
        merksatz: "Akzeptiertes Risiko macht ruhig – verdrängtes Risiko macht hektisch.",
        bezug: "Übertragung: Im Trading-Journal pro Trade Stop und Risiko in R vorher eintragen, danach nur noch auswerten.",
        frage: {
          text: "Was ist der Sinn der 20-Trades-Übung?",
          optionen: [
            "Möglichst viel Gewinn in kurzer Zeit",
            "Regeln konsequent anwenden und das Ergebnis als Stichprobe sehen",
            "Neue Indikatoren ausprobieren",
          ],
          richtig: 1,
          erklaerung: "Die Übung trainiert Konsequenz. Erst nach der Stichprobe wird ausgewertet.",
        },
      },
    ],
  },

  // ------------------------------------------------------------ Steenbarger
  {
    id: "steenbarger",
    titel: "Trading-Psychologie (u.a. The Daily Trading Coach)",
    autor: "Brett N. Steenbarger",
    jahr: "2003–2015 (mehrere Bücher)",
    gruppe: "Risiko & Psychologie",
    niveau: "Mittel",
    warum: "Trading als Leistung, die man wie ein Sportler trainiert – mit Journal, Routinen und Selbst-Coaching.",
    lektionen: [
      {
        titel: "Trader als Performer",
        kern: [
          "Steenbarger überträgt Methoden aus Sport- und Leistungspsychologie auf das Trading.",
          "Können entsteht durch gezieltes Üben mit Feedback, nicht durch blosses Zuschauen am Bildschirm.",
          "Üben heisst: einzelne Fähigkeiten isolieren, wiederholen, Ergebnis messen.",
        ],
        merksatz: "Bildschirmzeit ist nicht Übung – Übung hat ein Ziel und ein Feedback.",
        frage: {
          text: "Was unterscheidet gezieltes Üben von blosser Bildschirmzeit?",
          optionen: [
            "Mehr Monitore",
            "Ein konkretes Ziel und messbares Feedback",
            "Häufigere Trades",
          ],
          richtig: 1,
          erklaerung: "Gezieltes Üben arbeitet an einer bestimmten Fähigkeit und prüft das Ergebnis – wie im Sport.",
        },
      },
      {
        titel: "Auf Stärken aufbauen",
        kern: [
          "Statt nur Fehler zu analysieren: Was tust du anders, wenn du gut tradest?",
          "Diese Muster bewusst machen und häufiger wiederholen (lösungsorientiertes Vorgehen).",
          "Ein Journal soll beides festhalten: was funktioniert und was nicht.",
        ],
        merksatz: "Finde heraus, was du an guten Tagen tust – und mach mehr davon.",
        frage: {
          text: "Welche Frage stellt Steenbargers lösungsorientierter Ansatz zuerst?",
          optionen: [
            "Was mache ich falsch?",
            "Was mache ich anders, wenn ich gut trade?",
            "Welcher Indikator fehlt mir?",
          ],
          richtig: 1,
          erklaerung: "Er setzt bei bereits vorhandenen Stärken an, statt nur Schwächen zu bekämpfen.",
        },
      },
      {
        titel: "Gefühle als Information",
        kern: [
          "Gefühle sind nicht nur Störung: Unruhe kann ein Hinweis sein, dass der Markt anders läuft als geplant.",
          "Entscheidend ist, sie zu bemerken, bevor sie handeln – zum Beispiel durch kurze Pausen und Selbstbeobachtung.",
          "Der eigene Zustand (Müdigkeit, Stress, Ärger) beeinflusst, wie man den Markt wahrnimmt.",
        ],
        merksatz: "Bemerke das Gefühl, bevor es den Klick macht.",
        frage: {
          text: "Wie geht Steenbarger mit starken Gefühlen beim Trading um?",
          optionen: [
            "Ignorieren",
            "Sie wahrnehmen und als Information nutzen, ohne impulsiv zu handeln",
            "Sofort mit einem Trade reagieren",
          ],
          richtig: 1,
          erklaerung: "Gefühle werden beobachtet und eingeordnet. Gehandelt wird nach Plan, nicht aus dem Impuls.",
        },
      },
      {
        titel: "Routinen und Selbst-Coaching",
        kern: [
          "Feste Routinen vor, während und nach dem Handel machen gute Entscheidungen wahrscheinlicher.",
          "Prozessziele (Regeln einhalten) statt Ergebnisziele (Tagesgewinn) setzen.",
          "Regelmässig das eigene Journal auswerten und konkrete Verbesserungen für die nächste Woche festlegen.",
        ],
        merksatz: "Bewerte deinen Tag daran, ob du deinen Plan befolgt hast – nicht nur am Gewinn.",
        bezug: "Übertragung: Die Checklisten im Wissen-Tab (Welz, Salomon, Mein System) sind solche Routinen.",
        frage: {
          text: "Welches Ziel ist nach Steenbarger sinnvoller für einen Handelstag?",
          optionen: ["Mindestens 500 Franken Gewinn", "Alle Trades nach Plan ausführen", "Möglichst viele Trades"],
          richtig: 1,
          erklaerung: "Das Ergebnis eines Tages ist stark zufällig. Den Prozess hast du in der Hand.",
        },
      },
    ],
  },
];

export const BUCH_GRUPPEN: Buch["gruppe"][] = [
  "Marktmechanik & Derivate",
  "Systematisches Trading",
  "Risiko & Psychologie",
];
