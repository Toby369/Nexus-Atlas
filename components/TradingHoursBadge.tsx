"use client";

import { useEffect, useState } from "react";
import { getTradingHoursState, type EconomicEventRow, type SessionId, type WarningId } from "@/lib/tradingHours";
import PanelInfo from "@/components/PanelInfo";

// Umsetzungsplan Phase 1 (05.09.2026) -- Handelszeiten-Gate, portiert aus
// shared/handelszeiten.js im Crypto-Trading-Journal. Beantwortet neben dem
// EntryFilterBadge (STRUKTUR-Frage: "zeigt die 4h-Struktur in Trade-
// Richtung") die unabhaengige ZEITPUNKT-Frage: "ist JETZT ueberhaupt eine
// gute Zeit fuer einen 15m/5m-Einstieg". Reine Client-Uhr -- die zugrunde
// liegende Berechnung (lib/tradingHours.ts) ist netzfrei, daher kein Poll
// gegen Supabase noetig, nur ein Timer gegen die lokale Systemzeit.
const UPDATE_INTERVAL_MS = 30_000;

const SESSION_LABELS: Record<SessionId, string> = {
  asia: "Asien",
  london: "London",
  usPre: "US-Vorbörse",
  usCash: "US-Kassa",
  usPost: "US-Nachbörse",
};

const WARNING_LABELS: Record<WarningId, string> = {
  opening: "US-Kasseneröffnung",
  macro: "Wichtige Makro-Daten",
  fomc: "FOMC-Zinsentscheid",
  close: "US-Kassenschluss",
  cme: "CME-Wartungspause",
};

const INFO_TEXT = [
  "Was das ist: zeigt an, ob gerade eine bekannt volatile/spread-weite Phase läuft, in der ein 15m/5m-Einstieg riskanter ist -- unabhängig von der Marktrichtung. Konzept übernommen aus dem Crypto-Trading-Journal (Live-Trading-Fenster).",
  "Rot (hohe Warnung): 5min vor bis 15min nach US-Kasseneröffnung (09:30 ET), sowie bei tatsächlich terminierten CPI/PCE/NFP-Releases (08:30 ET, ±2/10min) und FOMC-Entscheiden (14:00 ET, ±2/20min) -- nur wenn im Wirtschaftskalender ein echter Termin an diesem Tag steht, nicht pauschal jeden Tag.",
  "Gelb (mittlere Warnung): US-Kassenschluss (16:00 ET, ±15/5min) und die tägliche CME-Wartungspause (17:00-18:00 ET, Mo-Do).",
  "Kein Handelssignal -- reine Zeitfenster-Information, ersetzt nicht die eigene Einschätzung.",
].join("\n\n");

export default function TradingHoursBadge({ events }: { events: EconomicEventRow[] }) {
  const [state, setState] = useState(() => getTradingHoursState(Date.now(), events));

  useEffect(() => {
    const update = () => setState(getTradingHoursState(Date.now(), events));
    update();
    const interval = setInterval(update, UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [events]);

  const highWarning = state.warnings.find((w) => w.level === "high");
  const mediumWarning = state.warnings.find((w) => w.level === "medium");
  const activeWarning = highWarning ?? mediumWarning;

  const style = highWarning
    ? "border-accent/40 bg-accent/10 text-accent"
    : "border-border bg-surface-raised text-text-muted";

  const sessionLabel =
    state.active.length > 0 ? SESSION_LABELS[state.active[0].id] : "Keine Hauptsession aktiv";

  const valueText = activeWarning
    ? `${WARNING_LABELS[activeWarning.id]} -- ${highWarning ? "meiden" : "Vorsicht"}`
    : sessionLabel;

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${style}`}
    >
      <span className="flex items-center gap-1.5">
        <span className="uppercase tracking-[0.12em] text-[10px] opacity-70">Handelszeiten</span>
        <PanelInfo title="Handelszeiten" content={INFO_TEXT} />
      </span>
      <span className="font-semibold">{valueText}</span>
    </div>
  );
}
