import type { ReactNode } from "react";

// Was eine Kachel zeigt, wenn sie nichts zu zeigen hat -- immer mit einem
// Satz, warum. "Keine Daten" ohne Grund sieht aus wie ein ruhiger Markt
// (Vorbild AutarkTrade: "ein leerer Ticker darf nie wie ein ruhiger Markt
// aussehen"). Optional ein Knopf, der es aendert (children).
export default function Leerzustand({
  titel,
  text,
  children,
}: {
  titel: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border px-5 py-8 text-center space-y-1.5">
      <p className="text-sm text-text-muted">{titel}</p>
      {text && <p className="text-xs text-text-faint max-w-sm mx-auto">{text}</p>}
      {children && <div className="pt-2">{children}</div>}
    </div>
  );
}
