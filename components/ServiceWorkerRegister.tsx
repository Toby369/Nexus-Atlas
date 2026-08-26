"use client";

import { useEffect } from "react";

// PWA-Erweiterung: registriert den (bewusst minimalen, siehe public/sw.js)
// Service Worker. Rein additiv -- betrifft keine bestehende Datenlogik.
// Nur in Production, damit der Next.js-Dev-Modus (Hot Reload) nicht mit
// einem gecachten Service Worker kollidiert.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service-Worker-Registrierung fehlgeschlagen:", err);
    });
  }, []);

  return null;
}
