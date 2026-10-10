"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { MarketState, ReportRun } from "@/lib/types";
import { FullDateTime, StaleBadge } from "@/components/ClientTimestamp";
import PanelInfo from "@/components/PanelInfo";
import { computeMasterReportVsEnginesDivergence } from "@/lib/divergenceRadar";

// Master-Report in der Head-Kachel (Nutzer-Wunsch 03.10.2026, Screenshot der
// Master-Report-E-Mail: "den moechte ich 3x/tag in head kachel angezeigt
// bekommen, so formuliert."). Zeigt denselben report_runs-Datensatz (Slot 4,
// report_type='master'), den auch /reports und die E-Mail
// (app/api/reports/run/route.ts::buildReportEmailHtml) anzeigen -- dieselben
// Felder (overallBias/confidence/summary/conflicts/componentBiases), hier
// im App-Theme statt als E-Mail-HTML gerendert. "3x/Tag" kommt NICHT aus
// einer Anzeige-Beschraenkung hier, sondern daraus, dass report_configs
// (Slot 1-4) jetzt je 3 taegliche schedule_times haben (vorher nur 1) --
// diese Kachel zeigt einfach immer den zuletzt generierten Lauf, der sich
// dadurch von selbst 3x/Tag aendert.
//
// Eigene kleine Komponente statt weiterer Logik in der bereits sehr grossen
// HeroHeader.tsx -- gleiches Muster wie TradingHoursBadge/EconomicHeroBadge
// (eigener Fetch/Poll). Poll-Intervall bewusst grosszuegig (5 Min): der
// zugrunde liegende Lauf aendert sich nur alle paar Stunden.
const POLL_MS = 5 * 60_000;

const BIAS_LABEL: Record<string, string> = {
  bullish: "Bullish",
  bearish: "Bearish",
  neutral: "Neutral",
};

const BIAS_STYLE: Record<string, string> = {
  bullish: "text-up bg-up/10 border-up/30",
  bearish: "text-down bg-down/10 border-down/30",
  neutral: "text-text-faint bg-surface border-border",
};

// Deckt sich mit componentBiases-Keys aus dem Master-Prompt (siehe
// lib/ai/promptProfiles.ts, Profil "report-master") -- dieselben drei wie
// die Slots 1-3 in ReportEngineDashboard.tsx.
const COMPONENT_LABEL: Record<string, string> = {
  marketStructure: "Market Structure",
  positioning: "Positioning",
  newsMacro: "News / Macro",
};

const INFO_TEXT = [
  "Was das ist: der Master-Report der AI Report Engine (Tab \"KI-Einschätzungen\" → /reports, Slot 4) -- fasst die drei Einzelreports (Market Structure, Positioning, News/Macro) zusammen und benennt Widersprüche zwischen ihnen explizit, statt sie zu einem Bias zu verwischen. Eigenständige KI-Engine, unabhängig von der regelbasierten Gesamteinschätzung oben UND von der \"Kurze Einordnung\" (dein eigenes Regelwerk) -- drei unterschiedliche Blickwinkel auf denselben Markt.",
  "Aktualisierung: automatisch 3x täglich (siehe /reports, Slot 4 für die genauen Uhrzeiten). Diese Kachel zeigt immer den zuletzt generierten Lauf, kein eigener Button hier -- dadurch kann er bis zu ~8h älter sein als die beiden live-orientierten Engines oben.",
  "Widerspruchs-Warnung (08.10.2026): erscheint, wenn die 14-Faktoren-Gesamteinschätzung und die Kurze Einordnung sich einig sind, dieser Report aber eine andere Richtung zeigt -- meist, weil er stärker auf Positioning/Makro (träger, nachlaufend) statt auf Live-Struktur/Momentum setzt, oder weil die Live-Engines auf eine Bewegung reagiert haben, die erst NACH diesem Lauf passiert ist.",
].join("\n\n");

interface MasterReportResult {
  summary?: string;
  conflicts?: string[];
  confidence?: number;
  overallBias?: "bullish" | "bearish" | "neutral";
  componentBiases?: Record<string, string>;
  // 03.10.2026 (Nutzer-Wunsch "kann der report auf den vorherigen kurz
  // eingehen?!") -- null, wenn kein vorheriger Lauf im Kontext war (siehe
  // Prompt-Profil "report-master"), string wenn verglichen wurde.
  changeSinceLast?: string | null;
}

