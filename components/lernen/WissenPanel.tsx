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
import PlaybookPanel from "@/components/lernen/PlaybookPanel";

// --- Wissen (Welz/Salomon/Mein System) -------------------------------------
// Nachschlage-Sektion aus knowledge_base (statischer Text, siehe
// lib/knowledgeBaseContext.ts) + drei Checklisten. Der Checkbox-Zustand ist
// bewusst nur lokaler React-State -- eine Momentaufnahme je Aufruf.

type WissenModule = "welz" | "salomon" | "mein_system" | "playbook";

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

const MEIN_SYSTEM_MANUAL_CHECKLIST = [
  "4H-Breakout bestätigt",
  "1H-Retest erfolgt",
  "EMA-D13-Filter erfüllt (Preis vs. EMA13 unten prüfen)",
  "Keylevel-Konfluenz vorhanden",
  "RSI/StochRSI-Divergenz-Check auf 4H",
];

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
}: {
  title: string;
  items: string[];
  module: WissenModule;
  history: ChecklistRun[];
  onSaved: () => void;
}) {
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const doneCount = Object.values(checked).filter(Boolean).length;

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
      {items.map((item, i) => (
        <label key={i} className="flex items-start gap-2 text-xs text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={checked[i] ?? false}
            onChange={(e) => setChecked((prev) => ({ ...prev, [i]: e.target.checked }))}
            className="mt-0.5"
          />
          <span className={checked[i] ? "line-through text-text-faint" : ""}>{item}</span>
        </label>
      ))}
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
          {formatPct(data.fundingRatePct)} {fundingOk !== null && (fundingOk ? "✓ unter Schwelle" : "über Schwelle")}
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
        <span className="text-text-faint">EMA13 / EMA50 / EMA200 (dein System vs. NEXUS-Trend-Regime)</span>
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
  const [module, setModule] = useState<WissenModule>("welz");
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
      <div className="flex gap-1.5">
        {([
          { id: "welz", label: "Welz (Psychologie)" },
          { id: "salomon", label: "Salomon (Chartanalyse)" },
          { id: "mein_system", label: "Mein System" },
          { id: "playbook", label: "Institutional Playbook" },
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

      {module === "playbook" ? <PlaybookPanel /> : <KnowledgeSections entries={entries} />}

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
      {module === "mein_system" && (
        <div className="space-y-3">
          <MeinSystemLiveValues data={meinSystemData} />
          <GussSignalCard data={gussData} />
          <VwapVectorCard data={vwapVectorData} />
          <CvdFootprintCard data={cvdData} />
          <ChartStructureCard data={chartStructureData} />
          <LevelStructureCard zones={levelStructureZones} />
          <ChecklistBlock
            title="Entry-Regelwerk"
            items={MEIN_SYSTEM_MANUAL_CHECKLIST}
            module="mein_system"
            history={historyFor("mein_system")}
            onSaved={refetchChecklistHistory}
          />
        </div>
      )}
    </div>
  );
}
