// Ganze Zahl im Schweizer Format mit typografischem Apostroph: 79’838.
//
// toLocaleString("de-CH") haengt an der ICU/CLDR-Version der Laufzeit: Node
// 22.22 (ICU 77, CLDR 47) liefert "’", der GitHub-Runner mit neuerer Node-22-
// Version am 29.10.2026 ein gerades "'". Fuer Texte, die in Push-Nachrichten
// und Tests landen, wird das Trennzeichen deshalb hier festgelegt.
export function ganzzahlCh(n: number): string {
  return n.toLocaleString("de-CH", { maximumFractionDigits: 0 }).replace(/['’]/g, "’");
}
