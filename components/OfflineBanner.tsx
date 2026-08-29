"use client";

import { useEffect, useRef, useState } from "react";

// PWA-Erweiterung: Hinweis bei fehlender Internetverbindung, damit nie der
// Eindruck entsteht, angezeigte Marktdaten seien aktuell, obwohl keine
// neuen Daten mehr geladen werden koennen.
//
// Verlaesst sich NICHT (mehr) allein auf navigator.onLine bzw. die
// online/offline-Browser-Events -- beide sind auf Mobilgeraeten notorisch
// unzuverlaessig: sie melden nur, ob irgendein Netzwerk-Interface aktiv
// ist, nicht ob tatsaechlich eine Verbindung zum Server besteht, und sind
// bekannt fuer Fehlalarme kurz nach einem WLAN-/Mobilfunk-Wechsel (in der
// Praxis beobachtet: "Keine Verbindung" bei vollem 5G-Empfang).
//
// Stattdessen ein echter, periodischer Erreichbarkeits-Check per Fetch
// gegen die eigene Origin -- die online/offline-Events sowie ein
// Tab-Wechsel loesen nur einen sofortigen Re-Check aus, statt selbst ueber
// die Anzeige zu entscheiden. Jede tatsaechlich erhaltene HTTP-Antwort
// (auch 401/Redirect, z. B. durch das Auth-Gate in proxy.ts) zaehlt als
// "online" -- fetch() wirft nur bei einem echten Netzwerkfehler (Timeout,
// DNS, keine Verbindung), nicht bei einem HTTP-Fehlerstatus. Erst nach
// FAILURES_BEFORE_OFFLINE aufeinanderfolgenden fehlgeschlagenen Checks
// wird die Leiste angezeigt, damit ein einzelner Ausreisser (z. B. eine
// Anfrage waehrend eines kurzen Netzwerkwechsels) keinen Fehlalarm ausloest.
const PROBE_URL = "/favicon.ico";
const PROBE_TIMEOUT_MS = 5_000;
const PROBE_INTERVAL_MS = 15_000;
const FAILURES_BEFORE_OFFLINE = 2;

// Reine Netzwerk-Pruefung, unabhaengig testbar (fetch gemockt). "/favicon.ico"
// ist bewusst gewaehlt: oeffentlich (siehe lib/authGate.ts -- vom Auth-Gate
// ausgenommen), winzig, und vom Service Worker NICHT abgefangen (public/sw.js
// cacht nur Navigationsanfragen + eine feste Liste, "/favicon.ico" ist nicht
// darunter) -- die Anfrage geht garantiert real ans Netzwerk, nicht an einen
// lokalen Cache.
export async function probeReachable(
  url: string = PROBE_URL,
  timeoutMs: number = PROBE_TIMEOUT_MS
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${url}?_=${Date.now()}`, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

interface OfflineCheckState {
  failures: number;
  offline: boolean;
}

// Reine Zustandsuebergangs-Funktion (Zaehler + Schwelle), getrennt von den
// Seiteneffekten (fetch/Timer/Event-Listener) im Effect unten -- so ist die
// eigentliche Entscheidungslogik ohne DOM/fetch-Mocking testbar.
export function nextOfflineCheckState(
  current: OfflineCheckState,
  reachable: boolean,
  failuresBeforeOffline: number = FAILURES_BEFORE_OFFLINE
): OfflineCheckState {
  if (reachable) {
    return { failures: 0, offline: false };
  }
  const failures = current.failures + 1;
  return { failures, offline: current.offline || failures >= failuresBeforeOffline };
}

export default function OfflineBanner() {
  // Server-Render und erster Client-Render zeigen bewusst identisch KEINE
  // Leiste (kein navigator-Zugriff im Initial-State) -- der echte Zustand
  // wird erst im Effect nach dem ersten Check gesetzt, damit kein
  // Hydration-Mismatch entstehen kann (gleiches Muster wie
  // ClientTimestamp.tsx).
  const [offline, setOffline] = useState(false);
  const checkState = useRef<OfflineCheckState>({ failures: 0, offline: false });
  const checkInFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const runCheck = async () => {
      if (checkInFlight.current) return;
      checkInFlight.current = true;
      const reachable = await probeReachable();
      checkInFlight.current = false;
      if (cancelled) return;

      checkState.current = nextOfflineCheckState(checkState.current, reachable);
      setOffline(checkState.current.offline);
    };

    runCheck();
    const interval = setInterval(runCheck, PROBE_INTERVAL_MS);

    // online/offline und ein Tab-Wechsel zurueck in den Vordergrund loesen
    // nur einen sofortigen Re-Check aus -- die tatsaechliche Anzeige
    // entscheidet ausschliesslich der echte Fetch-Check oben.
    const handleVisibility = () => {
      if (document.visibilityState === "visible") runCheck();
    };
    window.addEventListener("online", runCheck);
    window.addEventListener("offline", runCheck);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("online", runCheck);
      window.removeEventListener("offline", runCheck);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="sticky top-0 z-50 w-full bg-down/90 px-4 py-2 text-center text-xs font-medium text-white">
      Keine Verbindung – Marktdaten nicht aktuell.
    </div>
  );
}
