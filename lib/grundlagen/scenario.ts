// Lern-Werkzeug: liest die Kombination aus Preis-, OI- und Funding-Richtung.
// Erweitert die vier OI/Preis-Grundfaelle (die auch die Marktkontext-Kachel
// nutzt) um "Preis seitwaerts" und um Funding als dritte Dimension.

export type PriceMove = "up" | "flat" | "down";
export type OiMove = "up" | "down";
export type FundingState = "neg" | "neutral" | "pos";
export type ScenarioTone = "bullish" | "bearish" | "watch" | "neutral";

export interface ScenarioReading {
  name: string;
  tone: ScenarioTone;
  text: string;
  watch: string;
  fundingTag: string;
  fundingTone: ScenarioTone;
  fundingText: string;
}

const BASE: Record<`${PriceMove}|${OiMove}`, { name: string; tone: ScenarioTone; text: string; watch: string }> = {
  "up|up": {
    name: "Long-Aufbau",
    tone: "bullish",
    text: "Neues Geld kauft mit Hebel. Der Anstieg wird von frischen Positionen getragen.",
    watch: "Ob Spot mitzieht (Wer treibt: Spot gegen Perp). Ein reiner Perp-Anstieg ist fragiler.",
  },
  "up|down": {
    name: "Short-Covering",
    tone: "watch",
    text: "Shorts schliessen ihre Positionen, es kommt kaum neues Kapital. Solche Rallys laufen oft schnell aus.",
    watch: "Ob danach OI wieder steigt (echte Nachfrage) oder der Preis zurückfällt.",
  },
  "down|up": {
    name: "Short-Aufbau",
    tone: "bearish",
    text: "Neue Verkäufer eröffnen Shorts. Das ist aktiver Verkaufsdruck, keine reine Gewinnmitnahme.",
    watch: "Liegen viele Shorts knapp unter einem Widerstand, droht später ein Squeeze.",
  },
  "down|down": {
    name: "Long-Abbau",
    tone: "watch",
    text: "Longs schliessen oder werden liquidiert. Kann Gewinnmitnahme oder beginnende Kapitulation sein.",
    watch: "Eine Liquidations-Cascade mit stark fallendem OI spricht für einen Flush, danach kommen oft Böden.",
  },
  "flat|up": {
    name: "Spannung baut sich auf",
    tone: "watch",
    text: "Hebel kommt in den Markt, aber der Preis bewegt sich nicht. Ein heftiger Ausbruch wird wahrscheinlicher.",
    watch: "Funding zeigt, wer überwiegt. Die überfüllte Seite wird meist zuerst ausgespült.",
  },
  "flat|down": {
    name: "Entschuldung",
    tone: "neutral",
    text: "Positionen werden ruhig abgebaut. Der Markt kühlt ab, die Volatilität sinkt.",
    watch: "Oft Vorstufe zu einer Range oder einem Volatilitäts-Squeeze.",
  },
};

function fundingPart(price: PriceMove, oi: OiMove, funding: FundingState) {
  if (funding === "neutral") {
    return {
      fundingTag: "Positionierung ausgeglichen",
      fundingTone: "neutral" as const,
      fundingText: "Kein Crowding. Die Bewegung wird eher von echtem Kaufen und Verkaufen getragen als von Hebel.",
    };
  }
  if (funding === "pos") {
    if (price === "down" && oi === "down") {
      return {
        fundingTag: "Long-Squeeze läuft",
        fundingTone: "bearish" as const,
        fundingText: "Longs waren überfüllt und werden ausgespült. Liquidationen können den Abverkauf beschleunigen.",
      };
    }
    if (price === "down") {
      return {
        fundingTag: "Gefährliche Mischung",
        fundingTone: "bearish" as const,
        fundingText: "Der Preis fällt, aber Longs zahlen weiter hohe Gebühren und halten an Verlustpositionen fest. Viel Abwärtspotenzial durch Liquidationen.",
      };
    }
    return {
      fundingTag: "Longs überfüllt",
      fundingTone: "watch" as const,
      fundingText: "Der Trend kann weiterlaufen, aber die Gefahr eines Long-Squeeze steigt. Kein Short allein deswegen: auf ein Scheitern an einem Level oder einen Strukturbruch warten.",
    };
  }
  if (price === "up" && oi === "down") {
    return {
      fundingTag: "Short-Squeeze läuft",
      fundingTone: "bullish" as const,
      fundingText: "Shorts waren überfüllt und werden zum Kaufen gezwungen. Typisch sind schnelle, steile Anstiege.",
    };
  }
  if (price === "up") {
    return {
      fundingTag: "Squeeze-Treibstoff",
      fundingTone: "bullish" as const,
      fundingText: "Der Preis steigt gegen eine Short-lastige Positionierung. Jeder weitere Anstieg zwingt Shorts zum Eindecken.",
    };
  }
  return {
    fundingTag: "Shorts überfüllt",
    fundingTone: "watch" as const,
    fundingText: "Die Abwärtsbewegung ist bereits stark gehebelt. Fällt der Preis nicht weiter, droht ein Short-Squeeze nach oben.",
  };
}

export function readScenario(price: PriceMove, oi: OiMove, funding: FundingState): ScenarioReading {
  return { ...BASE[`${price}|${oi}`], ...fundingPart(price, oi, funding) };
}
