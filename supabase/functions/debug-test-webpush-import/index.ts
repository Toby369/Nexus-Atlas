import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";

// Repo-Kopie der deployten Debug-Funktion. Der deployte Stand enthaelt den
// privaten VAPID-Key hart im Code; hier bewusst geschwaerzt, damit er nicht
// in Git landet. Die Funktion wird nicht mehr gebraucht und sollte in
// Supabase geloescht werden (siehe docs/UEBERGABE.md).
Deno.serve(async (_req: Request) => {
  try {
    webpush.setVapidDetails("mailto:test@example.com", "BJWQ6WGvi9OMy_YswlA_Y9c6_SaLl-Werw94zsEZXWyKIy5el8lXl44k0MXmtIAlVx5nxf_bSeLaTOn4Fkkn20A", "<VAPID_PRIVATE_KEY geschwaerzt>");
    return new Response(JSON.stringify({ success: true, hasFunction: typeof webpush.sendNotification === "function" }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : null }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
