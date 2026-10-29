import type { SystemBriefingContext } from "./systemBriefingContext";
import { ganzzahlCh } from "./zahlCh";

// "Grundlage" unter dem System-Briefing: die wichtigsten Zahlen, die die KI
// bekommen hat, als kurze Zeilen (Vorbild AutarkTrade, Lagebild-Kachel:
// "Die KI sieht nur die Werte der Kacheln, sie stehen unter Basis";
// docs/research/AUTARK-BAUWEISE-FUER-NEXUS_2026-10-29.md, Punkt G).
//
// Gespeichert wird nur dieser Auszug (rund 1 KB je Briefing) im result des
// Snapshots, nicht der ganze Kontext -- das DB-Budget liegt bei 500 MB. Die
// KI hat mehr gesehen (Regelwerk, Chart-Struktur, Levels im Detail); der
// Auszug zeigt die Zahlen, an denen man eine Aussage nachpruefen kann.
//
// Jede Quelle darf fehlen: eine fehlende Zahl kostet eine Zeile, nicht die
// Grundlage.

export interface BasisZeile {
  id: string;
  label: string;
  text: string;
}

type BasisKontext = Pick<
  SystemBriefingContext,
  "btc_markt" | "market_state" | "market_context" | "etf_flows" | "rsi" | "liquidations" | "keyLevels" | "wirtschaftskalender" | "news" | "divergenzen"
>;

const nz = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Vorzeichenbehaftete Veraenderung in Prozent, z.B. "+1.2 %". */
const pz = (v: number | null | undefined, k = 1) => (nz(v) ? `${v > 0 ? "+" : ""}${v.toFixed(k)} %` : null);

const usd = (v: number | null | undefined) => (nz(v) ? `$${ganzzahlCh(v)}` : null);

/** Mio. USD mit Vorzeichen (ETF-Flows werden in Mio. geliefert). */
const mio = (v: number | null | undefined) => (nz(v) ? `${v > 0 ? "+" : ""}${ganzzahlCh(v)} Mio. USD` : null);

const geldGross = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)} Mrd. USD` : `${(v / 1e6).toFixed(0)} Mio. USD`);

const STATE_LABEL: Record<string, string> = {
  BULLISH: "bullisch",
  BEARISH: "bärisch",
  NEUTRAL: "neutral",
  MIXED: "gemischt",
  INSUFFICIENT_DATA: "zu wenig Daten",
};

const RISIKO_LABEL: Record<string, string> = { LOW: "niedrig", MEDIUM: "mittel", HIGH: "hoch" };

export function baueBasis(ctx: BasisKontext): BasisZeile[] {
  const zeilen: BasisZeile[] = [];
  const dazu = (id: string, label: string, teile: (string | null | false | undefined)[]) => {
    const text = teile.filter(Boolean).join(" · ");
    if (text) zeilen.push({ id, label, text });
  };

  const m = ctx.btc_markt;
  dazu("kurs", "Kurs", [
    usd(m.kurs_usd),
    pz(m.veraenderung_24h_pct) && `24h ${pz(m.veraenderung_24h_pct)}`,
    pz(m.veraenderung_7d_pct) && `7T ${pz(m.veraenderung_7d_pct)}`,
    nz(m.tief_7d_usd) && nz(m.hoch_7d_usd) && `7T-Spanne ${usd(m.tief_7d_usd)}–${usd(m.hoch_7d_usd)}`,
  ]);

  const s = ctx.market_state;
  if (s) {
    dazu("marktzustand", "Marktzustand", [
      STATE_LABEL[s.overall_state] ?? s.overall_state,
      nz(s.score) && `Score ${s.score.toFixed(0)}`,
      `Konfidenz ${s.confidence.toFixed(0)} %`,
      `Abdeckung ${s.data_coverage_pct.toFixed(0)} %`,
      s.risk_level && RISIKO_LABEL[s.risk_level] && `Risiko ${RISIKO_LABEL[s.risk_level]}`,
    ]);
  }

  const k = ctx.market_context;
  if (k) {
    dazu("marktkontext", "Marktkontext", [
      k.label,
      pz(k.price_change_pct, 2) && `Preis ${pz(k.price_change_pct, 2)}`,
      pz(k.oi_change_pct, 2) && `OI ${pz(k.oi_change_pct, 2)}`,
      k.spot_verdict_label && `Spot: ${k.spot_verdict_label}`,
    ]);
  }

  dazu("rsi", "RSI", [
    nz(ctx.rsi["4h"].aktuell) && `4H ${ctx.rsi["4h"].aktuell.toFixed(0)}`,
    nz(ctx.rsi["1d"].aktuell) && `1D ${ctx.rsi["1d"].aktuell.toFixed(0)}`,
  ]);

  const e = ctx.etf_flows;
  dazu("etf", "ETF-Flows", [
    mio(e.cumulative_usd_m) && `${e.days} Tage ${mio(e.cumulative_usd_m)}`,
    e.letzter_tag && mio(e.letzter_tag.usd_m) && `${e.letzter_tag.datum}: ${mio(e.letzter_tag.usd_m)}`,
  ]);

  const l = ctx.liquidations;
  if (l && nz(l.total_notional_usd) && l.total_notional_usd > 0) {
    dazu("liquidationen", "Liquidationen", [`${geldGross(l.total_notional_usd)} in ${l.lookback_hours} Std (Stichprobe)`]);
  }

  const levels = [...ctx.keyLevels].sort((a, b) => b.price - a.price);
  dazu("levels", "Key Levels", [
    levels.filter((x) => x.side === "resistance").length > 0 &&
      `Widerstand ${levels.filter((x) => x.side === "resistance").map((x) => ganzzahlCh(x.price)).join(", ")}`,
    levels.filter((x) => x.side === "support").length > 0 &&
      `Unterstützung ${levels.filter((x) => x.side === "support").map((x) => ganzzahlCh(x.price)).join(", ")}`,
  ]);

  if (ctx.divergenzen.length > 0) dazu("divergenzen", "Divergenzen", [ctx.divergenzen.join(", ")]);

  if (ctx.wirtschaftskalender.length > 0) {
    dazu("kalender", "Termine", [
      ctx.wirtschaftskalender.map((t) => `${t.label}${t.zeit_schweiz ? ` ${t.zeit_schweiz}` : ""}`).join(", "),
    ]);
  }

  dazu("news", "News", [`${ctx.news.count} relevante in ${ctx.news.lookback_hours} Std`]);

  return zeilen;
}
