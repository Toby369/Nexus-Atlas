"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { ChecklistRun, KnowledgeBaseEntry } from "@/lib/types";
import type { MeinSystemChecklistData } from "@/lib/meinSystemContext";
import type { CvdFootprintData, GussSignalData, VwapVectorData } from "@/lib/tradingIndicatorsContext";
import type { ChartStructureData } from "@/lib/chartStructureContext";
import type { LevelStructureZone } from "@/lib/levelStructureContext";
import { CvdFootprintCard, GussSignalCard, VwapVectorCard } from "@/components/TradingIndicatorsCards";
import ChartStructureCard from "@/components/ChartStructureCard";
import LevelStructureCard from "@/components/LevelStructureCard";
import GrundlagenPanel from "@/components/lernen/GrundlagenPanel";
import PositionSizeCalculator from "@/components/lernen/grundlagen/PositionSizeCalculator";

// --- Wissen (Grundlagen/Welz/Salomon/Mein System/Orderflow) ---------------
// Nachschlage-Sektion aus knowledge_base (statischer Text, siehe
// lib/knowledgeBaseContext.ts) + vier Checklisten. Der Checkbox-Zustand ist
// bewusst nur lokaler React-State -- eine Momentaufnahme je Aufruf.

type WissenModule = "grundlagen" | "welz" | "salomon" | "mein_system" | "orderflow";

const WELZ_CHECKLIST = [
  "Trading-Journal ist aktuell geführt",
  "Positionsgrösse ist regelkonform festgelegt (nicht emotional)",
  "Kein FOMO- oder Revenge-Impuls erkennbar",
  "Handelsplan ist schriftlich vor Entry fixiert (if-X-then-Y)",
  'Setup wurde nicht bewusst "passend gesucht" (Confirmation-Bias-Check)',
];

const SALOMON_CHECKLIST = [
  "Aktuelle Phase bestimmt (Akkumulation/Markup/Markdown/Distribution)",
  "Candlestick-Signal an relevantem Level vorhanden",
  "Trendstruktur eindeutig (HH/HL vs. LH/LL, kein Seitwärts-Chop)",
  "Multi-Timeframe-Konfluenz geprüft (höherer Zeitrahmen bestätigt)",
];

// Entry-Regelwerk plus Perp-Check: vor jedem Einstieg die Gegenseite
// benennen. Kontrakte sind immer 50:50 -- die Frage ist, wer nach dem Entry
// aus seiner Position muss und warum. Werte stehen in den Dashboard-Kacheln
// Funding (inkl. Positionierung), Marktkontext ("Wer treibt"), ETF
// (Termin-Basis) und Liquidations-/Hebelkarte.
const MEIN_SYSTEM_SECTIONS: { title: string; items: string[] }[] = [
  {
    title: "1 · Setup",
    items: [
      "4H-Ausbruch: Kerzenkörper schliesst über/unter einem Keylevel (Docht allein zählt nicht)",
      "1H-Retest: bis ±0,25 % ans Level, Schluss auf der Ausbruchsseite",
      "15m-Entry: Bestätigungskerze am Retest-Level, Einstieg nach Schluss der Folgekerze",
      "D13 (Tages-EMA 13) geprüft – Trade gegen D13 nur bewusst, als Warnung notiert",
      "Keylevel-Konfluenz vorhanden",
      "RSI-/MACD-Divergenz auf 1H/4H/1D geprüft (nur Hinweis/Warnung, siehe Lagebild)",
    ],
  },
  {
    title: "2 · Perp-Check (Gegenseite)",
    items: [
      "Funding nicht hoch/extrem in meiner Richtung – sonst bin ich Teil der überfüllten Seite",
      "Positionierung: Masse nicht stark auf meiner Seite; für einen Long kein Abstand ≤ 0 (Top-Trader weniger long als die Masse)",
      "Wer treibt: Bewegung in meine Richtung ist von Spot getragen, nicht nur Perp-Hebel",
      "Coinbase-Prämie widerspricht meiner Richtung nicht über Stunden",
      "Gegenseite benannt: Wessen Stops/Liquidationen liegen in meinem Ziel, und warum muss er raus?",
      "Mein Stop liegt nicht mitten in einem Liquidations-Cluster meiner eigenen Seite",
      "Kein Deribit-/CME-Verfall (Freitag) und kein Makro-Termin im Trade-Fenster ohne Plan",
    ],
  },
];
const MEIN_SYSTEM_MANUAL_CHECKLIST = MEIN_SYSTEM_SECTIONS.flatMap((s) => s.items);

