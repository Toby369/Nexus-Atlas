import type { MetadataRoute } from "next";

// PWA-Erweiterung: Web App Manifest fuer die Installation auf dem
// Android-Homescreen. Wird von Next.js automatisch unter /manifest.webmanifest
// ausgeliefert und im <head> verlinkt -- keine manuelle Verlinkung noetig.
//
// start_url bleibt bewusst die reine Startseite ("/"): die bestehende
// Timeframe-Logik ueber Query-Parameter (z.B. "/?tf=4H") wird dadurch nicht
// beeinflusst, sie greift wie gewohnt nach dem Laden der Seite.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nexus-Atlas",
    short_name: "Nexus-Atlas",
    description: "Live-Marktüberwachung für BTC/USDT Perpetual Futures.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0b0d10",
    theme_color: "#0b0d10",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
