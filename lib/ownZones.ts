import { supabase } from "./supabase";

// Eigene Zonen (Toby 27.10.2026, Regel: "eigene Chart-Levels, Nexus als
// Abgleich"). Sobald mindestens eine eingetragen ist, rechnen Regelcheck,
// Plan-Satz, Kopf-Zeile und Briefing-Push damit statt mit den Nexus-Keylevels.

export interface OwnZone {
  id: number;
  price: number;
}

export async function fetchOwnZones(): Promise<OwnZone[]> {
  const { data, error } = await supabase.from("own_zones").select("id, price").order("price", { ascending: false });
  if (error || !data) {
    if (error) console.error("Eigene Zonen: Fehler beim Laden:", error.message);
    return [];
  }
  return data.map((r) => ({ id: Number(r.id), price: Number(r.price) }));
}

/** Eigene Zonen, falls vorhanden, sonst die Nexus-Keylevels. */
export function activeLevels(own: OwnZone[], nexus: { price: number }[]): { price: number }[] {
  return own.length > 0 ? own.map(({ price }) => ({ price })) : nexus.map(({ price }) => ({ price }));
}
