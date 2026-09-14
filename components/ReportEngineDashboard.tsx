"use client";

import { useState } from "react";
import { TIMEFRAMES, parseTimeframe, type TimeframeId } from "@/lib/timeframes";
import type { ReportConfig, ReportRun, ReportType } from "@/lib/types";
import { FullDateTime, StaleBadge } from "@/components/ClientTimestamp";

const MAX_SCHEDULE_TIMES = 5;

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
          Bis zu 4 unabhängig konfigurierbare AI-Reports, je bis zu {MAX_SCHEDULE_TIMES} Zeitplan-Läufe
          pro Tag. Jeder Lauf wird in <code className="text-xs">report_runs</code> gespeichert, samt
          der Datenbasis, die dem Modell vorlag — NEXUS sammelt und validiert die Fakten, die AI
          interpretiert sie nur. Nur Gratis-Tier-Provider stehen zur Auswahl — die AI Report Engine
          bleibt vollständig kostenlos.
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
  const [scheduleTimes, setScheduleTimes] = useState<string[]>(
    config.schedule_times?.map((t) => t.slice(0, 5)) ?? []
  );
  const [active, setActive] = useState(config.active);
  const [emailEnabled, setEmailEnabled] = useState(config.email_enabled);
  const [pushEnabled, setPushEnabled] = useState(config.push_enabled);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  // Normalisiert vor dem Vergleich/Speichern: leere Eingabefelder (waehrend
  // des Tippens einer neuen Zeit) raus, sortiert -- Reihenfolge im Array
  // soll keine eigene Bedeutung haben.
  const normalizedScheduleTimes = [...scheduleTimes].filter((t) => t !== "").sort();
  const normalizedConfigTimes = [...(config.schedule_times ?? [])].map((t) => t.slice(0, 5)).sort();

  const dirty =
    provider !== config.provider ||
    model !== (config.model ?? "") ||
    timeframe !== config.timeframe ||
    JSON.stringify(normalizedScheduleTimes) !== JSON.stringify(normalizedConfigTimes) ||
    active !== config.active ||
    emailEnabled !== config.email_enabled ||
    pushEnabled !== config.push_enabled;

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
          schedule_times: normalizedScheduleTimes.length === 0 ? null : normalizedScheduleTimes,
          active,
          email_enabled: emailEnabled,
          push_enabled: pushEnabled,
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
      // Bugfix 14.09.2026 (Nutzer-Report: "news/makro laeuft nicht, auch
      // wenn ich manuell auf groq setze"): /api/reports/run liest
      // provider/model/etc. IMMER frisch aus report_configs, nicht aus
      // diesem Formular -- eine geaenderte Auswahl ohne vorheriges
      // "Speichern" wurde bisher stillschweigend ignoriert und der Lauf
      // startete mit dem alten, gespeicherten Provider. "Jetzt ausfuehren"
      // speichert daher jetzt zuerst automatisch, falls noch ungespeicherte
      // Aenderungen vorliegen -- was sichtbar eingestellt ist, ist auch das,
      // was laeuft. Betrifft alle 4 Slots gleichermassen (gemeinsame
      // Komponente).
      let currentConfig = config;
      if (dirty) {
        const saveRes = await fetch("/api/reports/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slot: config.slot,
            provider,
            model: model.trim() === "" ? null : model.trim(),
            timeframe,
            schedule_times: normalizedScheduleTimes.length === 0 ? null : normalizedScheduleTimes,
            active,
            email_enabled: emailEnabled,
            push_enabled: pushEnabled,
          }),
        });
        const saveJson = await saveRes.json();
        if (!saveRes.ok || !saveJson.success) {
          throw new Error(saveJson.error ?? `Speichern fehlgeschlagen: HTTP ${saveRes.status}`);
        }
        currentConfig = saveJson.config as ReportConfig;
        onChange({ config: currentConfig, lastRun });
        setSaveOk(true);
      }

      const res = await fetch("/api/reports/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: currentConfig.slot }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      onChange({ config: currentConfig, lastRun: json.run as ReportRun });
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
            onChange={(e) => {
              // Bugfix 14.09.2026 (Nutzer-Frage: "muss ich dann auch das
              // Modell wechseln? sollte automatisch eingefuegt werden"):
              // das Modell-Feld ist providerspezifisch (z.B. Slot 2s
              // "nvidia/nemotron-3-super-120b-a12b:free" ist ein reiner
              // OpenRouter-String) und wurde bisher beim Providerwechsel
              // NICHT geleert -- ein stehen gebliebener, fuer den neuen
              // Provider unbekannter Modellname haette den Lauf zum
              // Scheitern gebracht. Leeres Feld = Provider-Default (siehe
              // Platzhaltertext unten), daher hier automatisch zuruecksetzen
              // statt den Nutzer den Namen manuell loeschen zu lassen.
              setProvider(e.target.value);
              setModel("");
            }}
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
          Modell (optional, sonst Provider-Default -- wird bei Providerwechsel automatisch geleert)
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

        <div className="text-xs text-text-faint flex flex-col gap-1">
          Zeitplan (täglich, UTC, bis zu {MAX_SCHEDULE_TIMES} Zeiten)
          <div className="flex flex-col gap-1.5">
            {scheduleTimes.map((t, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  type="time"
                  value={t}
                  onChange={(e) =>
                    setScheduleTimes((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
                  }
                  className="bg-surface-raised border border-border rounded-md px-2 py-1.5 text-sm text-text"
                />
                <button
                  type="button"
                  onClick={() => setScheduleTimes((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-text-faint hover:text-down px-1"
                  aria-label="Zeit entfernen"
                >
                  ×
                </button>
              </div>
            ))}
            {scheduleTimes.length < MAX_SCHEDULE_TIMES && (
              <button
                type="button"
                onClick={() => setScheduleTimes((prev) => [...prev, ""])}
                className="text-xs text-accent hover:underline decoration-dotted self-start"
              >
                + Zeit hinzufügen
              </button>
            )}
          </div>
        </div>
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

      <label className="flex items-center gap-2 text-xs text-text-muted">
        <input
          type="checkbox"
          checked={pushEnabled}
          onChange={(e) => setPushEnabled(e.target.checked)}
        />
        Push-Benachrichtigung bei Fertigstellung (Tippen öffnet den Report; nur an bereits
        registrierte Geräte, siehe Konto-Bereich)
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

  const isFlagged = lastRun.validation_status === "flagged_contradiction";

  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span className={isOk ? "text-up" : "text-down"}>{isOk ? "OK" : "FEHLER"}</span>
        <span className="text-text-faint">
          <FullDateTime iso={lastRun.generated_at} /> · {lastRun.provider}
          {lastRun.model ? ` (${lastRun.model})` : ""}
        </span>
        <StaleBadge iso={lastRun.generated_at} />
        {isFlagged && (
          <span className="inline-flex items-center rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
            FLAGGED_CONTRADICTION
          </span>
        )}
      </div>
      {isFlagged && lastRun.validation_notes && lastRun.validation_notes.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs text-accent">
          {lastRun.validation_notes.map((note, i) => (
            <li key={i}>⚠ {note}</li>
          ))}
        </ul>
      )}
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
