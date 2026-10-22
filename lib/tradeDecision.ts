// Trade-Entscheider: Tobys Regelwerk als Folge echter Fragen (Zonen,
// Richtung, Ort, Bestaetigung, Risiko, Perp-Check). Sobald eine Antwort
// gegen den Trade spricht (stop, wait, late), endet die Pruefung.
// Schwellen sind Faustregeln aus dem Regelwerk, keine validierten Signale.

export type Side = "long" | "short";
export type Outcome = "ok" | "warn" | "stop" | "wait" | "late" | "info";
export type Answers = Record<string, number>;

export const BLOCKS = ["Zonen", "Richtung", "Ort", "Bestätigung", "Risiko", "Perp-Check"] as const;

export const MIN_CRV = 1.5;
export const LATE_PROGRESS = 0.5;

export interface StepOption {
  label: string;
  outcome: Outcome;
  note?: string;
}

export interface QuestionStep {
  id: string;
  block: number;
  kind: "question";
  when?: (a: Answers) => boolean;
  q: (side: Side, a: Answers) => string;
  hint: (side: Side) => string;
  options: (side: Side) => StepOption[];
}

export interface RiskStep {
  id: "risk";
  block: number;
  kind: "risk";
}

export type Step = QuestionStep | RiskStep;

const L = (side: Side, long: string, short: string) => (side === "long" ? long : short);

