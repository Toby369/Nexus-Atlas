import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import OfflineBanner from "@/components/OfflineBanner";
import InstallPrompt from "@/components/InstallPrompt";

export const metadata: Metadata = {
  title: "NEXUS Atlas — BTC Marktüberwachung",
  description:
    "Live-Übersicht über BTC/USDT Perpetual Futures: Preis, Funding, Open Interest.",
  applicationName: "Nexus-Atlas",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Nexus-Atlas",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0d10",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-bg text-text">
        <ServiceWorkerRegister />
        <OfflineBanner />
        {children}
        <InstallPrompt />
      </body>
    </html>
  );
}
