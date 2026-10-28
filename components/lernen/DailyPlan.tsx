"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { fetchOwnZones } from "@/lib/ownZones";
import { summarizePositioning } from "@/lib/positioning";
import type { PositioningSnapshot } from "@/lib/types";
import {
  MAX_SCENARIOS,
  MAX_ZONES,
  SCENARIO_LETTERS,
  STEP_MINUTES,
  STEP_NAMES,
  checkScenario,
  currentStep,
  defaultConfirm,
  emptyPlan,
  fmt,
  newScenario,
  noTradeSuggestion,
  normalizePlan,
  num,
  perpVerdict,
  planText,
  resolvedZones,
  trendText,
  zoneLabel,
  zonesFromOwn,
  type DailyPlanData,
  type Direction,
  type FundingState,
  type OiMove,
  type PlanZone,
  type Scenario,
} from "@/lib/dailyPlan";

// Tagesplan: fester Morgen-Ablauf (20 Min.) mit Wenn-Dann-Plan am Ende.
// Ein Plan pro Tag in daily_plans; Lesen per Anon-Key, Schreiben ueber
// /api/daily-plan. Live-Werte schlagen Preis, Funding, Masse und OI vor.

const SAVE_DELAY_MS = 1200;
const HISTORY_DAYS = 14;
const EXCHANGES = ["binance", "bybit", "okx", "bitget"];

export interface DailyPlanLive {
  price: number | null;
  fundingRatePct: number | null;
}

interface LiveSuggestion {
  price: string;
  funding: FundingState | null;
  crowd: string;
  gap: string;
  oi: OiMove | null;
  oiChangePct: number | null;
}

function todayZurich(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date());
}

