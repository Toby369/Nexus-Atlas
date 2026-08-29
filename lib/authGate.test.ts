import { describe, it, expect } from "vitest";
import { isPublicPath, PUBLIC_EXACT_PATHS, PUBLIC_PREFIXES } from "./authGate";

describe("isPublicPath", () => {
  it("lässt die Login-Seite ohne Session durch (sonst Redirect-Schleife)", () => {
    expect(isPublicPath("/login")).toBe(true);
  });

  it("lässt Next.js-Metadaten-Routen durch (favicon/apple-icon/manifest)", () => {
    expect(isPublicPath("/favicon.ico")).toBe(true);
    expect(isPublicPath("/apple-icon.png")).toBe(true);
    expect(isPublicPath("/manifest.webmanifest")).toBe(true);
  });

  it("lässt den Service Worker und die Offline-Seite durch", () => {
    expect(isPublicPath("/sw.js")).toBe(true);
    expect(isPublicPath("/offline.html")).toBe(true);
  });

  it("lässt PWA-Icons durch (vom Service Worker beim install-Event geladen)", () => {
    expect(isPublicPath("/icons/icon-192.png")).toBe(true);
    expect(isPublicPath("/icons/icon-512.png")).toBe(true);
    expect(isPublicPath("/icons/icon-maskable-192.png")).toBe(true);
  });

  it("lässt Next.js-Build-Assets durch (_next/static, _next/image)", () => {
    expect(isPublicPath("/_next/static/chunks/main.js")).toBe(true);
    expect(isPublicPath("/_next/image?url=%2Ficons%2Ficon-192.png")).toBe(true);
  });

  it("sperrt die Startseite (Phase 4: vollständiges Auth-Gate statt nur /reports)", () => {
    expect(isPublicPath("/")).toBe(false);
  });

  it("sperrt /reports und dessen API-Routen", () => {
    expect(isPublicPath("/reports")).toBe(false);
    expect(isPublicPath("/api/reports/run")).toBe(false);
    expect(isPublicPath("/api/reports/config")).toBe(false);
  });

  it("sperrt andere API-Routen (z.B. /api/ai/analyze)", () => {
    expect(isPublicPath("/api/ai/analyze")).toBe(false);
  });

  it("sperrt einen Pfad, der nur mit einem öffentlichen Präfix beginnt, aber keine echte Unterressource ist", () => {
    // "/icons" ohne trailing slash ist kein Praefix-Treffer -- nur
    // "/icons/..." zaehlt als oeffentliche PWA-Icon-Unterressource.
    expect(isPublicPath("/icons")).toBe(false);
  });

  it("erkennt keinen Pfad fälschlich als öffentlich, nur weil er mit einem öffentlichen exakten Pfad beginnt", () => {
    // "/login-bypass" darf NICHT durch einen (fehlerhaften) startsWith-Check
    // auf "/login" durchrutschen -- PUBLIC_EXACT_PATHS ist ein exaktes
    // Set, kein Praefix-Check.
    expect(isPublicPath("/login-bypass")).toBe(false);
    expect(isPublicPath("/loginx")).toBe(false);
  });

  it("PUBLIC_EXACT_PATHS und PUBLIC_PREFIXES sind intern konsistent mit isPublicPath", () => {
    for (const path of PUBLIC_EXACT_PATHS) {
      expect(isPublicPath(path)).toBe(true);
    }
    for (const prefix of PUBLIC_PREFIXES) {
      expect(isPublicPath(`${prefix}anything`)).toBe(true);
    }
  });
});