async function fetchLatestMasterRun(): Promise<ReportRun | null> {
  const { data, error } = await supabase
    .from("report_runs")
    .select("*")
    .eq("report_type", "master")
    .eq("status", "ok")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("MasterReportHeroCard: Fehler beim Laden des Master-Reports:", error.message);
    return null;
  }
  return data;
}

export default function MasterReportHeroCard({
  overallState,
  briefingBias,
}: {
  // 08.10.2026 (Nutzer-Beobachtung "master report und system briefing/head
  // kachel sind ja sehr widerspruechlich"): fuer die Divergenz-Warnung unten
  // -- beide bereits in HeroHeader geladen (state/narrativeSnapshot), kein
  // zusaetzlicher Fetch hier noetig, gleiches Prinzip wie briefingDivergence
  // dort.
  overallState: MarketState["overall_state"] | null;
  briefingBias: "bullish" | "bearish" | "neutral" | undefined;
}) {
  const [run, setRun] = useState<ReportRun | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const result = await fetchLatestMasterRun();
      if (!cancelled) setRun(result);
    };
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!run) return null;

  const data = (run.result ?? {}) as MasterReportResult;
  const bias = data.overallBias;
  const confidence = data.confidence;
  const conflicts = data.conflicts ?? [];
  const componentBiases = data.componentBiases ?? {};
  // Nur eine Aussage, wenn die beiden anderen Engines (14-Faktoren +
  // Kurze Einordnung) sich einig sind -- siehe
  // computeMasterReportVsEnginesDivergence. Steht dieser Report (bis zu 8h
  // alt, Positioning/Makro-lastig) dem entgegen, ist das ein echter
  // Widerspruch, kein Darstellungsfehler.
  const enginesDivergence = computeMasterReportVsEnginesDivergence(bias, overallState, briefingBias);

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="text-xs uppercase tracking-[0.15em] text-text-muted">Master-Report</span>
          <PanelInfo title="Master-Report" content={INFO_TEXT} />
        </span>
        <span className="flex items-center gap-1.5 text-xs text-text-faint">
          <FullDateTime iso={run.generated_at} /> · {run.timeframe}
          <StaleBadge iso={run.generated_at} />
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {bias && (
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              BIAS_STYLE[bias] ?? BIAS_STYLE.neutral
            }`}
          >
            {BIAS_LABEL[bias] ?? bias}
          </span>
        )}
        {confidence !== undefined && (
          <span className="text-xs text-text-faint">Überzeugungsgrad {Math.round(confidence)}/100</span>
        )}
      </div>

      {enginesDivergence === "DIVERGENCE" && (
        <p className="text-xs text-down flex items-center gap-1">
          ⚠ Weicht von der Gesamteinschätzung + Kurzer Einordnung oben ab (die beiden sind sich aktuell
          einig) — ein echter Widerspruch, kein Darstellungsfehler. Dieser Report kann durch den
          3x-täglichen Takt mehrere Stunden älter sein und stützt sich stärker auf Positioning/Makro statt
          auf Live-Struktur.
        </p>
      )}

      {data.summary && <p className="text-sm text-text-muted leading-relaxed">{data.summary}</p>}

      {data.changeSinceLast && (
        <p className="text-xs text-text-faint italic">Seit dem letzten Lauf: {data.changeSinceLast}</p>
      )}

      {conflicts.length > 0 ? (
        <div className="rounded-md border border-accent/30 bg-accent/10 p-3">
          <p className="text-[10px] uppercase tracking-[0.1em] text-accent mb-1">Widersprüche</p>
          <ul className="space-y-0.5 text-xs text-text">
            {conflicts.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-md border border-up/30 bg-up/10 p-3 text-xs text-up">
          Keine Widersprüche zwischen den drei Einzelreports.
        </div>
      )}

      {Object.keys(componentBiases).length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-[0.1em] text-text-faint">Einzelreports</p>
          <div className="space-y-1 text-xs">
            {Object.entries(componentBiases).map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <span className="text-text-faint w-28 shrink-0">{COMPONENT_LABEL[key] ?? key}</span>
                <span className="text-text">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