async function fetchLiveSuggestion(live: DailyPlanLive): Promise<LiveSuggestion> {
  const snaps = await Promise.all(
    EXCHANGES.map(async (ex) => {
      const { data } = await supabase
        .from("positioning_snapshots")
        .select("*")
        .eq("exchange", ex)
        .eq("status", "ok")
        .order("timestamp_utc", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as PositioningSnapshot | null) ?? null;
    })
  );
  const pos = summarizePositioning(snaps, snaps[0]);
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [{ data: nowRow }, { data: thenRow }] = await Promise.all([
    supabase.from("market_snapshots").select("open_interest").eq("exchange", "binance").order("timestamp_utc", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("market_snapshots").select("open_interest").eq("exchange", "binance").lte("timestamp_utc", since).order("timestamp_utc", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const oiNow = Number(nowRow?.open_interest);
  const oiThen = Number(thenRow?.open_interest);
  const oiChangePct = oiNow > 0 && oiThen > 0 ? ((oiNow - oiThen) / oiThen) * 100 : null;
  const f = live.fundingRatePct;
  return {
    price: live.price ? String(Math.round(live.price)) : "",
    funding: f === null ? null : f < 0 ? "neg" : f > 0.0100001 ? "high" : "base",
    crowd: pos ? String(Math.round(pos.crowdLongPct)) : "",
    gap: pos?.divergencePp != null ? String(Math.round(pos.divergencePp)) : "",
    oi: oiChangePct === null ? null : oiChangePct > 1 ? "up" : oiChangePct < -1 ? "down" : "flat",
    oiChangePct,
  };
}

function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T | null;
  options: { v: T; label: string }[];
  onChange: (v: T | null) => void;
  label: string;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-md border border-border overflow-hidden" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(value === o.v ? null : o.v)}
          className={`px-2.5 py-1 text-xs border-r border-border last:border-r-0 ${
            value === o.v ? "bg-accent/15 text-accent" : "text-text-faint hover:text-text-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Step({ n, title, minutes, active, children }: { n: number; title: string; minutes: number; active: boolean; children: ReactNode }) {
  return (
    <section className={`rounded-md border bg-surface-raised p-3 space-y-2.5 ${active ? "border-accent/60" : "border-border"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-text">
          <span className="font-mono text-accent mr-2">{n}</span>
          {title}
        </p>
        <span className="text-[10px] uppercase tracking-[0.12em] text-text-faint">{minutes} Min</span>
      </div>
      {children}
    </section>
  );
}

function Q({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-text">{label}</p>
      {children}
      {hint && <p className="text-[11px] text-text-faint">{hint}</p>}
    </div>
  );
}

const inputCls = "bg-surface border border-border rounded-md px-2 py-1 text-sm text-text min-w-0";
const numCls = `${inputCls} font-mono w-28`;

export default function DailyPlan({ live }: { live: DailyPlanLive }) {
  const [date, setDate] = useState<string>(todayZurich);
  const [plan, setPlan] = useState<DailyPlanData | null>(null);
  const [history, setHistory] = useState<{ plan_date: string; data: DailyPlanData }[]>([]);
  const [ownPrices, setOwnPrices] = useState<number[]>([]);
  const [suggestion, setSuggestion] = useState<LiveSuggestion | null>(null);
  const [status, setStatus] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  // Datum, zu dem der geladene Plan gehoert. Gespeichert wird immer dorthin,
  // nie unter einem inzwischen gewaehlten anderen Datum.
  const planDate = useRef(date);

  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from("daily_plans")
      .select("plan_date, data")
      .order("plan_date", { ascending: false })
      .limit(HISTORY_DAYS);
    setHistory((data ?? []).map((r) => ({ plan_date: r.plan_date as string, data: normalizePlan(r.data) })));
    return data ?? [];
  }, []);

  // Plan des gewaehlten Tages laden; gibt es keinen, neuer Plan mit den
  // Zonen des letzten Plans und den Live-Vorschlaegen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: row }, recent, own, sug] = await Promise.all([
        supabase.from("daily_plans").select("data").eq("plan_date", date).maybeSingle(),
        loadHistory(),
        fetchOwnZones(),
        fetchLiveSuggestion(live),
      ]);
      if (cancelled) return;
      setOwnPrices(own.map((z) => z.price));
      setSuggestion(sug);
      planDate.current = date;
      if (row?.data) {
        setPlan(normalizePlan(row.data));
        setStatus("Gespeicherter Plan geladen.");
      } else {
        const prev = recent.find((r) => (r.plan_date as string) < date);
        const fresh = emptyPlan(prev ? normalizePlan(prev.data).zones : []);
        setPlan({ ...fresh, price: sug.price, funding: sug.funding, crowd: sug.crowd, gap: sug.gap, oi: sug.oi });
        setStatus(prev ? "Neuer Tag: Zonen vom letzten Plan übernommen, Live-Werte eingesetzt." : "Neuer Plan mit Live-Werten.");
      }
      dirty.current = false;
    })();
    return () => {
      cancelled = true;
    };
    // live absichtlich nicht als Abhaengigkeit: Vorschlaege nur beim Laden eines Tages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, loadHistory]);

  const save = useCallback(
    async (d: string, p: DailyPlanData) => {
      setStatus("Speichere…");
      try {
        const res = await fetch("/api/daily-plan", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: d, data: p }),
        });
        const json = await res.json().catch(() => ({}));
        setStatus(res.ok && json.success ? "Gespeichert." : `Nicht gespeichert: ${json.error ?? res.status}`);
        if (res.ok) loadHistory();
      } catch {
        setStatus("Nicht gespeichert: keine Verbindung.");
      }
    },
    [loadHistory]
  );

  // Automatisch speichern, kurz nach der letzten Aenderung.
  useEffect(() => {
    if (!plan || !dirty.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const d = planDate.current;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      dirty.current = false;
      save(d, plan);
    }, SAVE_DELAY_MS);
  }, [plan, save]);

  // Tag wechseln: ausstehende Aenderungen zuerst unter dem alten Datum sichern.
  function changeDate(d: string) {
    if (!d || d === date) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      if (plan && dirty.current) save(planDate.current, plan);
    }
    dirty.current = false;
    setPlan(null);
    setDate(d);
  }

  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const update = (patch: Partial<DailyPlanData>) => {
    dirty.current = true;
    setPlan((p) => (p ? { ...p, ...patch } : p));
  };
  const updateZone = (i: number, patch: Partial<PlanZone>) =>
    plan && update({ zones: plan.zones.map((z, j) => (j === i ? { ...z, ...patch } : z)) });
  const updateScen = (i: number, patch: Partial<Scenario>) =>
    plan && update({ scens: plan.scens.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  if (!plan) {
    return (
      <div className="rounded-lg border border-border bg-surface p-3">
        <p className="text-xs text-text-faint">Lade Tagesplan…</p>
      </div>
    );
  }

  const step = startedAt === null ? undefined : currentStep((now - startedAt) / 60_000);
  const activeStep = step === undefined || step === null ? -1 : step.index;
  const price = num(plan.price);
  const zones = resolvedZones(plan);
  const verdict = perpVerdict(plan);
  const text = planText(date, plan);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Plan kopiert.");
    } catch {
      setStatus("Kopieren ging nicht. Text im Feld markieren und kopieren.");
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-text">Tagesplan · jeden Morgen, 20 Minuten</p>
          <p className="text-[11px] text-text-faint">
            Fünf Schritte, am Ende ein Wenn-Dann-Plan mit Alarmen. Danach Chart zu, zurück nur bei Alarm.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="dp-date"
            type="date"
            value={date}
            onChange={(e) => changeDate(e.target.value)}
            className={inputCls}
            aria-label="Datum"
          />
          <button
            type="button"
            onClick={() => {
              setStartedAt(Date.now());
              setNow(Date.now());
            }}
            className="text-[11px] px-2 py-1 rounded border border-accent/40 text-accent"
          >
            {startedAt === null ? "20-Min-Ablauf starten" : "Neu starten"}
          </button>
        </div>
      </div>

      <div className="space-y-1" aria-live="polite">
        <div className="grid gap-1" style={{ gridTemplateColumns: STEP_MINUTES.map((m) => `${m}fr`).join(" ") }}>
          {STEP_MINUTES.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded ${
                startedAt === null ? "bg-border" : step === null || i < activeStep ? "bg-accent" : i === activeStep ? "bg-accent/50" : "bg-border"
              }`}
            />
          ))}
        </div>
        <p className="text-[11px] text-text-muted">
          {startedAt === null
            ? "Ablauf noch nicht gestartet."
            : step === null
            ? "20 Minuten um. Alarme setzen, Chart zu."
            : `Schritt ${step!.index + 1}: ${STEP_NAMES[step!.index]} · noch ${Math.floor(step!.leftMinutes)}:${String(
                Math.floor((step!.leftMinutes % 1) * 60)
              ).padStart(2, "0")} Min.`}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-3 min-w-0">
          <Step n={1} title="Termine (Wirtschaftskalender)" minutes={2} active={activeStep === 0}>
            <Q label="Gibt es heute wichtige Termine (CPI, FOMC, Arbeitsmarkt, Fed-Reden)?">
              <Seg label="Termine" value={plan.events} onChange={(v) => update({ events: v })} options={[{ v: "nein", label: "Nein" }, { v: "ja", label: "Ja" }]} />
            </Q>
            {plan.events === "ja" && (
              <Q label="Wann ist Sperrzeit? (30 Min. vorher bis 30 Min. nachher)">
                <input id="dp-block" value={plan.block} onChange={(e) => update({ block: e.target.value })} placeholder="z. B. 14:00–15:00 CPI" className={`${inputCls} w-full`} />
              </Q>
            )}
          </Step>

          <Step n={2} title="Tageschart" minutes={5} active={activeStep === 1}>
            <Q label="Wo steht der Preis jetzt?" hint={live.price ? `Nexus: ${fmt(live.price)}` : undefined}>
              <input id="dp-price" inputMode="decimal" value={plan.price} onChange={(e) => update({ price: e.target.value })} className={numCls} />
            </Q>
            <Q label="Was macht der Tageschart?" hint="Vergleiche die letzten zwei Tageshochs und die letzten zwei Tagestiefs.">
              <Seg
                label="Tageschart"
                value={plan.trend}
                onChange={(v) => update({ trend: v })}
                options={[
                  { v: "up", label: "Höhere Hochs und Tiefs" },
                  { v: "down", label: "Tiefere Hochs und Tiefs" },
                  { v: "range", label: "Seitwärts (Range)" },
                ]}
              />
            </Q>
            <p className="text-xs text-text-muted border-t border-border/60 pt-2">
              Ergebnis: <span className="text-text">{trendText(plan)}</span>
            </p>
          </Step>

          <Step n={3} title="Zonen (4H + Fixed Range Volume)" minutes={5} active={activeStep === 2}>
            <p className="text-[11px] text-text-faint">
              Bestehende Zonen prüfen, nicht alles neu zeichnen. Höchstens {MAX_ZONES}, benannt nach ihrer heutigen Rolle.
            </p>
            <div className="space-y-1.5">
              {plan.zones.map((z, i) => (
                <div key={i} className="grid grid-cols-[6.5rem_6rem_6rem_minmax(0,1fr)_auto] gap-1.5 items-center max-sm:grid-cols-3">
                  <select id={`dp-z-role-${i}`} value={z.role} onChange={(e) => updateZone(i, { role: e.target.value as PlanZone["role"] })} className={inputCls} aria-label="Rolle">
                    <option value="sell">Verkäufer</option>
                    <option value="buy">Käufer</option>
                  </select>
                  <input id={`dp-z-lo-${i}`} inputMode="decimal" placeholder="von" value={z.lo} onChange={(e) => updateZone(i, { lo: e.target.value })} className={`${inputCls} font-mono`} aria-label="von" />
                  <input id={`dp-z-hi-${i}`} inputMode="decimal" placeholder="bis" value={z.hi} onChange={(e) => updateZone(i, { hi: e.target.value })} className={`${inputCls} font-mono`} aria-label="bis" />
                  <input id={`dp-z-note-${i}`} placeholder="Grund, z. B. Range-Oberkante" value={z.note} onChange={(e) => updateZone(i, { note: e.target.value })} className={`${inputCls} max-sm:col-span-2`} aria-label="Notiz" />
                  <button type="button" onClick={() => update({ zones: plan.zones.filter((_, j) => j !== i) })} className="text-[11px] px-2 py-1 rounded border border-border text-text-faint" aria-label="Zone löschen">
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={plan.zones.length >= MAX_ZONES}
                onClick={() => update({ zones: [...plan.zones, { role: "sell", lo: "", hi: "", note: "" }] })}
                className="text-[11px] px-2 py-0.5 rounded border border-border text-text-muted disabled:opacity-40"
              >
                + Zone
              </button>
              {ownPrices.length > 0 && (
                <button
                  type="button"
                  onClick={() => update({ zones: zonesFromOwn(ownPrices, price).slice(0, MAX_ZONES) })}
                  className="text-[11px] px-2 py-0.5 rounded border border-border text-text-muted"
                >
                  Eigene Zonen aus der Zonen-Kachel übernehmen ({ownPrices.length})
                </button>
              )}
            </div>
            <Q label="Wo liegt der POC (meistes Volumen) im Fixed Range Volume?">
              <input id="dp-poc" inputMode="decimal" value={plan.poc} onChange={(e) => update({ poc: e.target.value })} className={numCls} />
            </Q>
            <div className="border-t border-border/60 pt-2 space-y-0.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Zonen-Leiter</p>
              {(() => {
                const rows: ReactNode[] = [];
                let placed = price === null;
                for (const z of zones) {
                  if (!placed && z.hi < price!) {
                    rows.push(<PriceRow key="price" price={price!} />);
                    placed = true;
                  }
                  const edge = price === null ? null : z.lo > price ? z.lo : z.hi < price ? z.hi : price;
                  const dist = price === null || edge === null ? null : ((edge - price) / price) * 100;
                  rows.push(
                    <div key={z.index} className="grid grid-cols-[1.2em_minmax(0,1fr)_auto] gap-2 text-xs px-1.5 py-0.5">
                      <span className={z.role === "sell" ? "text-down" : "text-up"}>{z.role === "sell" ? "▼" : "▲"}</span>
                      <span className="text-text-muted">{zoneLabel(z)}</span>
                      <span className="font-mono text-text-faint">{dist === null ? "" : `${dist >= 0 ? "+" : ""}${fmt(dist, 1)} %`}</span>
                    </div>
                  );
                }
                if (!placed && price !== null) rows.push(<PriceRow key="price" price={price} />);
                return rows.length ? rows : <p className="text-[11px] text-text-faint">Zonen und Preis eintragen.</p>;
              })()}
            </div>
          </Step>

          <Step n={4} title="Perp-Lage (Funding-Kachel, Marktkontext)" minutes={3} active={activeStep === 3}>
            {suggestion && (
              <p className="text-[11px] text-accent">
                Nexus jetzt: Funding {suggestion.funding === "base" ? "im Grundwert" : suggestion.funding === "high" ? "über 0,01 %" : suggestion.funding === "neg" ? "negativ" : "—"}, Masse{" "}
                {suggestion.crowd || "—"} % long, Abstand {suggestion.gap || "—"} Pp, OI 24h{" "}
                {suggestion.oiChangePct === null ? "—" : `${suggestion.oiChangePct >= 0 ? "+" : ""}${fmt(suggestion.oiChangePct, 1)} %`}.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => update({ funding: suggestion.funding, crowd: suggestion.crowd, gap: suggestion.gap, oi: suggestion.oi })}
                >
                  übernehmen
                </button>
              </p>
            )}
            <Q label="Wo liegt das Funding?">
              <Seg label="Funding" value={plan.funding} onChange={(v) => update({ funding: v })} options={[{ v: "base", label: "Im Grundwert" }, { v: "high", label: "Über 0,01 %" }, { v: "neg", label: "Negativ" }]} />
            </Q>
            <div className="flex flex-wrap gap-4">
              <Q label="Wie viel Prozent der Masse ist long?">
                <input id="dp-crowd" inputMode="decimal" value={plan.crowd} onChange={(e) => update({ crowd: e.target.value })} className={numCls} />
              </Q>
              <Q label="Abstand Top-Trader minus Masse (Pp)?">
                <input id="dp-gap" inputMode="decimal" value={plan.gap} onChange={(e) => update({ gap: e.target.value })} className={numCls} />
              </Q>
            </div>
            <Q label="Wie hat sich das Open Interest in 24 h bewegt?">
              <Seg label="Open Interest" value={plan.oi} onChange={(v) => update({ oi: v })} options={[{ v: "up", label: "Gestiegen" }, { v: "flat", label: "Kaum" }, { v: "down", label: "Gefallen" }]} />
            </Q>
            <Q label="Wer hat die letzte Bewegung getrieben? (Wer treibt: Spot, Perp, Coinbase)">
              <Seg label="Treiber" value={plan.driver} onChange={(v) => update({ driver: v })} options={[{ v: "spot", label: "Spot" }, { v: "perp", label: "Perp (Hebel)" }, { v: "none", label: "Unklar" }]} />
            </Q>
            <div className="text-xs text-text-muted border-t border-border/60 pt-2">
              Ergebnis: <span className="text-text">{verdict.text}</span>
              {verdict.reasons.length > 0 && (
                <ul className="list-disc pl-4 mt-1 space-y-0.5 text-[11px]">
                  {verdict.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          </Step>

          <Step n={5} title="Plan schreiben" minutes={5} active={activeStep === 4}>
            <p className="text-[11px] text-text-faint">
              Ein Szenario kommt nur auf den Plan, wenn das Chance-Risiko mindestens 1,5 ist. Ziel ist immer die nächste Zone.
            </p>
            {plan.scens.map((sc, i) => (
              <ScenarioEditor
                key={i}
                letter={SCENARIO_LETTERS[i]}
                plan={plan}
                sc={sc}
                index={i}
                onChange={(patch) => updateScen(i, patch)}
                onRemove={() => update({ scens: plan.scens.filter((_, j) => j !== i) })}
              />
            ))}
            <button
              type="button"
              disabled={plan.scens.length >= MAX_SCENARIOS}
              onClick={() => update({ scens: [...plan.scens, newScenario("long")] })}
              className="text-[11px] px-2 py-0.5 rounded border border-border text-text-muted disabled:opacity-40"
            >
              + Szenario
            </button>
            <Q label="Wo machst du heute nichts?">
              <input
                id="dp-notrade"
                value={plan.notrade}
                onChange={(e) => update({ notrade: e.target.value })}
                placeholder={noTradeSuggestion(plan) || "z. B. zwischen 79'600 und 81'000"}
                className={`${inputCls} w-full`}
              />
            </Q>
          </Step>

          <section className="rounded-md border border-border bg-surface-raised p-3 space-y-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-text">Abends: Rückblick</p>
              <span className="text-[10px] uppercase tracking-[0.12em] text-text-faint">5 Min</span>
            </div>
            <Q label="Ist eines deiner Szenarien eingetreten?">
              <Seg
                label="Eingetreten"
                value={plan.happened}
                onChange={(v) => update({ happened: v })}
                options={[...plan.scens.map((_, i) => ({ v: SCENARIO_LETTERS[i] as DailyPlanData["happened"] & string, label: SCENARIO_LETTERS[i] })), { v: "keins", label: "Keins" }]}
              />
            </Q>
            <Q label="Hast du dich an den Plan gehalten?">
              <Seg label="Eingehalten" value={plan.kept} onChange={(v) => update({ kept: v })} options={[{ v: "ja", label: "Ja" }, { v: "nein", label: "Nein" }]} />
            </Q>
            <Q label="Was lernst du daraus? (eine Zeile)">
              <textarea id="dp-review" value={plan.review} onChange={(e) => update({ review: e.target.value })} className={`${inputCls} w-full min-h-[3rem]`} />
            </Q>
          </section>
        </div>

        <div className="space-y-3 min-w-0 lg:sticky lg:top-3 self-start">
          <div className="rounded-md border border-border bg-surface-raised p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Dein Plan</p>
              <button type="button" onClick={copy} className="text-[11px] px-2 py-0.5 rounded border border-border text-text-muted">
                Kopieren
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-text">{text}</pre>
            <p className="text-[11px] text-text-faint" aria-live="polite">
              {status}
            </p>
          </div>
          <div className="rounded-md border border-border bg-surface-raised p-3 space-y-1">
            <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Letzte Pläne</p>
            {history.length === 0 && <p className="text-[11px] text-text-faint">Noch keine gespeichert.</p>}
            {history.map((h) => {
              const onPlan = h.data.scens.filter((s) => checkScenario(h.data, s).onPlan).length;
              return (
                <button
                  key={h.plan_date}
                  type="button"
                  onClick={() => changeDate(h.plan_date)}
                  className={`flex w-full justify-between gap-2 rounded px-1.5 py-1 text-left text-[11px] hover:bg-surface ${
                    h.plan_date === date ? "text-accent" : "text-text-muted"
                  }`}
                >
                  <span className="font-mono">{h.plan_date.split("-").reverse().join(".")}</span>
                  <span>
                    {onPlan} auf dem Plan · {h.data.happened ? `eingetreten: ${h.data.happened}` : "offen"}
                    {h.data.kept ? ` · eingehalten: ${h.data.kept}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <p className="text-[10px] text-text-faint">Lernwerkzeug nach deinem Regelwerk, keine Anlageberatung.</p>
    </div>
  );
}

function PriceRow({ price }: { price: number }) {
  return (
    <div className="grid grid-cols-[1.2em_minmax(0,1fr)_auto] gap-2 text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent">
      <span>▸</span>
      <span>Preis jetzt</span>
      <span className="font-mono">{fmt(price)}</span>
    </div>
  );
}

function ScenarioEditor({
  letter,
  plan,
  sc,
  index,
  onChange,
  onRemove,
}: {
  letter: string;
  plan: DailyPlanData;
  sc: Scenario;
  index: number;
  onChange: (patch: Partial<Scenario>) => void;
  onRemove: () => void;
}) {
  const c = checkScenario(plan, sc);
  const zones = resolvedZones(plan);
  const setDir = (dir: Direction) => {
    if (dir === sc.dir) return;
    onChange({ dir, confirm: sc.confirm === defaultConfirm(sc.dir) || !sc.confirm ? defaultConfirm(dir) : sc.confirm });
  };
  return (
    <div className="rounded-md border border-border bg-surface p-2.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text">Szenario {letter}</span>
          <Seg label={`Richtung ${letter}`} value={sc.dir} onChange={(v) => v && setDir(v)} options={[{ v: "long", label: "Long" }, { v: "short", label: "Short" }]} />
        </div>
        <div className="flex items-center gap-2">
          {!c.ready ? (
            <span className="rounded-full border border-accent/40 px-2 py-0.5 text-[11px] text-accent">unvollständig</span>
          ) : c.onPlan ? (
            <span className="rounded-full border border-up/40 px-2 py-0.5 text-[11px] text-up">auf den Plan · CRV {fmt(c.crv, 1)}</span>
          ) : (
            <span className="rounded-full border border-down/40 px-2 py-0.5 text-[11px] text-down">
              kommt nicht auf den Plan · CRV {fmt(c.crv, 1)}
            </span>
          )}
          <button type="button" onClick={onRemove} className="text-[11px] px-2 py-0.5 rounded border border-border text-text-faint" aria-label={`Szenario ${letter} löschen`}>
            ✕
          </button>
        </div>
      </div>
      <Q label="An welcher Zone?">
        <select id={`dp-sc-zone-${index}`} value={sc.zone} onChange={(e) => onChange({ zone: e.target.value })} className={`${inputCls} w-full`}>
          <option value="">Zone wählen</option>
          {zones.map((z) => (
            <option key={z.index} value={String(z.index)}>
              {zoneLabel(z)}
            </option>
          ))}
        </select>
      </Q>
      <Q label="Was muss dort passieren, bevor du einsteigst?">
        <input id={`dp-sc-confirm-${index}`} value={sc.confirm} onChange={(e) => onChange({ confirm: e.target.value })} className={`${inputCls} w-full`} />
      </Q>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["entry", "Einstieg"],
            ["stop", "Stop"],
            ["target", "Ziel (nächste Zone)"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} htmlFor={`dp-sc-${k}-${index}`} className="space-y-1 block min-w-0">
            <span className="text-[11px] text-text-faint">{label}</span>
            <input id={`dp-sc-${k}-${index}`} inputMode="decimal" value={sc[k]} onChange={(e) => onChange({ [k]: e.target.value })} className={`${inputCls} font-mono w-full`} />
          </label>
        ))}
      </div>
      <Q label="Wann ist das Szenario ungültig?">
        <input id={`dp-sc-invalid-${index}`} value={sc.invalid} onChange={(e) => onChange({ invalid: e.target.value })} placeholder="z. B. 4H-Schluss über 81'300" className={`${inputCls} w-full`} />
      </Q>
      {c.ready && (
        <p className="text-[11px] text-text-faint">
          Risiko {fmt(c.risk)} · Chance {fmt(c.reward)}
        </p>
      )}
      {c.problems.length > 0 && (
        <ul className="list-disc pl-4 text-[11px] space-y-0.5">
          {c.problems.map((p) => (
            <li key={p.text} className={p.blocking ? "text-down" : "text-accent"}>
              {p.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
