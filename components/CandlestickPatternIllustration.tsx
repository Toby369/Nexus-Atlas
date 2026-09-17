// Schematische SVG-Skizzen der 7 von research_detect_candlestick_patterns()
// erkannten Kerzenmuster -- Nutzer-Wunsch "Lernkarten mit Bild" (Muster sind
// per Definition eine Form, reiner Fliesstext reicht zum Erkennen nicht).
// Bewusst als Inline-SVG im Code (keine Bild-Uploads/kein Speicher-Bucket
// noetig) -- schematisch/lehrbuchartig, NICHT aus echten Kursdaten
// abgeleitet. Farben ueber currentColor + bestehende text-up/text-down/
// text-text-faint-Klassen, damit sie automatisch zum Hell-/Dunkel-Theme
// passen wie der Rest der App.

interface CandleSpec {
  x: number;
  high: number;
  low: number;
  bodyTop: number;
  bodyBottom: number;
  color: "up" | "down" | "neutral";
}

const COLOR_CLASS: Record<CandleSpec["color"], string> = {
  up: "text-up",
  down: "text-down",
  neutral: "text-text-faint",
};

const BODY_WIDTH = 14;

function Candle({ spec }: { spec: CandleSpec }) {
  const bodyHeight = Math.max(spec.bodyBottom - spec.bodyTop, 1.5);
  return (
    <g className={COLOR_CLASS[spec.color]}>
      <line x1={spec.x} y1={spec.high} x2={spec.x} y2={spec.low} stroke="currentColor" strokeWidth={2} />
      <rect x={spec.x - BODY_WIDTH / 2} y={spec.bodyTop} width={BODY_WIDTH} height={bodyHeight} fill="currentColor" />
    </g>
  );
}

// Koordinaten in einem 0-65 hohen Zeichenraum (y waechst nach unten, wie in
// SVG ueblich) -- rein illustrativ, keine echte Kerzen-Geometrie.
const PATTERN_CANDLES: Record<string, CandleSpec[]> = {
  doji: [{ x: 60, high: 8, low: 50, bodyTop: 27, bodyBottom: 31, color: "neutral" }],
  hammer: [{ x: 60, high: 8, low: 58, bodyTop: 10, bodyBottom: 20, color: "up" }],
  hanging_man: [{ x: 60, high: 8, low: 58, bodyTop: 10, bodyBottom: 20, color: "down" }],
  bullish_engulfing: [
    { x: 40, high: 20, low: 40, bodyTop: 25, bodyBottom: 35, color: "down" },
    { x: 80, high: 10, low: 50, bodyTop: 15, bodyBottom: 45, color: "up" },
  ],
  bearish_engulfing: [
    { x: 40, high: 20, low: 40, bodyTop: 25, bodyBottom: 35, color: "up" },
    { x: 80, high: 10, low: 50, bodyTop: 15, bodyBottom: 45, color: "down" },
  ],
  morning_star: [
    { x: 25, high: 8, low: 48, bodyTop: 10, bodyBottom: 45, color: "down" },
    { x: 60, high: 45, low: 55, bodyTop: 48, bodyBottom: 52, color: "neutral" },
    { x: 95, high: 12, low: 53, bodyTop: 15, bodyBottom: 50, color: "up" },
  ],
  evening_star: [
    { x: 25, high: 10, low: 45, bodyTop: 10, bodyBottom: 45, color: "up" },
    { x: 60, high: 5, low: 15, bodyTop: 8, bodyBottom: 12, color: "neutral" },
    { x: 95, high: 15, low: 50, bodyTop: 15, bodyBottom: 50, color: "down" },
  ],
};

export function CandlestickPatternIllustration({ pattern }: { pattern: string }) {
  const candles = PATTERN_CANDLES[pattern];
  if (!candles) return null;

  return (
    <svg viewBox="0 0 120 65" className="w-28 h-16 mx-auto" role="img" aria-label={`Schematische Darstellung: ${pattern}`}>
      {candles.map((spec, i) => (
        <Candle key={i} spec={spec} />
      ))}
    </svg>
  );
}
