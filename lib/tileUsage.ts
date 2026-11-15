import { DASHBOARD_TABS } from "./dashboardTabs";
import { DASHBOARD_TILES } from "./dashboardTiles";

// Nutzungs-Zaehler (Toby 27.10.2026): Reiter-Wechsel ("tab:markt"), Klicks in
// eine Kachel ("tile:volatility") und aufgeklappte Trade-Schritte
// ("step:zones"). Grundlage zum Ausmisten -- geloescht wird nie automatisch.

const ITEM_PATTERN = /^(tab|tile|step|dwell):[a-z0-9-]{1,40}$/;

// Verweildauer (15.11.2026): "dwell:<reiter>" mit Sekunden, ein Eintrag pro
// Besuch ab DWELL_MIN_SECONDS, gekappt bei DWELL_MAX_SECONDS.
export const DWELL_MIN_SECONDS = 5;
export const DWELL_MAX_SECONDS = 7200;

export function isUsageItem(value: unknown): value is string {
  return typeof value === "string" && ITEM_PATTERN.test(value);
}

// Pro Seitenaufruf jede Nutzung nur einmal zaehlen -- zehn Klicks in dieselbe
// Kachel sind eine Nutzung, kein zehnfaches Interesse.
const seen = new Set<string>();

/** Fire-and-forget aus dem Browser; Fehler sind egal (reine Statistik). */
export function logUsage(item: string): void {
  if (typeof window === "undefined" || seen.has(item) || !isUsageItem(item)) return;
  seen.add(item);
  fetch("/api/tile-usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item }),
    keepalive: true,
  }).catch(() => {});
}

/** Sichtbare Zeit eines Reiters melden (beim Wechsel oder Verlassen der Seite). */
export function logDwell(tabId: string, seconds: number): void {
  const s = Math.min(DWELL_MAX_SECONDS, Math.round(seconds));
  const item = `dwell:${tabId}`;
  if (typeof window === "undefined" || s < DWELL_MIN_SECONDS || !isUsageItem(item)) return;
  fetch("/api/tile-usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item, seconds: s }),
    keepalive: true,
  }).catch(() => {});
}

const STEP_TITLES: Record<string, string> = {
  zones: "Zonen",
  "rule-check": "Regelcheck",
  veto: "Veto vor dem Klick",
  "lage-driver": "Lage: Wer treibt?",
  "lage-leverage": "Lage: Hebel und Masse",
  "lage-us": "Lage: US-Anleger",
  "lage-macro": "Lage: US-Makro",
};

/** Alle zaehlbaren Eintraege mit lesbarem Namen, damit auch nie genutzte (0) erscheinen. */
export function usageCatalog(): { item: string; label: string }[] {
  return [
    ...DASHBOARD_TABS.map((t) => ({ item: `tab:${t.id}`, label: `Reiter ${t.label}` })),
    ...Object.entries(STEP_TITLES).map(([id, title]) => ({ item: `step:${id}`, label: title.startsWith("Lage:") ? title : `Trade: ${title}` })),
    ...DASHBOARD_TILES.map((t) => ({ item: `tile:${t.id}`, label: t.title })),
  ];
}
