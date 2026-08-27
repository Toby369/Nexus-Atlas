import { config } from "dotenv";

// Next.js laedt .env.local automatisch bei "next dev"/"next build" --
// Vitest laeuft ausserhalb dieses Mechanismus und braucht das explizit.
config({ path: ".env.local" });
