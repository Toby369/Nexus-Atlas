// Web-Push-Konstanten und -Hilfsfunktionen fuer den Client (siehe
// components/PushNotificationSettings.tsx). Die send-state-change-push
// Edge Function (Supabase) haelt denselben VAPID_PUBLIC_KEY-Wert -- beide
// muessen zusammenpassen, sonst schlaegt pushManager.subscribe() fehl.
//
// Der Public Key ist bewusst als Klartext-Konstante hier (nicht als
// NEXT_PUBLIC_-Env-Var): VAPID-Public-Keys sind per Definition oeffentlich
// (sie werden im Klartext an den Push-Dienst des Browsers geschickt), ihre
// Geheimhaltung waere sinnlos -- nur der VAPID_PRIVATE_KEY (Supabase Vault)
// ist schuetzenswert. Eine Konstante hier spart eine zusaetzliche Vercel-
// Env-Var-Koordination fuer einen Wert, der ohnehin nicht geheim ist.
export const VAPID_PUBLIC_KEY =
  "BJWQ6WGvi9OMy_YswlA_Y9c6_SaLl-Werw94zsEZXWyKIy5el8lXl44k0MXmtIAlVx5nxf_bSeLaTOn4Fkkn20A";

// pushManager.subscribe() erwartet den VAPID-Public-Key als Uint8Array
// (applicationServerKey), nicht als base64url-String -- Standard-
// Konvertierung aus der Push-API-Dokumentation.
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
