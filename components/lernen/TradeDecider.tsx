"use client";

import { useState } from "react";
import {
  BLOCKS,
  STEPS,
  calcRisk,
  clearFrom,
  riskEntries,
  verdict,
  walk,
  type Answers,
  type Outcome,
  type RiskInput,
  type Side,
  type VerdictKind,
} from "@/lib/tradeDecision";
import { FUNDING_ELEVATED_PCT } from "@/lib/fundingLevels";

// Trade-Entscheider: eine Frage nach der anderen, nach Tobys Regelwerk.
// Live-Werte (Preis, Funding) erscheinen als Hinweis bei der
// passenden Frage; beantworten muss Toby selbst.

export interface TradeDeciderLive {
  price: number | null;
  fundingPct: number | null;
}

const MARK: Record<Outcome, string> = { ok: "✓", warn: "!", stop: "✕", wait: "…", late: "↗", info: "·" };
const OUTCOME_TEXT: Record<Outcome, string> = {
  ok: "text-up",
  warn: "text-accent",
  stop: "text-down",
  wait: "text-text",
  late: "text-accent",
  info: "text-text-faint",
};
const VERDICT_STYLE: Record<VerdictKind, string> = {
  open: "border-border text-text-muted",
  trade: "border-up/50 text-up",
  caution: "border-accent/50 text-accent",
  stop: "border-down/50 text-down",
  wait: "border-text-muted/50 text-text",
  late: "border-accent/50 text-accent",
};

const fmt = (n: number, d = 0) => n.toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d });