export const STEPS: Step[] = [
  {
    id: "zDaily", block: 0, kind: "question",
    q: () => "Hast du im Tageschart die nächste Zone über und unter dem Preis eingezeichnet?",
    hint: () => "Letzte klare Hochs und Tiefs, an denen der Preis scharf gedreht hat. Als Zone vom Docht bis zum Kerzenkörper.",
    options: () => [
      { label: "Ja", outcome: "ok" },
      { label: "Nein", outcome: "wait", note: "Zuerst die Zonen einzeichnen: Tageschart, dann 4H, dann 1H." },
    ],
  },
  {
    id: "z4h", block: 0, kind: "question",
    q: () => "Hast du im 4H-Chart die Range-Ränder oder das letzte Ausbruchslevel markiert?",
    hint: () => "Höchstens 5–6 Zonen insgesamt. Lösche Zonen, die der Preis ohne Reaktion durchlaufen hat.",
    options: () => [
      { label: "Ja", outcome: "ok" },
      { label: "Nein", outcome: "wait", note: "Ohne 4H-Zonen weisst du nicht, wo dein Ziel liegt." },
    ],
  },
  {
    id: "zStrength", block: 0, kind: "question",
    q: () => "Hat die Zone, an der du handeln willst, schon einmal eine starke Reaktion ausgelöst?",
    hint: () => "Stark heisst: ein schneller, grosser Abprall. Zwei oder drei Berührungen bestätigen die Zone.",
    options: () => [
      { label: "Ja, klar sichtbar", outcome: "ok" },
      { label: "Nein, sie ist neu oder nur leicht berührt", outcome: "warn", note: "Schwache Zone: kleinere Position." },
    ],
  },
  {
    id: "zPlan", block: 0, kind: "question",
    q: () => "Kannst du in einem Satz sagen, wo du Longs suchst, wo Shorts und wo du nichts tust?",
    hint: () => "Zum Beispiel: „Über 82'200 Longs am Retest, unter 81'600 Shorts, dazwischen nichts.“",
    options: () => [
      { label: "Ja", outcome: "ok" },
      { label: "Nein", outcome: "warn", note: "Plan vor dem Trade aufschreiben, nicht währenddessen." },
    ],
  },
  {
    id: "trend", block: 1, kind: "question",
    q: (s) => L(s, "Macht der 4H-Chart höhere Hochs und höhere Tiefs?", "Macht der 4H-Chart tiefere Hochs und tiefere Tiefs?"),
    hint: () => "Vergleiche auf 4H die letzten zwei Hochs und die letzten zwei Tiefs miteinander.",
    options: (s) => [
      { label: "Ja", outcome: "ok" },
      { label: "Nein, er läuft seitwärts (Range)", outcome: "ok", note: "Range: nur an den Rändern handeln." },
      {
        label: L(s, "Nein, er macht tiefere Hochs und Tiefs", "Nein, er macht höhere Hochs und Tiefs"),
        outcome: "stop",
        note: L(s, "Gegen den 4H-Trend: kein Long.", "Gegen den 4H-Trend: kein Short."),
      },
    ],
  },
  {
    id: "rangeEdge", block: 1, kind: "question", when: (a) => a.trend === 1,
    q: (s) => L(s, "Steht der Preis an der Unterkante der Range?", "Steht der Preis an der Oberkante der Range?"),
    hint: () => "Teile die Range gedanklich in drei Teile. Gehandelt wird nur im äussersten Drittel.",
    options: (s) => [
      { label: "Ja", outcome: "ok", note: L(s, "Ziel ist die Mitte oder die Oberkante.", "Ziel ist die Mitte oder die Unterkante.") },
      { label: "Nein, er ist in der Mitte", outcome: "stop", note: "In der Mitte einer Range gibt es keinen Trade." },
    ],
  },
  {
    id: "breakout", block: 1, kind: "question", when: (a) => a.trend === 0,
    q: (s) =>
      L(
        s,
        "Hat eine 4H-Kerze mit dem Körper über dem Keylevel geschlossen?",
        "Hat eine 4H-Kerze mit dem Körper unter dem Keylevel geschlossen?"
      ),
    hint: () => "Nur der Körper zählt. Ein Docht über das Level ist noch kein Ausbruch.",
    options: () => [
      { label: "Ja", outcome: "ok" },
      { label: "Nein, nur ein Docht", outcome: "stop", note: "Kein gültiger Ausbruch, also auch kein Retest-Einstieg." },
      { label: "Die 4H-Kerze ist noch offen", outcome: "wait", note: "Warten bis zum Schluss der 4H-Kerze." },
    ],
  },
  {
    id: "d13", block: 1, kind: "question",
    q: (s) => L(s, "Liegt der Preis über der Tages-EMA 13 (D13)?", "Liegt der Preis unter der Tages-EMA 13 (D13)?"),
    hint: () => "Die D13 zeigt die Richtung auf Tagesbasis.",
    options: () => [
      { label: "Ja", outcome: "ok" },
      { label: "Nein", outcome: "warn", note: "Trade gegen D13: nur bewusst und als Warnung notiert." },
    ],
  },
  {
    id: "atLevel", block: 2, kind: "question",
    q: (s, a) =>
      a.trend === 1
        ? L(
            s,
            "Ist der Preis jetzt an der Range-Unterkante (höchstens ±0,25 % entfernt)?",
            "Ist der Preis jetzt an der Range-Oberkante (höchstens ±0,25 % entfernt)?"
          )
        : "Ist der Preis jetzt zum Ausbruchslevel zurückgekommen (höchstens ±0,25 % entfernt)?",
    hint: () => "Bei 82'000 sind ±0,25 % etwa ±200 USD.",
    options: (s) => [
      { label: "Ja", outcome: "ok" },
      {
        label: L(s, "Nein, er ist noch deutlich darüber", "Nein, er ist noch deutlich darunter"),
        outcome: "wait",
        note: "Warten, bis er zum Level kommt. Nicht hinterherlaufen.",
      },
      {
        label: L(s, "Nein, er ist schon darunter gefallen", "Nein, er ist schon darüber gestiegen"),
        outcome: "stop",
        note: "Level verloren: Die Idee ist falsch.",
      },
    ],
  },
  {
    id: "confluence", block: 2, kind: "question",
    q: () => "Gibt es am Level noch einen zweiten Grund?",
    hint: () => "Zum Beispiel VWAP, eine starke Volumenstufe, eine Range-Kante oder ein rundes Level.",
    options: () => [
      { label: "Ja", outcome: "ok", note: "Konfluenz: mehrere Gründe am selben Ort." },
      { label: "Nein, nur das Level", outcome: "warn", note: "Nur ein Grund: kleinere Position oder auslassen." },
    ],
  },
  {
    id: "h1close", block: 3, kind: "question",
    q: (s) =>
      L(
        s,
        "Hat eine 1H-Kerze am Level geschlossen, und zwar über dem Level?",
        "Hat eine 1H-Kerze am Level geschlossen, und zwar unter dem Level?"
      ),
    hint: () => "Das ist der Retest. Docht ans Level ist gut, der Schluss muss auf der richtigen Seite liegen.",
    options: (s) => [
      { label: "Ja", outcome: "ok" },
      { label: "Noch nicht, die 1H-Kerze läuft noch", outcome: "wait", note: "Warten bis zum Schluss der 1H-Kerze." },
      { label: L(s, "Nein, Schluss unter dem Level", "Nein, Schluss über dem Level"), outcome: "stop", note: "Retest gescheitert." },
    ],
  },
  {
    id: "m15", block: 3, kind: "question",
    q: () => "Hat eine 15m-Bestätigungskerze am Level geschlossen, und ist auch die Folgekerze geschlossen?",
    hint: (s) =>
      L(
        s,
        "Bestätigungskerze: Docht nach unten ans Level, Schluss deutlich darüber.",
        "Bestätigungskerze: Docht nach oben ans Level, Schluss deutlich darunter."
      ),
    options: () => [
      { label: "Ja, beide geschlossen", outcome: "ok" },
      { label: "Nur die Bestätigungskerze", outcome: "wait", note: "Einstieg erst nach Schluss der Folgekerze." },
      { label: "Nein, noch keine Bestätigung", outcome: "wait", note: "Das Level allein ist kein Signal." },
    ],
  },
  {
    id: "absorption", block: 3, kind: "question",
    q: (s) =>
      L(
        s,
        "Wurden am Level Verkäufe aufgefangen, also viel Verkaufsdruck, aber kein neues Tief?",
        "Wurden am Level Käufe aufgefangen, also viel Kaufdruck, aber kein neues Hoch?"
      ),
    hint: () => "Im Footprint oder im Volume Delta: grosser Balken gegen dich, der Preis bewegt sich trotzdem nicht weiter.",
    options: (s) => [
      { label: "Ja, Absorption sichtbar", outcome: "ok", note: "Starke Bestätigung." },
      { label: "Weiss nicht, kein Footprint", outcome: "info", note: "Kein Muss, aber ein Plus, wenn sichtbar." },
      {
        label: L(s, "Nein, Verkäufer drücken weiter durch", "Nein, Käufer drücken weiter durch"),
        outcome: "stop",
        note: "Das Level wird gerade gebrochen.",
      },
    ],
  },
  { id: "risk", block: 4, kind: "risk" },
  {
    id: "funding", block: 5, kind: "question",
    q: (s) => L(s, "Ist das Funding hoch (ab 0,03 % pro 8 h)?", "Ist das Funding stark negativ (ab −0,03 % pro 8 h)?"),
    hint: () => "Funding-Kachel im Dashboard. Wenn ja, bist du Teil der überfüllten Seite.",
    options: () => [
      { label: "Nein", outcome: "ok" },
      { label: "Ja", outcome: "warn", note: "Überfüllte Seite: kleinere Position, enger managen." },
    ],
  },
  {
    id: "crowd", block: 5, kind: "question",
    q: (s) => L(s, "Ist die Masse stark long (ab 65 % der Konten)?", "Ist die Masse mehrheitlich short (unter 50 % long)?"),
    hint: () => "Funding-Kachel, Zeile Positionierung, Wert „Masse long“.",
    options: () => [
      { label: "Nein", outcome: "ok" },
      { label: "Ja", outcome: "warn", note: "Viele kleine Konten auf deiner Seite: Treibstoff für die Gegenbewegung." },
    ],
  },
  {
    id: "macro", block: 5, kind: "question",
    q: () => "Kommen in den nächsten 30 Minuten wichtige Makro-Termine (CPI, FOMC, Arbeitsmarkt)?",
    hint: () => "Wirtschaftskalender im Dashboard.",
    options: () => [
      { label: "Nein", outcome: "ok" },
      { label: "Ja", outcome: "wait", note: "Erst nach dem Termin und der ersten Reaktion einsteigen." },
    ],
  },
  {
    id: "rsi", block: 5, kind: "question",
    q: (s) => L(s, "Ist der 15m-RSI schon wieder über 65?", "Ist der 15m-RSI schon wieder unter 35?"),
    hint: () => "Dann ist die Abkühlung vorbei, und du würdest hinterherlaufen.",
    options: () => [
      { label: "Nein", outcome: "ok" },
      { label: "Ja", outcome: "late", note: "Die Bewegung ist schon gelaufen." },
    ],
  },
  {
    id: "losses", block: 5, kind: "question",
    q: () => "Hast du heute schon zwei Verluste in Folge?",
    hint: () => "Nach zwei Verlusten in Folge ist Schluss für heute.",
    options: () => [
      { label: "Nein", outcome: "ok" },
      { label: "Ja", outcome: "stop", note: "Schluss für heute. Morgen ist ein neuer Markt." },
    ],
  },
];

