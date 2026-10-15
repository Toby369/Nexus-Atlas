// Push-Abo selbst heilen (Toby 15.10.2026: "push ist heute Morgen nicht
// gekommen" -- das Abo fehlte bis zum erneuten Aktivieren in der DB und im
// Browser). Ursachen: der Browser kann ein Abo ersetzen oder verwerfen
// (pushsubscriptionchange im Service Worker scheitert, wenn die Login-Session
// gerade fehlt, weil /api/push/subscribe hinter dem Auth-Gate liegt), und die
// Edge Function loescht Abos, die der Push-Dienst mit 404/410 ablehnt.
// Deshalb bei jedem Aufruf einer eingeloggten Seite: vorhandenes Abo erneut
// speichern (Upsert), fehlendes neu anlegen -- ausser der Nutzer hat Push in
// "Konto" bewusst deaktiviert.

export const PUSH_DISABLED_KEY = "nexus-push-disabled";

export function isPushOptedOut(): boolean {
  try {
    return window.localStorage.getItem(PUSH_DISABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPushOptedOut(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(PUSH_DISABLED_KEY, "1");
    else window.localStorage.removeItem(PUSH_DISABLED_KEY);
  } catch {
    // Speicher blockiert -- dann greift die Selbstheilung eben nicht.
  }
}
