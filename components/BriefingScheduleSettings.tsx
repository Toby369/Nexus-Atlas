"use client";

import { useState } from "react";
import type { SystemBriefingConfig } from "@/lib/types";
import { MAX_BRIEFING_SCHEDULE_TIMES } from "@/lib/systemBriefingConfig";

// Zeitplan und Benachrichtigungen des System-Briefings, als Aufklapper in
// der KI-Einordnung des Lagebilds (HeroHeader). Bedienung wie frueher je
// Report-Slot: bis zu MAX_BRIEFING_SCHEDULE_TIMES taegliche
// Uhrzeiten (Schweizer Zeit, Europe/Zurich -- Sommer-/Winterzeit rechnet
// der report-scheduler selbst um), E-Mail und Push nur fuer geplante Laeufe.

function toHHMM(times: string[] | null): string[] {
  return (times ?? []).map((t) => t.slice(0, 5));
}

export default function BriefingScheduleSettings({ initialConfig }: { initialConfig: SystemBriefingConfig | null }) {
  const [config, setConfig] = useState(initialConfig);
  const [scheduleTimes, setScheduleTimes] = useState<string[]>(toHHMM(initialConfig?.schedule_times ?? null));
  const [emailEnabled, setEmailEnabled] = useState(initialConfig?.email_enabled ?? false);
  const [pushEnabled, setPushEnabled] = useState(initialConfig?.push_enabled ?? false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  if (!config) {
    return <p className="text-xs text-text-faint">Zeitplan konnte nicht geladen werden.</p>;
  }

  // Leere Felder (waehrend eine neue Zeit getippt wird) raus, sortiert --
  // die Reihenfolge hat keine eigene Bedeutung.
  const normalizedTimes = scheduleTimes.filter((t) => t !== "").sort();
  const dirty =
    JSON.stringify(normalizedTimes) !== JSON.stringify(toHHMM(config.schedule_times).sort()) ||
    emailEnabled !== config.email_enabled ||
    pushEnabled !== config.push_enabled;

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const res = await fetch("/api/system-briefing/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schedule_times: normalizedTimes.length === 0 ? null : normalizedTimes,
          email_enabled: emailEnabled,
          push_enabled: pushEnabled,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? `HTTP ${res.status}`);
      const next = json.config as SystemBriefingConfig;
      setConfig(next);
      setScheduleTimes(toHHMM(next.schedule_times));
      setSaveOk(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="space-y-1.5">
        <p className="text-text-faint">
          Automatisch täglich um (Schweizer Zeit, bis zu {MAX_BRIEFING_SCHEDULE_TIMES} Zeiten; keine Zeit = nur manuell)
        </p>
        {scheduleTimes.map((t, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="time"
              value={t}
              onChange={(e) => setScheduleTimes((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
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
        {scheduleTimes.length < MAX_BRIEFING_SCHEDULE_TIMES && (
          <button
            type="button"
            onClick={() => setScheduleTimes((prev) => [...prev, ""])}
            className="text-accent hover:underline decoration-dotted"
          >
            + Zeit hinzufügen
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 text-text-muted">
        <input type="checkbox" checked={emailEnabled} onChange={(e) => setEmailEnabled(e.target.checked)} />
        E-Mail nach jedem geplanten Lauf
      </label>
      <label className="flex items-center gap-2 text-text-muted">
        <input type="checkbox" checked={pushEnabled} onChange={(e) => setPushEnabled(e.target.checked)} />
        Push-Benachrichtigung nach jedem geplanten Lauf
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="px-2.5 py-1 rounded-md border border-border text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? "Speichert…" : "Speichern"}
        </button>
        {saveOk && !dirty && <span className="text-up">Gespeichert.</span>}
        {saveError && <span className="text-down">{saveError}</span>}
      </div>
    </div>
  );
}