export interface RiskInput {
  level: number | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  account: number | null;
  riskPct: number | null;
  /** true = freie Bahn bis zum Ziel, false = Widerstand dazwischen, null = noch nicht beantwortet. */
  clearPath: boolean | null;
}

export interface RiskCalc {
  riskPts: number;
  reward: number;
  crv: number | null;
  progress: number | null;
  stopBehind: boolean;
  sizeBtc: number | null;
}

export function calcRisk(side: Side, r: RiskInput): RiskCalc | null {
  const { level, entry, stop, target } = r;
  if (level === null || entry === null || stop === null || target === null) return null;
  const dir = side === "long" ? 1 : -1;
  const riskPts = (entry - stop) * dir;
  const reward = (target - entry) * dir;
  const span = (target - level) * dir;
  return {
    riskPts,
    reward,
    crv: riskPts > 0 ? reward / riskPts : null,
    progress: span > 0 ? ((entry - level) * dir) / span : null,
    stopBehind: (level - stop) * dir > 0,
    sizeBtc: r.account && r.riskPct && riskPts > 0 ? (r.account * r.riskPct) / 100 / riskPts : null,
  };
}

export interface LogEntry {
  stepId: string;
  block: number;
  q: string;
  a: string;
  outcome: Outcome;
  note: string;
}

