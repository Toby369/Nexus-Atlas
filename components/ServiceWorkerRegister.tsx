"use client";

import { useEffect } from "react";
import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array } from "@/lib/webPush";

// PWA-Erweiterung: registriert den (bewusst minimalen, siehe public/sw.js)
// Service Worker. Nur in Production, damit der Next.js-Dev-Modus (Hot
// Reload) nicht mit einem gecachten Service Worker kollidiert.
//
// Push-Selbstheilung: Hat der Nutzer Push erlaubt, wird bei jedem Oeffnen
// still das aktuelle Abo an /api/push/subscribe gemeldet (Upsert auf
// endpoint) -- und neu erstellt, falls der Browser es verworfen hat.
// Anlass 12.10.2026: das Abo auf dem Handy verschwand zweimal innerhalb
// weniger Stunden (Push-Dienst meldete es als abgelaufen, die Edge Function
// loeschte es), danach kamen keine Briefing-Pushes mehr an.
async function refreshPushSubscription() {
  if (!("PushManager" in window) || Notification.permission !== "granted") return;
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    }));
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
}

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => refreshPushSubscription())
      .catch((err) => {
        console.error("Service-Worker-/Push-Registrierung fehlgeschlagen:", err);
      });
  }, []);

  return null;
}
