import { PATTERN_DIRECTION, PATTERN_DIRECTION_LABEL } from "./patternDirection";

// Beschriftungen, Erklaerungen und Rohwert-Formatierung der 14 Faktoren und
// Risikofaktoren der Gesamteinschaetzung (market_states) -- reine Daten/
// Funktionen, genutzt vom Lagebild (components/HeroHeader.tsx).

export const RISK_LABELS: Record<string, string> = {
  LOW: "Niedrig",
  MEDIUM: "Mittel",
  HIGH: "Hoch",
  UNKNOWN: "Unbekannt",
};

// Risk ist bewusst von Confidence getrennt (siehe compute-market-state):
// Confidence misst die Einigkeit der verfuegbaren Faktoren, Risk misst die
// Fragilitaet/Gefahr der aktuellen Lage unabhaengig von der Richtung.
export function riskColor(level: string | null): string {
  if (level === "HIGH") return "text-down";
  if (level === "LOW") return "text-up";
  if (level === "MEDIUM") return "text-text";
  return "text-text-faint";
}

export const RISK_FACTOR_LABELS: Record<string, string> = {
  warning_pattern: "Warn-Muster erkannt",
  low_mtf_alignment: "Zeitrahmen uneins",
  funding_crowding: "Funding-Crowding",
  basis_crowding: "Basis-Crowding",
  elevated_volatility: "erhöhte Volatilität",
};

// Der Warn-Muster-Badge nennt Muster und Richtung direkt im Text (aus
// state.patterns, Richtung aus lib/patternDirection.ts). Muster, die den
// "warning_pattern"-Risk-Factor ausloesen (RISK_ELEVATING_PATTERN_NAMES,
// identisch zu compute-market-state), werden deshalb aus der allgemeinen
// Muster-Reihe herausgefiltert, damit sie nicht doppelt erscheinen.
// "Bullish Confirmation" ist kein Risk-Factor und bleibt in der Muster-Reihe.

export function riskFactorLabel(factor: string, patterns: { name: string }[]): string {
  if (factor === "warning_pattern" && patterns.length > 0) {
    const named = patterns
      .map((p) => {
        const direction = PATTERN_DIRECTION[p.name];
        return direction ? `${p.name} (${PATTERN_DIRECTION_LABEL[direction]})` : p.name;
      })
      .join(", ");
    return `Warn-Muster: ${named}`;
  }
  return RISK_FACTOR_LABELS[factor] ?? factor;
}

// Erklaerungstext je Risk-Factor (Nutzer-Feedback: "warn-muster erkannt:
// kann das erklaert werden? idee: wenn ich es druecke kommt erklaerung").
// Feste, allgemeine Erklaerung je Faktor-TYP (nicht pro Vorkommnis) --
// dieselben fuenf Schwellenwerte/Bedingungen wie in compute-market-state
// (Risk-Abschnitt), hier nur in Textform uebersetzt.
export const RISK_FACTOR_EXPLANATIONS: Record<string, string> = {
  warning_pattern:
    "Mindestens eines von vier Warn-Mustern wurde erkannt: „Fragile Bullish“ — bärisch (Struktur bullisch, aber Orderflow bestätigt nicht), „Distribution Warning“ — bärisch (Preis nahe 20-Perioden-Hoch, aber fallender Orderflow), „Capitulation“ — bärisch (RSI überverkauft + fallender Orderflow + überdurchschnittliche Liquidationen) oder „Short Squeeze“ — bullisch (Positionierungs-Divergenz deutet auf Squeeze-Setup). Muster, Richtung und Begründung stehen bereits hier vollständig beisammen — bewusst keine zusätzliche, inhaltsgleiche Pattern-Badge mehr oben, um dieselbe Information nicht doppelt zu zeigen.",
  low_mtf_alignment:
    "Die Struktur über die drei Zeitrahmen 1H/4H/1D stimmt aktuell zu weniger als 60% (gewichtet) überein — die Zeitrahmen sind sich uneins, was die Gefahr einer plötzlichen Umkehr oder von Chop (richtungslosem Hin-und-Her) erhöht.",
  funding_crowding:
    "Die durchschnittliche Funding-Rate über alle Börsen liegt über ±0.05% — ein Zeichen für überhitzte, einseitige Positionierung (Crowding). Viele gleich positionierte Trader erhöhen das Risiko einer Liquidationskaskade/eines Squeeze in die Gegenrichtung.",
  basis_crowding:
    "Die Perpetual-Prämie gegenüber dem Spot-Preis (Basis) liegt über ±0.15% — dasselbe Crowding-Signal wie extreme Funding, nur über einen anderen Derivate-Kanal gemessen.",
  elevated_volatility:
    "Die durchschnittliche wahre Handelsspanne (ATR, 14 Perioden) liegt über 1.0% des Preises — deutlich über dem bisher beobachteten Normalbereich (Median ~0.67%). Grössere Kursausschläge sind aktuell wahrscheinlicher als üblich.",
};

export const FACTOR_LABELS: Record<string, string> = {
  structure: "Struktur (1H)",
  momentum: "Momentum (RSI+MACD)",
  cvd: "Orderflow (CVD)",
  oi_price: "OI vs. Preis",
  positioning: "Positioning",
  orderbook: "Orderbuch-Imbalance",
  options: "Options (Put/Call)",
  macro: "Makro-Regime",
  funding: "Funding-Rate",
  sentiment: "Fear & Greed Index",
  trend_strength: "Trend-Stärke (ADX)",
  trend_regime: "Trend-Regime (EMA50/200)",
  vwap_position: "Preis vs. VWAP",
  basis: "Basis (Perpetual Premium)",
};

