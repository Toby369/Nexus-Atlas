"use client";

import { createBrowserClient } from "@supabase/ssr";

// Separater Browser-Client speziell fuers Login/Logout -- im Unterschied zu
// lib/supabase.ts (createClient aus @supabase/supabase-js, persistiert die
// Session standardmaessig im localStorage, dort fuer middleware.ts NICHT
// sichtbar) speichert createBrowserClient() aus @supabase/ssr die Session
// in Cookies. Nur so kann middleware.ts (das request.cookies liest) den
// eingeloggten Zustand ueberhaupt sehen. lib/supabase.ts bleibt fuer alle
// bestehenden, oeffentlichen Lese-Panels unveraendert -- dieser Client wird
// ausschliesslich vom Login-Formular verwendet.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

export const supabaseAuthBrowser = createBrowserClient(supabaseUrl, supabaseAnonKey);
