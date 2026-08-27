import { defineConfig } from "vitest/config";
import path from "node:path";

// Erstes Test-Setup fuer dieses Projekt (Audit-Befund: kein Test-Framework
// vorhanden). Node-Umgebung reicht -- getestet wird reine Logik (lib/) und
// Live-Invarianten gegen Supabase, kein DOM/React-Rendering.
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
