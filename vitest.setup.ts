import { config } from "dotenv";

// Next.js laedt .env.local automatisch bei "next dev"/"next build" --
// Vitest laeuft ausserhalb dieses Mechanismus und braucht das explizit.
config({ path: ".env.local" });

// Ohne .env.local (frischer Checkout, CI) wuerde lib/supabase.ts schon beim
// Import werfen und damit auch reine Logik-Tests reissen, die Supabase gar
// nicht aufrufen. Platzhalter genuegen dafuer -- die Live-Integrationstests
// (tests/) brauchen weiterhin echte Werte aus .env.local.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
