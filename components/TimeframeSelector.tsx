"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { TIMEFRAMES, type TimeframeId } from "@/lib/timeframes";

// Einziger, geteilter Zeitraum-Regler fuer das gesamte Dashboard: schreibt
// den gewaehlten Zeitraum in den "tf"-URL-Query-Param statt in lokalen
// Komponenten-State. app/page.tsx (Server Component) liest denselben Wert
// ueber die searchParams-Prop und reicht ihn an LivePricePanel,
// SpotPressurePanel und MarketContextCard weiter -- so bekommen alle drei
// garantiert denselben Zeitraum, ohne drei unabhaengige Selectors zu
// pflegen (siehe Vorgabe: "Es darf keine versteckte oder fest codierte
// Zeitraum-Logik mehr geben").
export default function TimeframeSelector({ current }: { current: TimeframeId }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(id: TimeframeId) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tf", id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex gap-1 flex-wrap">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf.id}
          type="button"
          onClick={() => select(tf.id)}
          aria-pressed={current === tf.id}
          className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
            current === tf.id
              ? "border-accent/40 bg-accent/15 text-accent"
              : "border-transparent text-text-faint hover:text-text-muted"
          }`}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
}