// Gruppierung der 14 Faktoren nach inhaltlicher Saeule statt einer flachen
// Liste (Institutional-Grade-Professionalisierung, Sprint A: "Gruppiere die
// 14 Faktoren in den Kacheln strikt nach den 5 Saeulen") -- dieselbe
// Kategorisierung, mit der die Faktoren bereits inhaltlich unterschieden
// werden (siehe compute-market-state-Kommentare je Faktor), sechs statt
// fuenf Gruppen: Market State hat keinen eigenstaendigen Volatilitaets-
// Faktor (anders als die Regime Matrix mit Bollinger/ATR) und dafuer zwei
// Gruppen, die die Regime Matrix nicht kennt (Positionierung, Optionen) --
// eine erzwungene Angleichung an das 5-Saeulen-Schema der Regime Matrix
// wuerde hier Faktoren in eine Gruppe pressen, zu der sie inhaltlich nicht
// gehoeren.
export const FACTOR_GROUPS: { title: string; keys: string[] }[] = [
  { title: "Struktur/Trend", keys: ["structure", "trend_strength", "trend_regime", "vwap_position"] },
  { title: "Momentum", keys: ["momentum"] },
  { title: "Orderflow/Derivate", keys: ["cvd", "oi_price", "orderbook", "funding", "basis"] },
  { title: "Positionierung", keys: ["positioning"] },
  { title: "Optionen", keys: ["options"] },
  { title: "Makro/Sentiment", keys: ["macro", "sentiment"] },
];

// Realer Rohwert je Faktor (aus factor.basis), zusaetzlich zum -1/0/+1-
// Ampel-Signal (Sprint A: "Zeige ... den realen Rohwert (z.B. 'RSI 37.2',
// 'ADX 35') statt nur das Ampel-Signal"). Rein additiv -- factorLabel()/
// factorColor() bleiben unveraendert die primaere Aussage, dies ist die
// Begruendung dahinter. null, wenn die Basis (noch) keine Rohdaten enthaelt
// (z. B. Faktor selbst ohne Daten) -- kein erfundener Wert.
export function factorRawValueLabel(key: string, basis: Record<string, unknown>): string | null {
  const num = (v: unknown, decimals = 2): string | null =>
    typeof v === "number" ? v.toFixed(decimals) : null;

  switch (key) {
    case "structure": {
      const bos = basis.bos === true ? "ja" : basis.bos === false ? "nein" : null;
      const choch = basis.choch === true ? "ja" : basis.choch === false ? "nein" : null;
      return bos !== null && choch !== null ? `BOS ${bos} · CHoCH ${choch}` : null;
    }
    case "momentum": {
      const rsi = num(basis.rsi_14, 1);
      return rsi !== null ? `RSI ${rsi}` : null;
    }
    case "cvd": {
      const delta = num(basis.cvd_delta, 1);
      return delta !== null ? `CVD-Δ ${Number(basis.cvd_delta) >= 0 ? "+" : ""}${delta}` : null;
    }
    case "oi_price": {
      const pct = num(basis.oi_delta_pct, 2);
      return pct !== null ? `OI-Δ ${Number(basis.oi_delta_pct) >= 0 ? "+" : ""}${pct}%` : null;
    }
    case "positioning": {
      const score = num(basis.score, 0);
      return score !== null ? `Score ${score}` : null;
    }
    case "orderbook": {
      const imb = num(basis.avg_depth_imbalance, 3);
      return imb !== null ? `Imbalance ${imb}` : null;
    }
    case "options": {
      const ratio = num(basis.put_call_oi_ratio, 2);
      return ratio !== null ? `P/C ${ratio}` : null;
    }
    case "macro": {
      return typeof basis.regime === "string" ? basis.regime : null;
    }
    case "funding": {
      const rate = num(basis.avg_current_rate !== undefined ? Number(basis.avg_current_rate) * 100 : null, 4);
      return rate !== null ? `${rate}%` : null;
    }
    case "sentiment": {
      const value = num(basis.value, 0);
      return value !== null ? `F&G ${value}` : null;
    }
    case "trend_strength": {
      const adx = num(basis.adx_14, 1);
      return adx !== null ? `ADX ${adx}` : null;
    }
    case "trend_regime": {
      if (typeof basis.close_price !== "number" || typeof basis.ema_50 !== "number" || basis.ema_50 === 0) {
        return null;
      }
      const diffPct = ((basis.close_price - basis.ema_50) / basis.ema_50) * 100;
      return `Preis vs. EMA50 ${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(2)}%`;
    }
    case "vwap_position": {
      const pct = num(basis.pct_diff, 2);
      return pct !== null ? `${Number(basis.pct_diff) >= 0 ? "+" : ""}${pct}%` : null;
    }
    case "basis": {
      const pct = num(basis.basis_pct, 3);
      return pct !== null ? `${Number(basis.basis_pct) >= 0 ? "+" : ""}${pct}%` : null;
    }
    default:
      return null;
  }
}

export function factorLabel(value: -1 | 0 | 1 | null): string {
  if (value === 1) return "bullisch";
  if (value === -1) return "bärisch";
  if (value === 0) return "neutral";
  return "keine Daten";
}

export function factorColor(value: -1 | 0 | 1 | null): string {
  if (value === 1) return "text-up";
  if (value === -1) return "text-down";
  return "text-text-faint";
}
