"use client";

import type { ReactNode } from "react";
import OrderbookSimulator from "@/components/lernen/grundlagen/OrderbookSimulator";
import FundingCalculator from "@/components/lernen/grundlagen/FundingCalculator";
import ScenarioReader from "@/components/lernen/grundlagen/ScenarioReader";
import FootprintTrainer from "@/components/lernen/grundlagen/FootprintTrainer";
import ZoneTrainer from "@/components/lernen/grundlagen/ZoneTrainer";
import SpotPerpReader from "@/components/lernen/grundlagen/SpotPerpReader";
import PositionSizeCalculator from "@/components/lernen/grundlagen/PositionSizeCalculator";
import { LiveHint, Pill, type Tone } from "@/components/lernen/grundlagen/ui";

// Lernpfad "Wie der Bitcoin-Preis entsteht": von der Orderbuch-Mechanik ueber
// Kennzahlen mit konkreten Schwellen bis zum Risikomanagement. Ersetzt das
// fruehere Institutional Playbook: dessen Signal-Matrix steckt im Szenario-
// Leser (plus Funding), Tages-Routine und Markt-Muster sind eigene Abschnitte.

function Section({ n, title, intro, children, open }: { n: number; title: string; intro: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-lg border border-border bg-surface-raised">
      <summary className="cursor-pointer select-none list-none p-3 flex items-start gap-3">
        <span className="font-mono text-xs text-accent mt-0.5">{n}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-text">{title}</span>
          <span className="block text-xs text-text-faint mt-0.5">{intro}</span>
        </span>
        <span className="text-text-faint text-xs group-open:rotate-90 transition-transform">›</span>
      </summary>
      <div className="px-3 pb-3 space-y-3">{children}</div>
    </details>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-xs text-text-muted leading-relaxed">{children}</p>;
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[32rem] text-xs">
        <thead>
          <tr className="bg-surface">
            {head.map((h) => (
              <th key={h} className="text-left font-medium text-text-faint px-2 py-1.5 border-b border-border">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0 align-top">
              {r.map((c, j) => (
                <td key={j} className={`px-2 py-1.5 ${j === 0 ? "text-text" : "text-text-muted"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Steps({ items }: { items: { title: string; body: string }[] }) {
  return (
    <ol className="space-y-2">
      {items.map((s, i) => (
        <li key={s.title} className="flex gap-2">
          <span className="font-mono text-xs text-accent w-4 shrink-0">{i + 1}</span>
          <span className="text-xs text-text-muted">
            <span className="font-medium text-text">{s.title}</span> {s.body}
          </span>
        </li>
      ))}
    </ol>
  );
}

const METRICS: { name: string; what: string; levels: [string, Tone][] }[] = [
  {
    name: "Open Interest (OI)",
    what: "Summe aller offenen Kontrakte. Steigendes OI heisst: neuer Hebel kommt in den Markt. Erst zusammen mit dem Preis aussagekräftig.",
    levels: [
      ["Ruhig: unter ±1 % in 24 h", "neutral"],
      ["Aufbau: +3 bis +5 % in 24 h", "watch"],
      ["Extrem: über +8–10 % in 24 h, besonders bei flachem Preis", "bearish"],
    ],
  },
  {
    name: "Basis (Perp-Prämie gegenüber Spot)",
    what: "Gleiche Idee wie Funding, über den Preisabstand gemessen.",
    levels: [
      ["Normal: −0,05 bis +0,05 %", "neutral"],
      ["Crowding Longs (Nexus): über +0,15 %", "bearish"],
      ["Crowding Shorts (Nexus): unter −0,15 %", "bullish"],
    ],
  },
  {
    name: "CME-Basis (annualisiert)",
    what: "Prämie des CME-Futures gegenüber Spot pro Jahr. Zeigt institutionelle Nachfrage und wie attraktiv der Basis-Trade ist. Nexus zeigt die Deribit-Termin-Basis als Näherung in der ETF-Kachel (Ø 2024: 11,7 %, 2026 bisher: 2,9 %).",
    levels: [
      ["Schwach: unter ca. 5 % p.a.", "bearish"],
      ["Normal: ca. 5–10 % p.a.", "neutral"],
      ["Überhitzt: über ca. 15–20 % p.a.", "watch"],
    ],
  },
  {
    name: "Coinbase-Premium",
    what: "Preisabstand Coinbase (USD) zu Binance (USDT). Zeigt, ob US-Institutionen kaufen oder verkaufen.",
    levels: [
      ["US-Kaufdruck: ab +0,03 %", "bullish"],
      ["Neutral: unter ±0,03 %", "neutral"],
      ["US-Verkaufsdruck: ab −0,03 %", "bearish"],
    ],
  },
  {
    name: "Liquidationen",
    what: "Zwangsschliessungen gehebelter Positionen, ausgeführt als Market-Order. Sie verstärken jede Bewegung.",
    levels: [
      ["Hintergrund: vereinzelte Events", "neutral"],
      ["Cascade (Nexus): ≥ 3 Liquidationen in 2 Minuten", "watch"],
      ["Flush: grosser Teil des OI in Stunden weg", "bearish"],
    ],
  },
  {
    name: "Fear & Greed Index",
    what: "Stimmung von 0 bis 100. Nexus liest sie konträr: Extreme sind Warnzeichen.",
    levels: [
      ["Extreme Angst: unter ca. 25 → konträr bullisch", "bullish"],
      ["Neutral: ca. 45–55", "neutral"],
      ["Extreme Gier: über ca. 75 → konträr bärisch", "bearish"],
    ],
  },
  {
    name: "Put/Call-Ratio (Deribit)",
    what: "Offene Puts (Absicherung) im Verhältnis zu offenen Calls (Wetten nach oben).",
    levels: [
      ["Bullisch (Nexus): unter 0,7", "bullish"],
      ["Neutral: 0,7 bis 1,1", "neutral"],
      ["Bärisch (Nexus): über 1,1", "bearish"],
    ],
  },
];

const PATTERNS: { name: string; tone: Tone; tag: string; body: string }[] = [
  {
    name: "Institutional Inflow",
    tone: "bullish",
    tag: "Bullisch",
    body: "Spot-Kaufdruck und steigendes OI bei hohem Überzeugungsgrad, ohne Liquidations-Cascade. Kaufkraft und neue Positionen kommen gleichzeitig.",
  },
  {
    name: "Overleveraged Top",
    tone: "watch",
    tag: "Warnsignal",
    body: "Anhaltende Trendausweitung bei stark positivem Funding und hohem OI. Der Markt ist einseitig long und anfällig für eine plötzliche Gegenbewegung.",
  },
  {
    name: "Flush & Bottom",
    tone: "bearish",
    tag: "Bärisch",
    body: "Long-Liquidations-Cascade mit fallendem OI, während Spot Pressure von Verkauf Richtung neutral oder Kauf dreht. Klassische Kapitulation, kein garantierter Boden.",
  },
  {
    name: "Range Breakout",
    tone: "neutral",
    tag: "Neutral",
    body: "Auf einen Volatilitäts-Squeeze (niedriger ADX, enge Bollinger-Bänder) folgt eine Trendausweitung mit steigendem OI in dieselbe Richtung.",
  },
];

export default function GrundlagenPanel({
  liveFundingPct,
  livePrice,
}: {
  liveFundingPct: number | null;
  livePrice: number | null;
}) {
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-accent/25 bg-surface-raised p-3">
        <p className="text-sm text-text leading-relaxed">
          Der Preis bewegt sich, wenn eine Seite aggressiver kauft oder verkauft, als die andere Seite Liquidität
          bereitstellt. Makro, ETFs, Hebel und News wirken alle über diesen einen Mechanismus.
        </p>
      </div>

      <Section n={1} title="Mechanik: das Orderbuch" intro="Wie aus Orders ein Preis wird." open>
        <P>
          Limit-Orders stehen im Buch und warten. Market-Orders kaufen oder verkaufen sofort und fressen sich durch die
          Preisstufen. Der Kurs im Chart ist einfach der Preis des letzten Handels.
        </P>
        <OrderbookSimulator />
        <LiveHint>
          „Orderbuch-Wände“ zeigt grosse stehende Limit-Orders. Spot Pressure und CVD messen, wer aggressiv per
          Market-Order handelt.
        </LiveHint>
      </Section>

      <Section n={2} title="Zonen: wo sich der Markt entscheidet" intro="Erst Zonen einzeichnen, dann an ihnen handeln.">
        <P>
          Der Preis wandert von Zone zu Zone. An jeder Zone entscheidet sich, ob Käufer oder Verkäufer gewinnen. Gehandelt
          wird nur diese Entscheidung, nie der Weg dazwischen. Zeichne Zonen statt Linien: vom Docht bis zum Kerzenkörper an
          der Umkehrstelle, bei BTC meist 200–600 USD breit.
        </P>
        <Table
          head={["Zonen-Art", "Woran du sie findest", "Bemerkung"]}
          rows={[
            ["Letzte klare Hochs und Tiefs", "Stellen, an denen der Preis scharf gedreht hat", "Die wichtigste Art"],
            ["Range-Ränder", "Ober- und Unterkante einer Seitwärtsphase, mehrfach berührt", "In der Mitte gibt es keinen Trade"],
            ["Ausbruchslevel", "Alter Widerstand, der durchbrochen wurde", "Wird beim Retest zur Unterstützung (und umgekehrt)"],
            ["Volumenstufen", "Lange Balken im Volumenprofil (POC, Value-Area-Kanten)", "Akzeptierter Preis, oft Stütze"],
            ["Runde Zahlen", "80'000, 85'000, 90'000", "Viele Orders, Stops knapp dahinter"],
          ]}
        />
        <Steps
          items={[
            { title: "Starke Reaktion?", body: "Ein schneller, grosser Abprall zählt, ein Gezitter nicht." },
            { title: "Mehrfach berührt?", body: "Zwei bis drei Berührungen bestätigen eine Zone." },
            { title: "Grosser Zeitrahmen?", body: "Eine Zone aus dem Tageschart schlägt eine aus 15 Minuten." },
            { title: "Jung?", body: "Zonen der letzten Tage und Wochen zählen mehr als alte." },
            { title: "Mehrere Gründe?", body: "Hoch, Volumenstufe und runde Zahl am selben Ort ergeben die beste Zone." },
          ]}
        />
        <p className="text-xs font-medium text-text">Routine vor jeder Session (10 Minuten)</p>
        <Steps
          items={[
            { title: "Tageschart:", body: "letztes grosses Hoch und Tief, Lage zur D13. Je eine Zone darüber und darunter." },
            { title: "4H-Chart:", body: "Trend oder Range? Range-Ränder oder letztes Ausbruchslevel einzeichnen." },
            { title: "1H-Chart:", body: "nächste Zone oben und unten, Volumenprofil einblenden." },
            { title: "Aufschreiben:", body: "„Über X Longs am Retest, unter Y Shorts, dazwischen nichts.“ Höchstens 5–6 Zonen insgesamt." },
          ]}
        />
        <ZoneTrainer />
        <LiveHint>
          Die Keylevels in der Struktur-Kachel und die Level-Struktur unter Wissen → Mein System schlagen Zonen vor.
          Zeichne zuerst deine eigenen und vergleiche danach. Der Trade-Entscheider unter Mein System beginnt mit genau diesen
          Zonen-Fragen.
        </LiveHint>
      </Section>

      <Section n={3} title="Footprint: in die Kerze schauen" intro="Wer war aggressiv, wer hat passiv gehalten?">
        <P>
          Ein Footprint zeigt pro Preisstufe einer Kerze, wie viel aggressiv verkauft (Bid, links) und aggressiv gekauft
          (Ask, rechts) wurde. Delta ist Ask minus Bid. Aggressive Orders bewegen den Preis, passive Limit-Orders können
          ihn stoppen. Genau das macht der Footprint sichtbar.
        </P>
        <Table
          head={["Muster", "So sieht es aus", "Bedeutung"]}
          rows={[
            ["Absorption", "Viel aggressives Volumen, aber kaum Preisfortschritt", "Passive Gegenseite ist stärker. Am Hoch bärisch, am Tief bullisch."],
            ["Erschöpfung", "Am Extrem fast kein Volumen mehr", "Bewegung läuft aus, keine neuen Aggressoren."],
            ["Echter Ausbruch", "Gestapelte Ungleichgewichte, Schluss am Extrem", "Initiative: eine Seite räumt das Buch ab."],
            ["Unfertige Auktion", "Am Extrem auf beiden Seiten deutlich Volumen", "Markt kommt oft zurück, um die Stufe zu testen."],
            ["Gefangene Trader", "Viel Aggression am Extrem, dann Schluss auf der Gegenseite", "Ihre Stops sind Treibstoff für die Gegenbewegung."],
            ["Delta-Divergenz", "Höheres Hoch, aber kleineres Delta als am letzten Hoch", "Käufer werden schwächer (am Tief spiegelbildlich)."],
          ]}
        />
        <FootprintTrainer />
        <Steps
          items={[
            { title: "Nur am Ort lesen:", body: "Keylevel, VWAP, letzte Hochs und Tiefs. Mitten in der Range sagt ein Footprint wenig." },
            { title: "Am Retest:", body: "zuerst Absorption am Level, dann Dominanzwechsel (Delta dreht), erst danach der Einstieg." },
            { title: "Zeitrahmen:", body: "5 oder 15 Minuten. Auf 1 Minute ist BTC zu laut." },
            { title: "Bestätigung, kein System:", body: "Im Nexus-Backtest war Absorption allein nicht profitabel. Das Chance-Risiko muss nach der Bestätigung noch aufgehen." },
          ]}
        />
        <LiveHint>
          „CVD-Footprint“ unter Wissen → Mein System zeigt das Delta pro Stunde, das Spot-Volumenprofil im Marktkontext
          das Volumen pro Preis. Einen echten Footprint mit Bid × Ask pro Stufe gibt es in TradingView (Premium),
          Exocharts oder ATAS.
        </LiveHint>
      </Section>

      <Section n={4} title="Wer den Preis bewegt" intro="Akteure und ihr Zeithorizont.">
        <Table
          head={["Akteur", "Horizont", "Verhalten", "In Nexus"]}
          rows={[
            ["Spot-ETFs, Institutionen", "Wochen–Monate", "Grosse, stetige Zu- oder Abflüsse.", "ETF-Flows & Makro, Coinbase-Premium"],
            ["Basis-Trader (Hedgefonds)", "Wochen–Monate", "Kaufen Spot/ETF, verkaufen Futures, kassieren die Prämie ohne Richtungswette. Ein Teil der ETF-Flows stammt von ihnen.", "Termin-Basis (ETF-Kachel)"],
            ["Treasury-Firmen", "Monate–Jahre", "Kaufen in Tranchen, oft über Anleihen finanziert.", "—"],
            ["Wale, Langzeithalter", "Monate", "Verkaufen in Stärke, kaufen in Schwäche.", "—"],
            ["Miner", "laufend", "Verkaufen BTC für Strom und Hardware. Konstanter, kleiner Verkaufsdruck.", "—"],
            ["Market Maker", "Sekunden", "Stellen Liquidität, verdienen am Spread. Bestimmen, wie dick das Buch ist.", "Orderbuch-Wände"],
            ["Options-Dealer", "Stunden–Tage", "Sichern ihre Bücher laufend ab und dämpfen oder verstärken so Bewegungen.", "Put/Call-Ratio"],
            ["Hebel-Trader (Perps)", "Minuten–Tage", "Grösster kurzfristiger Treiber; ihre Liquidationen verstärken jede Bewegung.", "OI Change, Funding, Liquidationen, Hebelkarte"],
            ["Retail", "emotional", "Kommt spät (FOMO) und geht in Panik.", "Faktor „sentiment“"],
          ]}
        />
      </Section>

      <Section n={5} title="Kennzahlen mit klaren Schwellen" intro="Ab wann ein Wert normal, erhöht oder extrem ist.">
        <FundingCalculator liveFundingPct={liveFundingPct} />
        <Steps
          items={[
            { title: "Hohes Funding allein ist kein Short-Signal.", body: "Im Aufwärtstrend bleibt es oft wochenlang erhöht." },
            { title: "Gefährlich wird die Kombination:", body: "Funding extrem, OI steigt stark, der Preis kommt nicht mehr voran." },
            { title: "Achte auf die Dauer.", body: "Erst mehrere Intervalle in Folge über 0,05 % zeigen echtes Crowding." },
          ]}
        />
        <div className="space-y-3">
          {METRICS.map((m) => (
            <div key={m.name} className="space-y-1.5 border-t border-border/60 pt-3">
              <p className="text-xs font-medium text-text">{m.name}</p>
              <P>{m.what}</P>
              <div className="flex flex-wrap gap-1.5">
                {m.levels.map(([text, tone]) => (
                  <Pill key={text} tone={tone}>
                    {text}
                  </Pill>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-text-faint">
          Faustregeln und Nexus-Konfigurationswerte, keine im Backtest validierten Signale.
        </p>
        <LiveHint>Funding-Kachel (mit Stufe), OI Change, Liquidationen, Gesamteinschätzung (Faktoren).</LiveHint>
      </Section>

      <Section n={6} title="Szenarien lesen und Tages-Routine" intro="Preis, OI und Funding zusammen lesen.">
        <ScenarioReader />
        <p className="text-xs font-medium text-text">Tages-Routine</p>
        <Steps
          items={[
            {
              title: "Lagebild prüfen.",
              body: "Überzeugungsgrad und Risiko zuerst. Unter 35/100 zeigt Nexus bewusst „Unklar“; das ist auch die Grenze für jede weitere Interpretation.",
            },
            {
              title: "Marktkontext lesen.",
              body: "Preis, OI und Spot-Flow ergeben das Szenario; „Wer treibt“ zeigt, ob Spot oder Hebel die Bewegung trägt.",
            },
            { title: "Funding-Stufe prüfen.", body: "Ist eine Seite überfüllt? Dann den Szenario-Leser oben mit Funding gegenlesen." },
            { title: "Liquidationen prüfen.", body: "Läuft eine Cascade (≥ 3 Events in 2 Minuten)? Die Hebelkarte zeigt, wo die nächste liegen könnte." },
          ]}
        />
        <LiveHint>Marktkontext-Kachel (OI/Preis-Quadrant und „Wer treibt“), Lagebild oben im Dashboard.</LiveHint>
      </Section>

      <Section n={7} title="Kaskaden und Markt-Muster" intro="Wie aus einem Rücksetzer ein Crash wird.">
        <Steps
          items={[
            { title: "Hebel baut sich auf.", body: "OI steigt, Funding wird stark positiv, viele Stops knapp unter einem offensichtlichen Tief." },
            { title: "Der Preis fällt unter das Tief.", body: "Stop-Losses lösen aus, das sind Market-Verkäufe." },
            { title: "Erste Liquidationen.", body: "Die Börse schliesst Positionen ohne Margin zwangsweise, wieder per Market-Order." },
            { title: "Kettenreaktion.", body: "Jeder Verkauf drückt den Preis zur nächsten Liquidationszone. Das Buch wird dünn." },
            { title: "Erschöpfung.", body: "Der Hebel ist weg (OI fällt stark), Funding wird neutral oder negativ. Oft folgt eine schnelle Gegenbewegung." },
          ]}
        />
        <P>
          Grosse Spieler brauchen Gegenparteien. Deshalb läuft der Preis oft gezielt in Zonen mit vielen Stops: unter
          offensichtliche Tiefs, über offensichtliche Hochs, an runde Zahlen. So entstehen Fakeouts und Liquidity Sweeps.
        </P>
        <p className="text-xs font-medium text-text">Markt-Muster</p>
        <div className="space-y-2">
          {PATTERNS.map((p) => (
            <div key={p.name} className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-text">{p.name}</span>
                <Pill tone={p.tone}>{p.tag}</Pill>
              </div>
              <P>{p.body}</P>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-text-faint">Orientierung anhand vorhandener Kacheln, kein eigenständiges Handelssignal.</p>
        <LiveHint>„Liquidationen“ zeigt, was passiert ist; die „Liquidations-/Hebelkarte“, wo es als Nächstes knallen könnte.</LiveHint>
      </Section>

      <Section n={8} title="Wer treibt wirklich: Spot, Perp, CME, Optionen" intro="Echte Nachfrage oder nur Hebel?">
        <SpotPerpReader />
        <Steps
          items={[
            {
              title: "Basis-Trade:",
              body: "Hedgefonds kaufen Spot oder ETF und verkaufen CME-Futures. Nicht jeder ETF-Zufluss ist eine Wette auf steigende Kurse, und beim Auflösen entstehen Abflüsse ohne bärische Meinung.",
            },
            {
              title: "COT-Report:",
              body: "„Leveraged Funds“ sind auf der CME oft stark netto short. Das ist grösstenteils die Absicherung des Basis-Trades, kein Crash-Signal. Daten mit Stand Dienstag, veröffentlicht am Freitag.",
            },
            {
              title: "CME-Gaps:",
              body: "Entstehen, weil die CME am Wochenende schliesst. Dass sie „immer geschlossen werden“, ist eine Behauptung mit Selektionsfehler. Ohne eigenen Backtest kein Setup.",
            },
            {
              title: "Dealer-Gamma:",
              body: "Sind Dealer long Gamma, kaufen sie Rücksetzer und verkaufen Anstiege; der Preis klebt an grossen Strikes. Sind sie short Gamma, beschleunigen sich Bewegungen.",
            },
            {
              title: "Optionsverfall:",
              body: "Deribit freitags 08:00 UTC; Monats- und vor allem Quartalsverfall sind gross. Danach fällt das Pinning weg. „Max Pain“ ist als Kursmagnet schwach belegt.",
            },
          ]}
        />
        <LiveHint>Marktkontext → „Wer treibt: Spot, Perp, Coinbase“ mit Live-Werten und CVD-Verlauf.</LiveHint>
      </Section>

      <Section n={9} title="Makro, Flows und Zyklus" intro="Was die Richtung über Wochen und Monate bestimmt.">
        <Table
          head={["Treiber", "Gut für BTC", "Schlecht für BTC", "In Nexus"]}
          rows={[
            ["Zinsen, Fed", "Zinssenkungen, lockere Geldpolitik", "Höhere Zinsen als erwartet", "Wirtschaftskalender (FOMC)"],
            ["Inflation (CPI, PCE)", "tiefer als erwartet", "höher als erwartet", "Wirtschaftskalender"],
            ["US-Dollar (DXY)", "schwächer", "stärker", "Faktor „macro“"],
            ["Aktien, VIX", "Risk-On, tiefer VIX", "Risk-Off, VIX-Spitzen", "Faktor „macro“"],
            ["ETF-Flows", "anhaltende Zuflüsse", "mehrtägige Abflüsse", "ETF-Flows & Makro"],
            ["Stablecoin-Angebot", "wächst", "schrumpft", "—"],
            ["Börsen-Bestände", "BTC fliesst ab", "BTC fliesst zu", "—"],
            ["Halving-Zyklus", "Angebot halbiert sich alle ~4 Jahre", "späte Zyklusphase, Überhitzung", "Zyklus-Indikatoren"],
            ["Regulierung, News", "Zulassungen, Klarheit", "Verbote, Hacks, Klagen", "News & Risiko"],
          ]}
        />
        <P>
          Märkte handeln die Abweichung von der Erwartung. Ein CPI von 3,0 % ist bullisch, wenn 3,2 % erwartet waren, und
          bärisch, wenn 2,8 % erwartet waren.
        </P>
      </Section>

      <Section n={10} title="Risiko: der Teil, der profitabel macht" intro="Zuerst festlegen, wie viel du verlieren darfst.">
        <PositionSizeCalculator livePrice={livePrice} />
        <Steps
          items={[
            { title: "0,5–1 % Risiko pro Trade,", body: "nie mehr als 2 %." },
            { title: "Stop dort, wo die Idee falsch ist,", body: "nicht dort, wo der Verlust angenehm klein ist." },
            { title: "Nach drei Verlusten in Folge:", body: "Pause bis zum nächsten Tag." },
            { title: "Edge beweisen:", body: "ein Setup, schriftlich, mindestens 30–50 Trades im Journal, Erwartungswert nach Gebühren positiv." },
          ]}
        />
        <LiveHint>Derselbe Rechner steht unter Wissen → Mein System, mit dem aktuellen Preis als Entry.</LiveHint>
      </Section>

      <p className="text-[11px] text-text-faint pt-1">
        Die Selbsttest-Fragen zu diesen Kapiteln liegen im Karteikasten (Kategorie „Grundlagen“). Lernmaterial, keine
        Anlageberatung.
      </p>
    </div>
  );
}
