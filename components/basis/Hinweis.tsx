import type { ReactNode } from "react";

// Ein Satz, der auffallen soll: Info (Akzent), Warnung (Gelb) oder Fehler
// (Rot). Fuer Einschraenkungen der Daten ("Historie unvollstaendig") und
// Fehler beim Laden -- nicht fuer Marktsignale, die haben ihre Pille.
const ART: Record<"info" | "warnung" | "fehler", string> = {
  info: "border-accent/30 bg-accent/5 text-text-muted",
  warnung: "border-warn/40 bg-warn/10 text-warn",
  fehler: "border-down/40 bg-down/10 text-down",
};

export default function Hinweis({
  art = "info",
  className = "",
  children,
}: {
  art?: keyof typeof ART;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p role={art === "fehler" ? "alert" : undefined} className={`rounded-feld border px-3 py-2 text-xs ${ART[art]} ${className}`}>
      {children}
    </p>
  );
}
