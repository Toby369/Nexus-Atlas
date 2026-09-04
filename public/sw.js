// PWA-Erweiterung: bewusst minimaler Service Worker.
//
// Cacht AUSSCHLIESSLICH eine kleine, feste Liste statischer Assets (Icons,
// Offline-Seite). KEINE Marktdaten, KEINE API-/Supabase-Aufrufe, KEINE
// gehashten Next.js-Build-Chunks -- diese wechseln bei jedem Deploy, ein
// Cache-first-Zugriff darauf koennte nach einem Deploy veraltete Bundles
// ausliefern. Navigationsanfragen (Seitenaufrufe) laufen deshalb
// "network-first": bei bestehender Verbindung immer frisch vom Server,
// nur bei tatsaechlich fehlender Verbindung faellt die Seite auf die
// statische Offline-Seite zurueck. Alles andere (JS/CSS-Bundles, API-Calls,
// Supabase-Anfragen) laeuft unveraendert und ungecacht durchs Netzwerk.

const STATIC_CACHE = "nexus-atlas-static-v1";
const OFFLINE_URL = "/offline.html";
const STATIC_ASSETS = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  const url = new URL(request.url);
  if (url.origin === self.location.origin && STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
  // Alles andere: kein respondWith -> normaler, ungecachter Netzwerk-Passthrough.
});

// Push-Benachrichtigungen (siehe lib/webPush.ts, app/api/push/*,
// components/PushNotificationSettings.tsx, Supabase Edge Function
// send-state-change-push). Payload ist JSON: { title, body, url }.
self.addEventListener("push", (event) => {
  let payload = { title: "Nexus Atlas", body: "", url: "/" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Kein/kein gueltiges JSON -- Default-Payload oben wird verwendet.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url || "/" },
    }),
  );
});

// Klick auf die Benachrichtigung: bestehenden Dashboard-Tab fokussieren
// statt immer einen neuen zu oeffnen, falls einer bereits offen ist.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    }),
  );
});
