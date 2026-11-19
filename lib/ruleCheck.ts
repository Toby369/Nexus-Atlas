import { intervalMs, type Candle } from "./candles";
import { ENTRY_LEVEL_TOLERANCE_PCT } from "./tpStandard";
import { nearestZones, stopBehindZone, zoneHigh, zoneLow, type ZoneLevel } from "./zones";

// Regelcheck im Dashboard (Toby 22.10.2026, Teil 2 des neuen Layouts): die
// Pflichtfragen des Trade-Entscheiders, von Nexus aus den Kerzen beantwortet.
//   1. 4H-Koerperschluss ueber/unter einem Keylevel (Regelwerk Punkt 1)
//   2. 1H-Retest bis +-0,25 % ans Level, Schluss auf der Ausbruchsseite (Punkt 2)
//   3. 15m-Bestaetigungskerze plus geschlossene Folgekerze (Punkt 3)
//   4. Naechstes Ziel mindestens 1 % entfernt (TP-Standard, Punkt 9)
// D13 entfiel am 27.10.2026 (Toby).
// Gesucht wird der juengste Koerperausbruch in den uebergebenen 4H-Kerzen.

export type Side = "long" | "short";
export type CheckAnswer = "ja" | "nein" | "offen";

export interface RuleCheckRow {
  id: "break4h" | "retest1h" | "confirm15m" | "distance";
  question: string;
  answer: CheckAnswer;
  /** Kurzer Wert im Antwort-Chip, z.B. "Ja" oder "+0,6 %". */
  label: string;
  detail: string;
}

export interface RuleCheckResult {
  side: Side | null;
  level: number | null;
  /** Stop hinter der gebrochenen Zone in % vom Einstieg (Einstieg = Zonenkante). */
  stopPct: number | null;
  rows: RuleCheckRow[];
  /** short = eine Zeile fuer die eingeklappte Kachel. */
  verdict: { tone: "trade" | "wait" | "stop"; short: string; text: string };
}

export interface RuleCheckInput {
  levels: ZoneLevel[];
  price: number | null;
  /** Abgeschlossene Kerzen, aelteste zuerst. */
  candles4h: Candle[];
  candles1h: Candle[];
  candles15m: Candle[];
}

export const MIN_TARGET_DISTANCE_PCT = 1;

const SHORT_STOP: Record<RuleCheckRow["id"], string> = {
  break4h: "kein 4H-Ausbruch",
  retest1h: "Retest gescheitert",
  confirm15m: "Bestätigung gescheitert",
  distance: "Ziel unter 1 %",
};
const SHORT_OPEN: Record<RuleCheckRow["id"], string> = {
  break4h: "4H-Schluss abwarten",
  retest1h: "1H-Retest abwarten",
  confirm15m: "15m-Bestätigung abwarten",
  distance: "Ziel prüfen",
};

const fmt = (n: number, d = 0) => n.toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d });
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });

export interface BodyBreak {
  side: Side;
  level: number;
  candle: Candle;
  zone: ZoneLevel;
}

/**
 * Juengster 4H-Koerperausbruch: zwei aufeinanderfolgende Schlusskurse liegen auf
 * verschiedenen Seiten einer Zonenkante -- Long ueber die Oberkante, Short unter
 * die Unterkante. Bei einer Linie ist beides der Preis.
 */
export function findLatestBodyBreak(levels: ZoneLevel[], candles: Candle[]): BodyBreak | null {
  for (let i = candles.length - 1; i >= 1; i--) {
    const prev = candles[i - 1].close;
    const last = candles[i];
    const crossed = levels
      .flatMap((l): BodyBreak[] => {
        const top = zoneHigh(l);
        const bottom = zoneLow(l);
        if (prev < top && last.close > top) return [{ side: "long", level: top, candle: last, zone: l }];
        if (prev > bottom && last.close < bottom) return [{ side: "short", level: bottom, candle: last, zone: l }];
        return [];
      })
      .sort((a, b) => Math.abs(a.level - last.close) - Math.abs(b.level - last.close));
    if (crossed.length > 0) return crossed[0];
  }
  return null;
}

