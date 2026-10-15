"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array } from "@/lib/webPush";
import { isPushOptedOut } from "@/lib/pushKeepAlive";

// Siehe lib/pushKeepAlive.ts. Laeuft einmal pro Seitenaufruf, nur wenn
// Benachrichtigungen bereits erlaubt sind (fragt nie selbst nach) und nicht
// auf /login (dort waere /api/push/subscribe ohne Session ohnehin 401).
export default function PushKeepAlive() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/login") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission !== "granted" || isPushOptedOut()) return;

    (async () => {
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
    })().catch((err) => console.warn("Push-Abo konnte nicht aufgefrischt werden:", err));
    // Bewusst nur beim ersten Laden, nicht bei jedem Seitenwechsel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
