import { createServerClient } from "@supabase/ssr";
import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

// Serverseitiger Bestaetigungs-Endpoint fuer Einladungs-/Passwort-Reset-
// Mails -- offizielles Supabase-Muster fuer diesen Stack (Next.js +
// @supabase/ssr + serverseitiges Auth-Gate in proxy.ts), siehe Supabase-Doku
// "Build a User Management App with Next.js". token_hash + type kommen als
// QUERY-PARAMETER (anders als ein Fragment beim Server sichtbar) und werden
// hier verifiziert, ohne auf Client-JS-Timing angewiesen zu sein.
//
// Voraussetzung: die Supabase-Mail-Templates (Einladung/Passwort-Reset)
// muessen im Dashboard auf
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite
// bzw. "...&type=recovery" zeigen (das Standard-Template nutzt
// {{ .ConfirmationURL }}, einen anderen, GoTrue-gehosteten Ablauf).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // Einladung/Passwort-Reset landen auf /account (Passwort setzen/aendern
  // noetig, kein bestehendes Passwort vorhanden bzw. gerade zurueckgesetzt)
  // -- direkt aufs Dashboard wuerde den Nutzer ohne je gesetztes Passwort
  // zuruecklassen (siehe LoginForm.tsx-Kommentar fuer dieselbe Ueberlegung).
  const next = type === "invite" || type === "recovery" ? "/account" : "/";

  const redirectTo = request.nextUrl.clone();
  redirectTo.pathname = next;
  redirectTo.searchParams.delete("token_hash");
  redirectTo.searchParams.delete("type");
  redirectTo.searchParams.delete("next");

  if (tokenHash && type) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

    let response = NextResponse.redirect(redirectTo);

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.redirect(redirectTo);
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    });

    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return response;
    }
  }

  // Ungueltiger/abgelaufener Link oder fehlende Parameter -- zurueck zu
  // /login statt einer eigenen Fehlerseite (diese App hat keine, siehe
  // app/login/page.tsx). Kein erfundener Erfolg vorgetaeuscht.
  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}
