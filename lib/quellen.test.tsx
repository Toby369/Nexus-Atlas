import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Quellenhinweis from "@/components/basis/Quellenhinweis";
import { FUTURES_QUELLEN, Q } from "./quellen";

// Die Quellenzeile unter jeder Kachel (components/basis/Quellenhinweis.tsx).
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("Quellenhinweis", () => {
  it("nennt Datenquellen der Reihe nach", () => {
    const html = renderToStaticMarkup(<Quellenhinweis quellen={[Q.binance, Q.bybit]} />);
    expect(text(html)).toBe("Daten: Binance, Bybit");
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("trennt eigene Berechnung und KI von den Rohdaten", () => {
    const html = renderToStaticMarkup(<Quellenhinweis quellen={[Q.binance, Q.nexus, Q.ki]} />);
    expect(text(html)).toBe("Daten: Binance · eigene Berechnung · KI-generiert, keine Anlageberatung");
  });

  it("reine KI-Kachel ohne 'Daten:'", () => {
    expect(text(renderToStaticMarkup(<Quellenhinweis quellen={[Q.ki]} />))).toBe("KI-generiert, keine Anlageberatung");
  });

  it("ohne Quellen nichts", () => {
    expect(renderToStaticMarkup(<Quellenhinweis quellen={[]} />)).toBe("");
  });

  it("die sechs Futures-Börsen haben eindeutige Namen", () => {
    expect(new Set(FUTURES_QUELLEN.map((q) => q.name)).size).toBe(6);
  });
});
