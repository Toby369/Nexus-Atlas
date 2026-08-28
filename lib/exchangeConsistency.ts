// Prueft, ob die aggregierte Open-Interest-Summe ueber ein Zeitfenster
// hinweg auf einer KONSTANTEN Boersen-Menge beruht -- get_market_series/
// get_market_reference_snapshot summieren OI ueber ein festes Boersen-Array,
// ueberspringen dabei aber stillschweigend Boersen ohne Daten zu einem
// Zeitpunkt (SQL sum() ignoriert NULL). Kam eine Boerse (z.B. OKX/Bitget)
// erst WAEHREND des gewaehlten Fensters dazu, ist ein daraus berechneter
// Entwicklungs-Delta teilweise ein Boersen-Onboarding-Artefakt, keine echte
// OI-Bewegung -- siehe get_market_snapshot_exchange_first_seen()-Migration.
//
// Bewusst als reine, von React/Supabase entkoppelte Funktion gehalten, damit
// sie sowohl im Client (MarketContextCard.tsx) als auch serverseitig
// (lib/reportContext.ts) identisch verwendet werden kann.

export interface ExchangeFirstSeen {
  exchange: string;
  first_seen: string;
}

/**
 * true, wenn ALLE in `aggregatedExchanges` genannten Boersen bereits vor
 * `windowStartMs` existierten (erste Meldung <= Fensterstart) -- d.h. die
 * Boersen-Menge war ueber das gesamte Fenster konstant. false, wenn
 * mindestens eine Boerse erst innerhalb des Fensters dazukam, ODER wenn zu
 * einer Boerse noch gar keine Daten vorliegen (dann kann sie nicht "schon
 * vorher existiert" haben).
 */
export function isExchangeSetConsistentOverWindow(
  firstSeenRows: ExchangeFirstSeen[],
  aggregatedExchanges: string[],
  windowStartMs: number
): boolean {
  const firstSeenByExchange = new Map(
    firstSeenRows.map((r) => [r.exchange, new Date(r.first_seen).getTime()])
  );
  return aggregatedExchanges.every((ex) => {
    const firstSeenMs = firstSeenByExchange.get(ex);
    return firstSeenMs !== undefined && firstSeenMs <= windowStartMs;
  });
}