// Orderflow-4-Schritte (Video Chris Creamer, "Robbins Cup"-Strategie). Als
// Prozess-Disziplin gedacht, NICHT als belegter Edge: der Backtest
// (docs/research/ORDERFLOW-4-SCHRITTE-RESULTS_2026-10-14.md und
// ORDERFLOW-VARIANTEN-B-C-RESULTS_2026-10-14.md) fand auf BTC-Perps keinen
// Vorteil, Ort- und Umfeld-Filter brachten in keinem Lauf einen Mehrwert.
const ORDERFLOW_SECTIONS: { title: string; items: string[] }[] = [
  {
    title: "1 · Umfeld",
    items: [
      "Struktur auf 4h/1h bestimmt (höhere Hochs/Tiefs, tiefere oder Range)",
      "Handelsrichtung für heute festgelegt – oder bewusst kein Trade",
      "Volatilitäts-Lage geprüft (DVOL-Perzentil, Implizit vs. realisiert, Skew)",
      "Funding nicht extrem gegen meine Richtung (keine überfüllte Seite)",
    ],
  },
  {
    title: "2 · Ort",
    items: [
      "VWAP, Value Area (VAH/POC/VAL) und letzte Hochs/Tiefs eingezeichnet",
      "Long nur im Discount (unter VWAP/VAL), Short nur im Premium",
      "Kurs ist tatsächlich in der Zone – sonst warten",
    ],
  },
  {
    title: "3 · Bestätigung",
    items: [
      "Absorption sichtbar: neues Extrem mit starkem Gegen-Delta, Kerze schliesst weg vom Extrem",
      "Dominanzwechsel: kein neues Extrem mehr, Delta dreht, Schluss über/unter der Absorptionskerze",
      "Einstieg erst nach der Bestätigung, nicht beim ersten Kontakt mit der Zone",
    ],
  },
  {
    title: "4 · Risiko",
    items: [
      "Stop hinter dem gescheiterten Extrem (+ kleiner Puffer)",
      "Ziel 1 (POC/VWAP) und Ziel 2 (Swing / anderer VA-Rand) gesetzt",
      "Chance-Risiko mindestens 1,5 bis Ziel 1 – sonst kein Trade",
      "Positionsgrösse aus dem Risiko berechnet, nicht aus dem Bauch",
      "Heute noch keine 2 Verluste in Folge (sonst Schluss für heute)",
    ],
  },
];
const ORDERFLOW_CHECKLIST = ORDERFLOW_SECTIONS.flatMap((s) => s.items);

function OrderflowIntro() {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3 space-y-1.5">
      <p className="text-xs font-medium text-text">Orderflow in 4 Schritten</p>
      <p className="text-xs text-text-muted">
        Umfeld → Ort → Bestätigung → Risiko. Jeder Schritt filtert, der nächste kommt erst, wenn der vorherige erfüllt
        ist. Ein Trade ist gut ausgeführt, wenn alle Punkte erfüllt waren – unabhängig davon, wie er ausgeht.
      </p>
      <p className="text-xs text-text-muted">
        Die Checkliste ist ein Prozess-Raster, kein belegter Vorteil: Im Nexus-Backtest auf BTC-Perps (2022–2026) war
        das Setup nicht profitabel, und Ort- und Umfeld-Filter haben in keiner Variante geholfen. Nach der Bestätigung
        liegt der Kurs oft schon so nah am Ziel, dass das Chance-Risiko nicht mehr aufgeht – genau das prüft der
        letzte Block.
      </p>
      <p className="text-[10px] text-text-faint">
        Quelle: Video „Trading World Champion Reveals the Orderflow Strategy“ (Chris Creamer); Backtest siehe
        docs/research/ORDERFLOW-*.
      </p>
    </div>
  );
}

