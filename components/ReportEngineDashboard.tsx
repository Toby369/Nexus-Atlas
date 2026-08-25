"use client";

import { useState } from "react";
import { TIMEFRAMES, parseTimeframe, type TimeframeId } from "@/lib/timeframes";
import type { ReportConfig, ReportRun, ReportType } from "@/lib/types";

export interface ProviderOption {
  id: string;
  label: string;
  configured: boolean;
}

export interface ReportSlotData {
  config: ReportConfig;
  lastRun: ReportRun | null;
}

interface ReportEngineDashboardProps {
  initialSlots: ReportSlotData[];
  providerOptions: ProviderOption[];
  serviceRoleConfigured: boolean;
}

// Feste Zuordnung Slot -> Report-Typ (siehe Seed-Daten der report_configs-
// Tabelle und Vorgabe Teil N: genau 4 Report-Typen mit fest definierten
// Eingaben, nicht frei kombinierbar).
const REPORT_TYPE_META: Record<ReportType, { title: string; description: string }> = {
  market_structure: {
    title: "1 · Market Structure",
    description:
      "BTC-Preis, OI-Change, Funding, Liquidationen, Spot-Pressure, Exchange-Daten, Assessment.",
  },
  positioning: {
    title: "2 · Positioning",
    description:
      "Long/Short-Ratios, Top-Trader vs. Retail, OI, Taker-Flow, Liquidationen, Exchange-Divergenz.",
  },
  news_macro: {
    title: "3 · News / Macro",
    description: "News-Risiko, ETF-Flows, Fed/CPI/Treasury und weitere Makro-Ereignisse.",
  },
  master: {
    title: "4 · Master",
    description:
      "Fasst die Ergebnisse von Report 1-3 zusammen und benennt widersprüchliche Signale " +
      "explizit, statt sie zu einem einzelnen Bias zu verwischen. Benötigt vorherige " +
      "erfolgreiche Läufe von Report 1-3.",
  },
};

export default function ReportEngineDashboard({
  initialSlots,
  providerOptions,
  serviceRoleConfigured,
}: ReportEngineDashboardProps) {
  const [slots, setSlots] = useState(initialSlots);

  function updateSlot(index: number, next: ReportSlotData) {
    setSlots((prev) => prev.map((s, i) => (i === index ? next : s)));
  }

  const noProviderConfigured = providerOptions.every((p) => !p.configured);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-text-faint mb-2">Status</p>
        <p className="text-sm text-text-muted">
          Bis zu 4 unabhängig konfigurierbare AI-Reports. Jeder Lauf wird in{" "}
          <code className="text-xs">report_runs</code> gespeichert, samt der Datenbasis, die
          dem Modell vorlag — NEXUS sammelt und validiert die Fakten, die AI interpretiert sie
          nur.
        </p>
        {!serviceRoleConfigured && (
          <p className="text-xs mt-2 text-down">
            SUPABASE_SERVICE_ROLE_KEY ist serverseitig nicht gesetzt — jeder Lauf schlägt
            aktuell mit einem klaren Fehler fehl, bis diese Umgebungsvariable in Vercel gesetzt
            ist.
          </p>
        )}
        {noProviderConfigured && (
          <p className="text-xs mt-2 text-text-faint">
            Kein AI-Provider ist aktuell konfiguriert (kein API-Key gesetzt). Provider/Modell
            lassen sich trotzdem schon vorbereiten.
          </p>
        )}
      </div>

      {slots.map((slot, i) => (
        <SlotCard
          key={slot.config.id}
          slot={slot}
          providerOptions={providerOptions}
          onChange={(next) => updateSlot(i, next)}
        />
      ))}
    </div>
  );
}