const fmt = (n: number, d = 0) => n.toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d });

export function riskEntries(side: Side, r: RiskInput, c: RiskCalc): LogEntry[] {
  const out: LogEntry[] = [];
  const base = { stepId: "risk", block: 4 };
  out.push({
    ...base,
    q: L(side, "Liegt der Stop unter dem Level, also dort, wo die Idee falsch ist?", "Liegt der Stop über dem Level, also dort, wo die Idee falsch ist?"),
    a: c.stopBehind ? "Ja" : "Nein",
    outcome: c.stopBehind ? "ok" : "stop",
    note: c.stopBehind ? "" : "Stop auf der falschen Seite des Levels.",
  });
  const late = c.progress !== null && c.progress > LATE_PROGRESS;
  out.push({
    ...base,
    q: "Ist der Preis schon mehr als die Hälfte vom Level zum Ziel gelaufen?",
    a: c.progress === null ? "—" : `${late ? "Ja" : "Nein"} (${fmt(Math.max(c.progress, 0) * 100)} %)`,
    outcome: late ? "late" : "ok",
    note: late ? "Zu spät: Der beste Teil ist vorbei." : "",
  });
  const crvOk = c.crv !== null && c.crv >= MIN_CRV;
  out.push({
    ...base,
    q: "Ist das Chance-Risiko mindestens 1,5?",
    a: c.crv === null ? "—" : `${crvOk ? "Ja" : "Nein"} (${fmt(c.crv, 1)})`,
    outcome: crvOk ? "ok" : late ? "late" : "stop",
    note: crvOk ? "" : late ? "Wegen des späten Einstiegs." : "Ziel zu nah oder Stop zu weit: kein Trade.",
  });
  if (r.clearPath !== null) {
    out.push({
      ...base,
      q: L(side, "Liegt zwischen Einstieg und Ziel kein Widerstand?", "Liegt zwischen Einstieg und Ziel keine Unterstützung?"),
      a: r.clearPath ? "Ja, freie Bahn" : "Nein, es liegt einer dazwischen",
      outcome: r.clearPath ? "ok" : "warn",
      note: r.clearPath ? "" : "Ziel auf dieses Level setzen und das Chance-Risiko neu rechnen.",
    });
  }
  return out;
}

