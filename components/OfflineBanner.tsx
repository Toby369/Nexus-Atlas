"use client";

import { useEffect, useState } from "react";

// PWA-Erweiterung: dezenter Hinweis bei fehlender Internetverbindung, damit
// nie der Eindruck entsteht, angezeigte Marktdaten seien aktuell, obwohl
// keine neuen Daten mehr geladen werden koennen (Vorgabe: Live-Marktdaten
// duerfen nicht veraltet als aktuell erscheinen).
export default function OfflineBanner() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div className="sticky top-0 z-50 w-full bg-down/90 px-4 py-2 text-center text-xs font-medium text-white">
      Keine Verbindung – Marktdaten nicht aktuell.
    </div>
  );
}