function SlotCard({
  slot,
  providerOptions,
  onChange,
}: {
  slot: ReportSlotData;
  providerOptions: ProviderOption[];
  onChange: (next: ReportSlotData) => void;
}) {
  const { config, lastRun } = slot;
  const meta = REPORT_TYPE_META[config.report_type];

  const [provider, setProvider] = useState(config.provider);
  const [model, setModel] = useState(config.model ?? "");
  const [timeframe, setTimeframe] = useState<TimeframeId>(parseTimeframe(config.timeframe));
  const [scheduleTime, setScheduleTime] = useState(config.schedule_time?.slice(0, 5) ?? "");
  const [active, setActive] = useState(config.active);
  const [emailEnabled, setEmailEnabled] = useState(config.email_enabled);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const dirty =
    provider !== config.provider ||
    model !== (config.model ?? "") ||
    timeframe !== config.timeframe ||
    scheduleTime !== (config.schedule_time?.slice(0, 5) ?? "") ||
    active !== config.active ||
    emailEnabled !== config.email_enabled;

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const res = await fetch("/api/reports/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot: config.slot,
          provider,
          model: model.trim() === "" ? null : model.trim(),
          timeframe,
          schedule_time: scheduleTime === "" ? null : scheduleTime,
          active,
          email_enabled: emailEnabled,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      onChange({ config: json.config as ReportConfig, lastRun });
      setSaveOk(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRun() {
    setRunning(true);
    setRunError(null);
    try {
      const res = await fetch("/api/reports/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: config.slot }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      onChange({ config, lastRun: json.run as ReportRun });
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium text-text">{meta.title}</p>
          <p className="text-xs text-text-faint mt-1 max-w-md">{meta.description}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-muted">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Aktiv
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs text-text-faint flex flex-col gap-1">
          Provider
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="bg-surface-raised border border-border rounded-md px-2 py-1.5 text-sm text-text"
          >
            {providerOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} {p.configured ? "· konfiguriert" : "· kein Key"}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-text-faint flex flex-col gap-1">
          Modell (optional, sonst Provider-Default)
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="z.B. gemini-2.0-flash"
            className="bg-surface-raised border border-border rounded-md px-2 py-1.5 text-sm text-text"
          />
        </label>

        <label className="text-xs text-text-faint flex flex-col gap-1">
          Zeitraum
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as TimeframeId)}
            className="bg-surface-raised border border-border rounded-md px-2 py-1.5 text-sm text-text"
          >
            {TIMEFRAMES.map((tf) => (
              <option key={tf.id} value={tf.id}>
                {tf.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-text-faint flex flex-col gap-1">
          Zeitplan (täglich, UTC)
          <input
            type="time"
            value={scheduleTime}
            onChange={(e) => setScheduleTime(e.target.value)}
            className="bg-surface-raised border border-border rounded-md px-2 py-1.5 text-sm text-text"
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-xs text-text-muted">
        <input
          type="checkbox"
          checked={emailEnabled}
          onChange={(e) => setEmailEnabled(e.target.checked)}
        />
        E-Mail bei Fertigstellung (aktiv, sobald RESEND_API_KEY, REPORT_EMAIL_FROM und
        REPORT_EMAIL_TO serverseitig gesetzt sind — bis dahin wird der Versand übersprungen)
      </label>

      <div className="flex items-center gap-3 flex-wrap pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="px-3 py-1.5 text-xs rounded-md border border-accent/40 bg-accent/15 text-accent disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? "Speichert…" : "Speichern"}
        </button>
        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          className="px-3 py-1.5 text-xs rounded-md border border-border text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running ? "Läuft…" : "Jetzt ausführen"}
        </button>
        {saveOk && !dirty && <span className="text-xs text-up">Gespeichert.</span>}
        {saveError && <span className="text-xs text-down">{saveError}</span>}
        {runError && <span className="text-xs text-down">{runError}</span>}
      </div>

      <LastRunView lastRun={lastRun} />
    </div>
  );
}

function LastRunView({ lastRun }: { lastRun: ReportRun | null }) {
  if (!lastRun) {
    return <p className="text-xs text-text-faint">Noch kein Lauf für diesen Slot.</p>;
  }

  const isOk = lastRun.status === "ok";
  const data = lastRun.result;
  const bias = (data?.bias ?? data?.overallBias) as string | undefined;
  const confidence = data?.confidence as number | undefined;
  const summary = data?.summary as string | undefined;

  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center gap-2 text-xs">
        <span className={isOk ? "text-up" : "text-down"}>{isOk ? "OK" : "FEHLER"}</span>
        <span className="text-text-faint">
          {new Date(lastRun.generated_at).toLocaleString("de-CH")} · {lastRun.provider}
          {lastRun.model ? ` (${lastRun.model})` : ""}
        </span>
      </div>
      {isOk ? (
        <div className="mt-2 space-y-1">
          {bias && (
            <p className="text-sm text-text">
              Bias: <span className="font-medium">{bias}</span>
              {confidence !== undefined && ` · Confidence ${confidence}`}
            </p>
          )}
          {summary && <p className="text-xs text-text-muted">{summary}</p>}
          <details className="text-xs text-text-faint">
            <summary className="cursor-pointer">Rohdaten</summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words bg-surface-raised rounded-md p-2">
              {JSON.stringify(lastRun.result, null, 2)}
            </pre>
          </details>
        </div>
      ) : (
        <p className="text-xs mt-1 text-down">{lastRun.error}</p>
      )}
    </div>
  );
}