const after = (candles: Candle[], fromMs: number) => candles.filter((c) => new Date(c.openTime).getTime() >= fromMs);

export function evaluateRuleCheck(input: RuleCheckInput): RuleCheckResult {
  const { levels, price, candles4h, candles1h, candles15m } = input;
  const brk = findLatestBodyBreak(levels, candles4h);
  const tol = ENTRY_LEVEL_TOLERANCE_PCT / 100;
  const rows: RuleCheckRow[] = [];

  if (!brk) {
    const { above, below } = nearestZones(levels, price, 1);
    const targets = [
      above[0] ? `über ${fmt(above[0].price)}` : null,
      below[0] ? `unter ${fmt(below[0].price)}` : null,
    ].filter(Boolean);
    rows.push({
      id: "break4h",
      question: "Schloss eine 4H-Kerze mit dem Körper über oder unter einem Level?",
      answer: "nein",
      label: "Nein",
      detail: `Kein Körperschluss über ein Keylevel in den letzten ${Math.max(candles4h.length - 1, 0) * 4} Stunden.`,
    });
    return {
      side: null,
      level: null,
      stopPct: null,
      rows,
      verdict: {
        tone: "wait",
        short: "Warten: kein 4H-Ausbruch",
        text:
          targets.length > 0
            ? `Kein gültiges Setup. Warten auf einen 4H-Körperschluss ${targets.join(" oder ")}.`
            : "Kein gültiges Setup. Keine Keylevels in der Nähe.",
      },
    };
  }

  const { side, level, candle } = brk;
  const dir = side === "long" ? 1 : -1;
  const sideWord = side === "long" ? "über" : "unter";
  rows.push({
    id: "break4h",
    question: `Schloss eine 4H-Kerze mit dem Körper ${sideWord} ${fmt(level)}?`,
    answer: "ja",
    label: "Ja",
    detail: `4H-Kerze ${time(candle.openTime)} Uhr schloss bei ${fmt(candle.close)}.`,
  });

  // 1H-Retest: erste 1H-Kerze nach dem Ausbruch, die bis +-0,25 % ans Level kommt.
  const breakEndMs = new Date(candle.openTime).getTime() + intervalMs("4h");
  const touchesZone = (c: Candle) => (side === "long" ? c.low <= level * (1 + tol) : c.high >= level * (1 - tol));
  const closesOnSide = (c: Candle) => (c.close - level) * dir > 0;
  const retest = after(candles1h, breakEndMs).find(touchesZone) ?? null;
  const distNowPct = price !== null ? ((price - level) / level) * 100 * dir : null;
  if (retest && closesOnSide(retest)) {
    rows.push({
      id: "retest1h",
      question: `Kam der 1H-Retest bis ±0,25 % an ${fmt(level)} und schloss ${sideWord} dem Level?`,
      answer: "ja",
      label: "Ja",
      detail: `1H-Kerze ${time(retest.openTime)} Uhr, Schluss ${fmt(retest.close)}.`,
    });
  } else if (retest) {
    rows.push({
      id: "retest1h",
      question: `Kam der 1H-Retest bis ±0,25 % an ${fmt(level)} und schloss ${sideWord} dem Level?`,
      answer: "nein",
      label: "Nein",
      detail: `1H-Kerze ${time(retest.openTime)} Uhr schloss bei ${fmt(retest.close)}: Retest gescheitert.`,
    });
  } else {
    rows.push({
      id: "retest1h",
      question: `Kam der 1H-Retest bis ±0,25 % an ${fmt(level)} und schloss ${sideWord} dem Level?`,
      answer: "offen",
      label: "Offen",
      detail:
        distNowPct === null
          ? "Noch kein Retest."
          : Math.abs(distNowPct) <= ENTRY_LEVEL_TOLERANCE_PCT
            ? `Kurs ${fmt(price!)} ist im Retest-Band. Warten auf den 1H-Schluss.`
            : `Kurs ${fmt(price!)} liegt ${fmt(Math.abs(distNowPct), 1)} % ${distNowPct >= 0 ? sideWord : side === "long" ? "unter" : "über"} dem Level. Warten, nicht hinterherlaufen.`,
    });
  }

  // 15m-Bestaetigung: Kerze mit Docht in die Zone und Schluss auf der Ausbruchsseite
  // in Tradesrichtung, danach eine geschlossene Folgekerze, die ebenfalls dort schliesst.
  let confirm: RuleCheckRow = {
    id: "confirm15m",
    question: "Steht auf 15m eine Bestätigungskerze mit geschlossener Folgekerze?",
    answer: "offen",
    label: "Offen",
    detail: "Erst nach dem 1H-Retest.",
  };
  if (retest && closesOnSide(retest)) {
    const m15 = after(candles15m, new Date(retest.openTime).getTime());
    const idx = m15.findIndex((c) => touchesZone(c) && closesOnSide(c) && (c.close - c.open) * dir > 0);
    if (idx === -1) {
      confirm = { ...confirm, detail: "Noch keine Bestätigungskerze am Level." };
    } else if (idx === m15.length - 1) {
      confirm = { ...confirm, detail: `Bestätigungskerze ${time(m15[idx].openTime)} Uhr steht, Folgekerze läuft noch.` };
    } else if (closesOnSide(m15[idx + 1])) {
      confirm = {
        ...confirm,
        answer: "ja",
        label: "Ja",
        detail: `Bestätigung ${time(m15[idx].openTime)} Uhr, Folgekerze ${time(m15[idx + 1].openTime)} Uhr.`,
      };
    } else {
      confirm = {
        ...confirm,
        answer: "nein",
        label: "Nein",
        detail: `Folgekerze ${time(m15[idx + 1].openTime)} Uhr schloss auf der falschen Seite.`,
      };
    }
  }
  rows.push(confirm);

  // Abstand zum naechsten Ziel in Traderichtung (ab Kurs).
  const { above, below } = nearestZones(levels, price, 1);
  const target = side === "long" ? above[0] : below[0];
  if (!target) {
    rows.push({
      id: "distance",
      question: "Liegt das nächste Ziel mindestens 1 % entfernt?",
      answer: "ja",
      label: "Frei",
      detail: `Kein Keylevel ${side === "long" ? "darüber" : "darunter"}.`,
    });
  } else {
    const ok = target.distancePct >= MIN_TARGET_DISTANCE_PCT;
    rows.push({
      id: "distance",
      question: "Liegt das nächste Ziel mindestens 1 % entfernt?",
      answer: ok ? "ja" : "nein",
      label: `${fmt(target.distancePct, 1)} %`,
      detail: `Nächstes Ziel ${fmt(target.price)}${ok ? "." : ": zu nah, kein Trade."}`,
    });
  }

  const stop = rows.find((r) => r.answer === "nein");
  const open = rows.find((r) => r.answer === "offen");
  const sideLabel = side === "long" ? "Long" : "Short";
  let verdict: RuleCheckResult["verdict"];
  if (stop) verdict = { tone: "stop", short: `Kein ${sideLabel}: ${SHORT_STOP[stop.id]}`, text: `Kein ${sideLabel}: ${stop.detail}` };
  else if (open)
    verdict = {
      tone: "wait",
      short: `${sideLabel} ${sideWord} ${fmt(level)}: ${SHORT_OPEN[open.id]}`,
      text: `${sideLabel} ${sideWord} ${fmt(level)} möglich. Warten: ${open.detail}`,
    };
  else
    verdict = {
      tone: "trade",
      short: `${sideLabel}-Setup steht`,
      // Nexus-Keylevels sind nur der Abgleich, massgebend ist Tobys eigener Chart.
      text: `${sideLabel}-Setup steht. Mit deinem Chart abgleichen, Veto prüfen, dann Einstieg nach Plan.`,
    };
  return { side, level, stopPct: stopBehindZone(side, brk.zone, level).stopPct, rows, verdict };
}
