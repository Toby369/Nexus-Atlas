// Woher die Zahlen einer Kachel kommen -- als Daten, nicht als Text in der
// Kachel (Vorbild AutarkTrade, docs/research/AUTARK-BAUWEISE-FUER-
// NEXUS_2026-10-29.md, Punkt D/E). Das Kachel-Register (lib/dashboardTiles.ts,
// Feld herkunft) nennt je Kachel ihre Quellen; DashboardLayout schreibt die
// Zeile darunter (components/basis/Quellenhinweis.tsx). So steht der Wortlaut
// an EINER Stelle und jede Kachel sagt es gleich.

export type QuellenArt = "daten" | "berechnet" | "ki";

export interface Quelle {
  name: string;
  url?: string;
  art?: QuellenArt;
}

export const Q = {
  binance: { name: "Binance", url: "https://www.binance.com/" },
  bybit: { name: "Bybit", url: "https://www.bybit.com/" },
  okx: { name: "OKX", url: "https://www.okx.com/" },
  bitget: { name: "Bitget", url: "https://www.bitget.com/" },
  bitunix: { name: "Bitunix", url: "https://www.bitunix.com/" },
  pionex: { name: "Pionex", url: "https://www.pionex.com/" },
  binanceSpot: { name: "Binance Spot", url: "https://www.binance.com/" },
  deribit: { name: "Deribit", url: "https://www.deribit.com/" },
  sosovalue: { name: "SoSoValue", url: "https://sosovalue.com/" },
  yahoo: { name: "Yahoo Finance", url: "https://finance.yahoo.com/" },
  fred: { name: "FRED", url: "https://fred.stlouisfed.org/" },
  bgeometrics: { name: "BGeometrics", url: "https://bitcoin-data.com/" },
  alternativeMe: { name: "Alternative.me", url: "https://alternative.me/crypto/fear-and-greed-index/" },
  fed: { name: "Federal Reserve", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" },
  news: { name: "Fed, BLS, SEC, Google News, BTC-ECHO" },
  youtube: { name: "YouTube", url: "https://www.youtube.com/" },
  nexus: { name: "eigene Berechnung", art: "berechnet" },
  ki: { name: "KI", art: "ki" },
} satisfies Record<string, Quelle>;

export const FUTURES_QUELLEN: Quelle[] = [Q.binance, Q.bybit, Q.okx, Q.bitget, Q.bitunix, Q.pionex];