// Der Haken-Zustand bleibt lokaler State (kein Autosave pro Klick); ein
// "Fertig"-Klick schreibt einen Snapshot nach checklist_runs (siehe
// /api/checklist/runs). Nur "wann wie vollstaendig durchgegangen" -- bewusst
// kein Trade-Journal.
function ChecklistBlock({
  title,
  items,
  module,
  history,
  onSaved,
  sections,
}: {
  title: string;
  items: string[];
  module: WissenModule;
  history: ChecklistRun[];
  onSaved: () => void;
  // Optionale Zwischentitel: die Punkte stehen in `items` in derselben Reihenfolge.
  sections?: { title: string; items: string[] }[];
}) {
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const doneCount = Object.values(checked).filter(Boolean).length;
  const sectionStarts = new Map<number, string>();
  let offset = 0;
  for (const section of sections ?? []) {
    sectionStarts.set(offset, section.title);
    offset += section.items.length;
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const checkedItems = items.filter((_, i) => checked[i]);
      await fetch("/api/checklist/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module, checkedItems, totalCount: items.length }),
      });
      setChecked({});
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-text-muted">
          {title} ({doneCount}/{items.length})
        </p>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="shrink-0 text-[10px] px-2 py-0.5 rounded border border-accent/40 text-accent disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? "Speichern…" : "Fertig"}
        </button>
      </div>
      {items.map((item, i) => {
        const heading = sectionStarts.get(i);
        return (
          <div key={i}>
            {heading && (
              <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint pt-1.5">{heading}</p>
            )}
            <label className="flex items-start gap-2 text-xs text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={checked[i] ?? false}
                onChange={(e) => setChecked((prev) => ({ ...prev, [i]: e.target.checked }))}
                className="mt-0.5"
              />
              <span className={checked[i] ? "line-through text-text-faint" : ""}>{item}</span>
            </label>
          </div>
        );
      })}
      {history.length > 0 && (
        <div className="pt-1.5 mt-1.5 border-t border-border/60 space-y-0.5">
          <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Verlauf</p>
          {history.map((run) => {
            const full = run.checked_count === run.total_count && run.total_count > 0;
            const empty = run.checked_count === 0;
            return (
              <div key={run.id} className="flex items-center justify-between text-[10px] text-text-faint">
                <span>
                  {new Date(run.created_at).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })}{" "}
                  {new Date(run.created_at).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className={full ? "text-up" : empty ? "text-down" : "text-text-muted"}>
                  {run.checked_count}/{run.total_count}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KnowledgeSections({ entries }: { entries: KnowledgeBaseEntry[] }) {
  const bySection = useMemo(() => {
    const map = new Map<string, KnowledgeBaseEntry[]>();
    for (const e of entries) {
      const list = map.get(e.section) ?? [];
      list.push(e);
      map.set(e.section, list);
    }
    return Array.from(map.entries());
  }, [entries]);

  if (bySection.length === 0) return <p className="text-xs text-text-faint">Keine Einträge.</p>;

  return (
    <div className="space-y-3">
      {bySection.map(([section, sectionEntries]) => (
        <div key={section} className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">{section}</p>
          {sectionEntries.map((e) => (
            <div key={e.id} className="rounded-lg border border-border bg-surface-raised p-3">
              <p className="text-xs font-medium text-text">{e.title}</p>
              <p className="text-xs text-text-muted mt-0.5 whitespace-pre-line">{e.content}</p>
              {e.source && <p className="text-[10px] text-text-faint mt-1">Quelle: {e.source}</p>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function formatPct(value: number | null, digits = 3): string {
  return value === null ? "—" : `${value.toFixed(digits)}%`;
}

function MeinSystemLiveValues({ data }: { data: MeinSystemChecklistData }) {
  const fundingOk = data.fundingUnderThreshold;
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3 space-y-1.5">
      <p className="text-xs font-medium text-text-muted">
        Live-Werte {data.dataAsOf && <span className="text-text-faint">(Stand market_states)</span>}
      </p>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-faint">Funding aktuell (Schwelle 0,05%/8h)</span>
        <span className={fundingOk === null ? "text-text-faint" : fundingOk ? "text-up" : "text-down"}>
          {/* Regelwerk 14.10.2026: Funding ueber der Schwelle warnt gegen die ueberfuellte Seite, sperrt aber nicht. */}
          {formatPct(data.fundingRatePct)}{" "}
          {fundingOk !== null &&
            (fundingOk ? "✓ unter Schwelle" : `⚠ Warnung gegen ${(data.fundingRatePct ?? 0) > 0 ? "Long" : "Short"}`)}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-faint">OI-Delta (1h)</span>
        <span className="text-text">
          {formatPct(data.oiDeltaPct, 2)}{" "}
          {data.oiPriceDirection === 1 ? "↑" : data.oiPriceDirection === -1 ? "↓" : ""}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-faint">EMA D13 / EMA50 / EMA200 (dein System vs. NEXUS-Trend-Regime)</span>
        <span className="text-text">
          {data.ema13?.toFixed(0) ?? "—"} / {data.ema50?.toFixed(0) ?? "—"} / {data.ema200?.toFixed(0) ?? "—"}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-faint">Preis</span>
        <span className="text-text">{data.closePrice?.toFixed(0) ?? "—"}</span>
      </div>
    </div>
  );
}

const CHECKLIST_HISTORY_PER_MODULE = 5;

export default function WissenPanel({
  knowledgeBase,
  meinSystemData,
  initialChecklistHistory,
  gussData,
  vwapVectorData,
  cvdData,
  chartStructureData,
  levelStructureZones,
}: {
  knowledgeBase: KnowledgeBaseEntry[];
  meinSystemData: MeinSystemChecklistData;
  initialChecklistHistory: ChecklistRun[];
  gussData: GussSignalData;
  vwapVectorData: VwapVectorData;
  cvdData: CvdFootprintData;
  chartStructureData: ChartStructureData;
  levelStructureZones: LevelStructureZone[];
}) {
  const [module, setModule] = useState<WissenModule>("grundlagen");
  const [checklistHistory, setChecklistHistory] = useState(initialChecklistHistory);
  const entries = knowledgeBase.filter((e) => e.module === module);

  async function refetchChecklistHistory() {
    const { data } = await supabase
      .from("checklist_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (data) setChecklistHistory(data);
  }

  function historyFor(m: WissenModule): ChecklistRun[] {
    return checklistHistory.filter((r) => r.module === m).slice(0, CHECKLIST_HISTORY_PER_MODULE);
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 flex-wrap">
        {([
          { id: "grundlagen", label: "Grundlagen" },
          { id: "welz", label: "Welz (Psychologie)" },
          { id: "salomon", label: "Salomon (Chartanalyse)" },
          { id: "mein_system", label: "Mein System" },
          { id: "orderflow", label: "Orderflow (4 Schritte)" },
        ] as { id: WissenModule; label: string }[]).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setModule(m.id)}
            className={`px-2.5 py-1 text-xs rounded-md border ${
              module === m.id
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-border text-text-faint hover:text-text-muted"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {module === "grundlagen" ? (
        <GrundlagenPanel liveFundingPct={meinSystemData.fundingRatePct} livePrice={meinSystemData.closePrice} />
      ) : module === "orderflow" ? (
        <OrderflowIntro />
      ) : (
        <KnowledgeSections entries={entries} />
      )}

      {module === "welz" && (
        <ChecklistBlock
          title="Pre-Entry-Checkliste"
          items={WELZ_CHECKLIST}
          module="welz"
          history={historyFor("welz")}
          onSaved={refetchChecklistHistory}
        />
      )}
      {module === "salomon" && (
        <ChecklistBlock
          title="Formationscheck"
          items={SALOMON_CHECKLIST}
          module="salomon"
          history={historyFor("salomon")}
          onSaved={refetchChecklistHistory}
        />
      )}
      {module === "orderflow" && (
        <ChecklistBlock
          title="Orderflow-Checkliste"
          items={ORDERFLOW_CHECKLIST}
          sections={ORDERFLOW_SECTIONS}
          module="orderflow"
          history={historyFor("orderflow")}
          onSaved={refetchChecklistHistory}
        />
      )}
      {module === "mein_system" && (
        <div className="space-y-3">
          <MeinSystemLiveValues data={meinSystemData} />
          <PositionSizeCalculator livePrice={meinSystemData.closePrice} />
          <GussSignalCard data={gussData} />
          <VwapVectorCard data={vwapVectorData} />
          <CvdFootprintCard data={cvdData} />
          <ChartStructureCard data={chartStructureData} />
          <LevelStructureCard zones={levelStructureZones} />
          <ChecklistBlock
            title="Entry-Regelwerk + Perp-Check"
            items={MEIN_SYSTEM_MANUAL_CHECKLIST}
            sections={MEIN_SYSTEM_SECTIONS}
            module="mein_system"
            history={historyFor("mein_system")}
            onSaved={refetchChecklistHistory}
          />
        </div>
      )}
    </div>
  );
}