const ENDS: Outcome[] = ["stop", "wait", "late"];

export interface WalkState {
  log: LogEntry[];
  current: Step | null;
}

/** Laeuft die Fragen ab, bis eine offen ist oder eine Antwort den Trade beendet. */
export function walk(side: Side, answers: Answers, risk: RiskInput, riskDone: boolean): WalkState {
  const log: LogEntry[] = [];
  for (const s of STEPS) {
    if (s.kind === "risk") {
      const c = calcRisk(side, risk);
      if (!riskDone || !c) return { log, current: s };
      const entries = riskEntries(side, risk, c);
      log.push(...entries);
      if (entries.some((e) => ENDS.includes(e.outcome))) return { log, current: null };
      continue;
    }
    if (s.when && !s.when(answers)) continue;
    const idx = answers[s.id];
    if (idx === undefined) return { log, current: s };
    const opt = s.options(side)[idx];
    log.push({ stepId: s.id, block: s.block, q: s.q(side, answers), a: opt.label, outcome: opt.outcome, note: opt.note ?? "" });
    if (ENDS.includes(opt.outcome)) return { log, current: null };
  }
  return { log, current: null };
}

export type VerdictKind = "open" | "trade" | "caution" | "stop" | "wait" | "late";

export interface Verdict {
  kind: VerdictKind;
  title: string;
  text: string;
  list: string[];
}

export function verdict(side: Side, state: WalkState, risk: RiskInput): Verdict {
  const { log, current } = state;
  const first = (k: Outcome) => log.find((e) => e.outcome === k);
  const warns = log.filter((e) => e.outcome === "warn").map((e) => e.note);
  if (current) {
    return { kind: "open", title: "Noch offen", text: `Beantworte die nächste Frage (${BLOCKS[current.block]}).`, list: warns };
  }
  const stop = first("stop");
  if (stop) return { kind: "stop", title: "Kein Trade", text: stop.note, list: [] };
  const wait = first("wait");
  if (wait) {
    return {
      kind: "wait",
      title: "Warten",
      text: wait.note,
      list: ["Wenn sich die Lage ändert: die Frage im Protokoll antippen und neu beantworten."],
    };
  }
  const late = first("late");
  if (late) {
    return { kind: "late", title: "Zu spät", text: late.note, list: ["Nächste Gelegenheit abwarten. Ein verpasster Trade kostet nichts."] };
  }
  const c = calcRisk(side, risk);
  const sizeLine =
    c?.sizeBtc && risk.account && risk.riskPct
      ? `Positionsgrösse bei ${fmt(risk.riskPct, 1)} % Risiko auf ${fmt(risk.account)} USD: ${fmt(c.sizeBtc, 3)} BTC (Stop-Abstand ${fmt(c.riskPts)} USD).`
      : null;
  if (warns.length >= 2) {
    return {
      kind: "caution",
      title: "Grenzwertig: auslassen oder halbe Grösse",
      text: `${warns.length} Warnungen. Alle Pflichtpunkte sind erfüllt, aber einiges spricht dagegen.`,
      list: [...warns, ...(c?.sizeBtc ? [`Bei halber Grösse: ${fmt(c.sizeBtc / 2, 3)} BTC.`] : [])],
    };
  }
  return {
    kind: "trade",
    title: L(side, "Long: Trade erlaubt", "Short: Trade erlaubt"),
    text: "Alle Fragen sprechen für den Trade. Einstieg, Stop und Ziel wie berechnet setzen.",
    list: [...warns, ...(sizeLine ? [sizeLine] : [])],
  };
}

/** Antworten ab einem Schritt verwerfen (beim Aendern einer frueheren Antwort). */
export function clearFrom(stepId: string, answers: Answers): { answers: Answers; resetRisk: boolean } {
  const idx = STEPS.findIndex((s) => s.id === stepId);
  const next: Answers = {};
  let resetRisk = false;
  STEPS.forEach((s, i) => {
    if (i < idx && s.kind === "question" && answers[s.id] !== undefined) next[s.id] = answers[s.id];
    if (i >= idx && s.kind === "risk") resetRisk = true;
  });
  return { answers: next, resetRisk };
}