function parseNum(v: string): number | null {
  const n = parseFloat(v.replace(/'/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const EMPTY_FIELDS = { level: "", entry: "", stop: "", target: "", account: "10000", riskPct: "1" };
type Fields = typeof EMPTY_FIELDS;

function liveHint(stepId: string, side: Side, live: TradeDeciderLive): string | null {
  if (stepId === "funding" && live.fundingPct !== null) {
    const high = side === "long" ? live.fundingPct >= FUNDING_ELEVATED_PCT : live.fundingPct <= -FUNDING_ELEVATED_PCT;
    return `Nexus jetzt: Funding ${fmt(live.fundingPct, 4)} % (Referenzbörse), also eher „${high ? "Ja" : "Nein"}“.`;
  }
  return null;
}

export default function TradeDecider({ live }: { live: TradeDeciderLive }) {
  const [side, setSide] = useState<Side>("long");
  const [answers, setAnswers] = useState<Answers>({});
  const [fields, setFields] = useState<Fields>(() => ({ ...EMPTY_FIELDS, entry: live.price ? String(Math.round(live.price)) : "" }));
  const [clearPath, setClearPath] = useState<boolean | null>(null);
  const [riskDone, setRiskDone] = useState(false);

  const risk: RiskInput = {
    level: parseNum(fields.level),
    entry: parseNum(fields.entry),
    stop: parseNum(fields.stop),
    target: parseNum(fields.target),
    account: parseNum(fields.account),
    riskPct: parseNum(fields.riskPct),
    clearPath,
  };
  const state = walk(side, answers, risk, riskDone);
  const v = verdict(side, state, risk);
  const current = state.current;

  function reset(nextSide: Side = side) {
    setSide(nextSide);
    setAnswers({});
    setFields((f) => ({ ...EMPTY_FIELDS, account: f.account, riskPct: f.riskPct, entry: live.price ? String(Math.round(live.price)) : "" }));
    setClearPath(null);
    setRiskDone(false);
  }

  function answer(stepId: string, idx: number) {
    const { answers: kept } = clearFrom(stepId, answers);
    setAnswers({ ...kept, [stepId]: idx });
  }

  function reopen(stepId: string) {
    const { answers: kept, resetRisk } = clearFrom(stepId, answers);
    setAnswers(kept);
    if (resetRisk) {
      setRiskDone(false);
      setClearPath(null);
    }
  }

  const calc = calcRisk(side, risk);
  const preview = calc ? riskEntries(side, { ...risk, clearPath: null }, calc) : [];

  return (
    <div className="rounded-lg border border-border bg-surface p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-text">Trade-Entscheider</p>
          <p className="text-[11px] text-text-faint">Eine Frage nach der anderen. Spricht eine Antwort gegen den Trade, ist Schluss.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border overflow-hidden" role="group" aria-label="Richtung">
            {(["long", "short"] as Side[]).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={side === s}
                onClick={() => reset(s)}
                className={`px-3 py-1 text-xs border-r border-border last:border-r-0 ${
                  side === s ? "bg-accent/15 text-accent" : "text-text-faint hover:text-text-muted"
                }`}
              >
                {s === "long" ? "Long" : "Short"}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => reset()} className="text-[11px] px-2 py-1 rounded border border-accent/40 text-accent">
            Neu prüfen
          </button>
        </div>
      </div>

      <div className="flex gap-1" aria-hidden>
        {BLOCKS.map((b, i) => (
          <span
            key={b}
            className={`h-1 flex-1 rounded ${
              current && current.block === i ? "bg-accent/60" : (current ? i < current.block : true) ? "bg-accent" : "bg-border"
            }`}
          />
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="rounded-md bg-surface-raised p-3 space-y-3 min-w-0" aria-live="polite">
          <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">
            {current ? `${current.block} · ${BLOCKS[current.block]}` : "Fertig"}
          </p>

          {current?.kind === "question" && (
            <>
              <p className="text-sm font-medium text-text">{current.q(side, answers)}</p>
              <p className="text-xs text-text-muted">{current.hint(side)}</p>
              {liveHint(current.id, side, live) && <p className="text-xs text-accent">{liveHint(current.id, side, live)}</p>}
              <div className="grid gap-1.5">
                {current.options(side).map((o, i) => (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => answer(current.id, i)}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-left text-xs text-text hover:border-accent"
                  >
                    <span>{o.label}</span>
                    <span className={`font-mono ${OUTCOME_TEXT[o.outcome]}`}>{MARK[o.outcome]}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {current?.kind === "risk" && (
            <>
              <p className="text-sm font-medium text-text">Wo liegen Level, Einstieg, Stop und Ziel?</p>
              <p className="text-xs text-text-muted">
                Ziel ist das nächste Level, nicht ein Wunschpreis. Der Stop liegt dort, wo die Idee falsch ist.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["level", "Level (Retest)"],
                    ["entry", "Einstieg"],
                    ["stop", "Stop"],
                    ["target", "Ziel (nächstes Level)"],
                    ["account", "Konto (USD)"],
                    ["riskPct", "Risiko pro Trade (%)"],
                  ] as [keyof Fields, string][]
                ).map(([k, label]) => (
                  <label key={k} htmlFor={`td-${k}`} className="space-y-1 block min-w-0">
                    <span className="text-[11px] text-text-faint">{label}</span>
                    <input
                      id={`td-${k}`}
                      inputMode="decimal"
                      value={fields[k]}
                      onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))}
                      className="w-full bg-surface border border-border rounded-md px-2 py-1 text-sm font-mono text-text"
                    />
                  </label>
                ))}
              </div>
              {preview.length > 0 && (
                <div className="space-y-1">
                  {preview.map((e) => (
                    <p key={e.q} className="text-xs text-text-muted flex gap-2">
                      <span className={`font-mono ${OUTCOME_TEXT[e.outcome]}`}>{MARK[e.outcome]}</span>
                      <span>
                        {e.q} <span className="text-text">{e.a}</span>
                      </span>
                    </p>
                  ))}
                </div>
              )}
              <p className="text-sm font-medium text-text">
                {side === "long"
                  ? "Liegt zwischen Einstieg und Ziel kein Widerstand?"
                  : "Liegt zwischen Einstieg und Ziel keine Unterstützung?"}
              </p>
              <div className="grid gap-1.5">
                {[
                  { val: true, label: "Ja, freie Bahn bis zum Ziel", o: "ok" as Outcome },
                  { val: false, label: "Nein, es liegt einer dazwischen", o: "warn" as Outcome },
                ].map((b) => (
                  <button
                    key={b.label}
                    type="button"
                    disabled={!calc}
                    onClick={() => {
                      setClearPath(b.val);
                      setRiskDone(true);
                    }}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-left text-xs text-text hover:border-accent disabled:opacity-40"
                  >
                    <span>{b.label}</span>
                    <span className={`font-mono ${OUTCOME_TEXT[b.o]}`}>{MARK[b.o]}</span>
                  </button>
                ))}
              </div>
              {!calc && <p className="text-[11px] text-text-faint">Zuerst Level, Einstieg, Stop und Ziel eintragen.</p>}
            </>
          )}

          {!current && (
            <p className="text-xs text-text-muted">
              Fertig. Tippe eine Antwort im Protokoll an, um sie zu ändern, oder prüfe neu.
            </p>
          )}
        </div>

        <div className="space-y-3 min-w-0">
          <div className={`rounded-md border bg-surface-raised p-3 space-y-1.5 ${VERDICT_STYLE[v.kind]}`}>
            <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Ergebnis</p>
            <p className="text-sm font-semibold">{v.title}</p>
            <p className="text-xs text-text-muted">{v.text}</p>
            {v.list.length > 0 && (
              <ul className="list-disc pl-4 text-xs text-text-muted space-y-0.5">
                {v.list.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Deine Antworten · antippen zum Ändern</p>
            {state.log.length === 0 && <p className="text-xs text-text-faint">Noch keine Antworten.</p>}
            {state.log.map((e, i) => (
              <div key={`${e.stepId}-${i}`}>
                {(i === 0 || state.log[i - 1].block !== e.block) && (
                  <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint pt-1.5">
                    {e.block} · {BLOCKS[e.block]}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => reopen(e.stepId)}
                  className="grid w-full grid-cols-[1.2em_minmax(0,1fr)] gap-2 rounded px-1.5 py-1 text-left hover:bg-surface-raised"
                >
                  <span className={`font-mono text-xs ${OUTCOME_TEXT[e.outcome]}`}>{MARK[e.outcome]}</span>
                  <span className="min-w-0">
                    <span className="block text-[11px] text-text-muted">{e.q}</span>
                    <span className="block text-xs text-text">{e.a}</span>
                    {e.note && <span className="block text-[11px] text-text-faint">{e.note}</span>}
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="text-[10px] text-text-faint">
        {STEPS.length - 1} Fragen plus Risiko-Rechnung. Schwellen sind Faustregeln aus deinem Regelwerk, keine Anlageberatung.
      </p>
    </div>
  );
}
