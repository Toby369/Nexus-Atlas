"use client";

import { useEffect, useState } from "react";

// Gemeinsame, hydration-sichere Zeitstempel-Darstellung (Phase 2, Punkt 2:
// React-Hydration-Error #418).
//
// Das Problem: eine relative Zeitangabe ("vor X Min") oder eine lokale
// Uhrzeit (toLocaleTimeString ohne explizite Zeitzone) haengt von
// Date.now() bzw. der Laufzeit-Zeitzone ab. Server-Render (Vercel, meist
// UTC, zu einem fruehen Zeitpunkt) und Client-Hydration (Browser des
// Nutzers, eigene Zeitzone, einen Moment spaeter) liefern dafuer fast immer
// unterschiedliche Strings -- React vergleicht den serverseitig gerenderten
// Text mit dem, was der Client beim Hydrieren berechnet, und wirft bei
// einer Abweichung Fehler #418 ("Text content does not match").
//
// Die Loesung: Server-Render UND der allererste Client-Render (vor dem
// ersten Effect) zeigen exakt denselben, laufzeitunabhaengigen Wert -- den
// rohen ISO-String selbst. Der berechnete (relative oder lokalisierte) Text
// wird ERST im useEffect gesetzt, laeuft also nachweislich nie waehrend der
// Hydration, sondern erst danach (ein kurzes Aufblitzen des ISO-Strings ist
// der bewusst in Kauf genommene Trade-off dafuer).

export function formatRelative(iso: string, nowMs: number): string {
  const seconds = Math.floor((nowMs - new Date(iso).getTime()) / 1000);
  if (seconds < 0) return "gerade eben";
  if (seconds < 60) return `vor ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std`;
  const days = Math.floor(hours / 24);
  return `vor ${days} Tg`;
}

const RELATIVE_REFRESH_MS = 15_000;

export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setText(formatRelative(iso, Date.now()));
    update();
    const interval = setInterval(update, RELATIVE_REFRESH_MS);
    return () => clearInterval(interval);
  }, [iso]);

  return <span className={className}>{text ?? iso}</span>;
}

export function ClockTime({ iso, className }: { iso: string; className?: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const update = () =>
      setText(new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }));
    update();
  }, [iso]);

  return <span className={className}>{text ?? iso}</span>;
}

// Countdown fuer zukuenftige Termine (z.B. "in 3 Tagen", "heute") --
// gleiche Hydration-Problematik wie RelativeTime (haengt von Date.now()
// ab), gleiche Loesung. dateOnly=true, wenn iso ein reines Datum
// (YYYY-MM-DD) ohne Uhrzeit ist -- dann wird auf Kalendertage statt volle
// 24h-Bloecke gerundet (sonst wuerde "heute" oft faelschlich als bereits
// vergangen erscheinen).
export function formatDaysUntil(iso: string, nowMs: number, dateOnly = false): string {
  const targetMs = dateOnly ? new Date(`${iso}T00:00:00Z`).getTime() : new Date(iso).getTime();
  const nowRef = dateOnly ? new Date(new Date(nowMs).toISOString().slice(0, 10) + "T00:00:00Z").getTime() : nowMs;
  const days = Math.round((targetMs - nowRef) / (24 * 60 * 60 * 1000));
  if (days < 0) return "vergangen";
  if (days === 0) return "heute";
  if (days === 1) return "morgen";
  return `in ${days} Tagen`;
}

export function DaysUntil({
  iso,
  dateOnly,
  className,
}: {
  iso: string;
  dateOnly?: boolean;
  className?: string;
}) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setText(formatDaysUntil(iso, Date.now(), dateOnly));
    update();
  }, [iso, dateOnly]);

  return <span className={className}>{text ?? iso}</span>;
}

// Kurzes Datum (z.B. "28. Aug.") -- gleiche Hydration-Problematik wie
// ClockTime (toLocaleDateString ohne explizite Zeitzone haengt vom
// Laufzeit-Standort ab), gleiche Loesung.
export function ShortDate({ iso, className }: { iso: string; className?: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const update = () =>
      setText(new Date(iso).toLocaleDateString("de-CH", { day: "2-digit", month: "short" }));
    update();
  }, [iso]);

  return <span className={className}>{text ?? iso}</span>;
}

// Volles Datum + Uhrzeit (z.B. "28.08.2026, 22:14") -- gleiche
// Hydration-Problematik wie ClockTime/ShortDate, gleiche Loesung.
export function FullDateTime({ iso, className }: { iso: string; className?: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setText(new Date(iso).toLocaleString("de-CH"));
    update();
  }, [iso]);

  return <span className={className}>{text ?? iso}</span>;
}

// Phase 2, Punkt 1: sichtbares Badge fuer Reports, deren generated_at
// laenger als STALE_HOURS_THRESHOLD zurueckliegt. Erst im Effect
// berechnet (haengt von Date.now() ab) -- vor dem ersten Effect (Server-
// Render + erster Client-Render) zeigt die Komponente bewusst nichts an,
// das ist auf beiden Seiten identisch und daher kein Hydration-Risiko.
export const STALE_HOURS_THRESHOLD = 12;

export function StaleBadge({ iso, className }: { iso: string; className?: string }) {
  const [staleHours, setStaleHours] = useState<number | null>(null);

  useEffect(() => {
    const update = () => {
      const hours = Math.floor((Date.now() - new Date(iso).getTime()) / (60 * 60 * 1000));
      setStaleHours(hours >= STALE_HOURS_THRESHOLD ? hours : null);
    };
    update();
    const interval = setInterval(update, RELATIVE_REFRESH_MS);
    return () => clearInterval(interval);
  }, [iso]);

  if (staleHours === null) return null;

  return (
    <span
      className={
        className ??
        "inline-flex items-center rounded-full border border-down/40 bg-down/10 px-2 py-0.5 text-[10px] font-medium text-down"
      }
    >
      Veraltet (Stand vor {staleHours} Std.)
    </span>
  );
}
