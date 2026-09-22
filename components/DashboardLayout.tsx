"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DASHBOARD_TILES, DASHBOARD_TILE_IDS } from "@/lib/dashboardTiles";
import { visibleOrder, reorderWithinSubset, swapWithinSubset } from "@/lib/dashboardTabReorder";

const STORAGE_KEY = "nexus-atlas-dashboard-layout-v2";

// Spaltenbreite als 1-3 (bei lg: 3-spaltiges Grid, siehe Render unten) statt
// freier Pixelwerte -- Nutzer-Wunsch "wie im Trading Journal selbst
// vergroessern", aber ohne eine ganze Grid-Layout-Bibliothek (react-grid-
// layout o.ae.) nachzuziehen: passt sich damit sauber in dasselbe CSS-Grid
// ein, das DASHBOARD_TILES.fullWidth bereits nutzt.
const MIN_WIDTH = 1;
const MAX_WIDTH = 3;

interface StoredLayout {
  order: string[];
  minimized: string[];
  widths?: Record<string, number>;
  heights?: Record<string, number>;
}

// Kein Nutzerkonto-System vorhanden -- localStorage ist die bewusst gewaehlte
// Uebergangsloesung fuer persistente Reihenfolge/Minimiert-Zustand (Vorgabe:
// "zunaechst lokale Speicherung als saubere Uebergangsloesung").
function loadStoredLayout(): StoredLayout | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.order) || !Array.isArray(parsed?.minimized)) return null;
    return parsed as StoredLayout;
  } catch {
    return null;
  }
}

function sanitizeWidths(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const result: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (DASHBOARD_TILE_IDS.includes(id) && typeof value === "number" && Number.isFinite(value)) {
      result[id] = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));
    }
  }
  return result;
}

function sanitizeHeights(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const result: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (DASHBOARD_TILE_IDS.includes(id) && typeof value === "number" && Number.isFinite(value) && value > 0) {
      result[id] = value;
    }
  }
  return result;
}

// Gespeicherte Reihenfolge mit der aktuellen Kachel-Registry abgleichen:
// unbekannte/entfernte IDs rausfiltern, neu hinzugekommene Kacheln ans Ende
// anhaengen -- damit ein spaeter ergaenztes Panel nicht verschwindet, nur
// weil ein alter localStorage-Eintrag es noch nicht kennt.
function mergeOrder(saved: string[]): string[] {
  const known = new Set(DASHBOARD_TILE_IDS);
  const filtered = saved.filter((id) => known.has(id));
  const missing = DASHBOARD_TILE_IDS.filter((id) => !filtered.includes(id));
  return [...filtered, ...missing];
}

const titleById = Object.fromEntries(DASHBOARD_TILES.map((t) => [t.id, t.title]));
// Default-Spaltenbreite (1-3): vormals hart codiertes fullWidth wird zum
// Startwert, bleibt aber ab jetzt vom Nutzer pro Kachel veraenderbar.
const defaultWidthById = Object.fromEntries(
  DASHBOARD_TILES.map((t) => [t.id, t.fullWidth ? MAX_WIDTH : MIN_WIDTH]),
);
const sizeById = Object.fromEntries(DASHBOARD_TILES.map((t) => [t.id, t.size ?? "content"]));

// Dashboard-Aufraeumung (22.09.2026, Nutzer-Feedback "zu viele Kacheln
// unterschiedlicher Groessen" + gebilligtes Mockup): statt EINES 3-spaltigen
// CSS-Grids fuer alle Kacheln (das bei stark unterschiedlichen Hoehen grosse
// Luecken unter kuerzeren Nachbarn liess) jetzt drei getrennte Bereiche:
// "compact" (reine Kennzahl-Kacheln, siehe lib/dashboardTiles.ts) zuerst in
// einer flexiblen Reihe, "wide" (Inhalts-Kacheln mit Breite > 1) darunter
// je in eigener voller Zeile, "narrow" (Inhalts-Kacheln mit Breite 1, der
// Normalfall) in einem echten Masonry (CSS `columns`) -- dort fliessen
// Kacheln nach Hoehe gepackt in die naechste Spalte statt in einer starren
// Grid-Zeile stehenzubleiben. Der Breiten-Regler (1-3) bleibt intern
// unveraendert (Persistenz-Format kompatibel), bestimmt fuer Inhalts-
// Kacheln nur noch ob "wide" (>1) oder "narrow" (=1) gerendert wird --
// eine dritte, echte Zwischenbreite ergibt in einem Spalten-Masonry keinen
// sinnvollen zusaetzlichen Zustand.
type Category = "compact" | "wide" | "narrow";

export default function DashboardLayout({
  tiles,
  tileIds,
}: {
  tiles: Record<string, ReactNode>;
  // Kachel-IDs des aktuell aktiven Tabs (siehe components/DashboardTabNav.tsx
  // + lib/dashboardTabs.ts, 09.09.2026) -- die volle, persistierte
  // Reihenfolge/Breiten/Hoehen/Minimiert-Zustand bleiben unveraendert EIN
  // globales Set ueber ALLE Kacheln, nur die sichtbare/verschiebbare Menge
  // wird pro Aufruf auf dieses Tab eingeschraenkt (siehe
  // lib/dashboardTabReorder.ts).
  tileIds: string[];
}) {
  // Server-Render und erster Client-Render nutzen bewusst dieselbe
  // Default-Reihenfolge (kein Zugriff auf localStorage moeglich/erlaubt vor
  // der Hydration) -- der gespeicherte Zustand wird erst danach in einem
  // Effekt nachgeladen, um einen Hydration-Mismatch zu vermeiden.
  const [order, setOrder] = useState<string[]>(DASHBOARD_TILE_IDS);
  const [minimized, setMinimized] = useState<Set<string>>(new Set());
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // setState in einem Microtask-Callback statt synchron im Effekt-Body
    // (gleiches Muster wie der bestehende Poll-Zyklus in MarketStateCard) --
    // die Wiederherstellung aus localStorage passiert dadurch nach der
    // Hydration, ohne einen Hydration-Mismatch zu riskieren.
    queueMicrotask(() => {
      const stored = loadStoredLayout();
      if (stored) {
        setOrder(mergeOrder(stored.order));
        setMinimized(new Set(stored.minimized.filter((id) => DASHBOARD_TILE_IDS.includes(id))));
        setWidths(sanitizeWidths(stored.widths));
        setHeights(sanitizeHeights(stored.heights));
      }
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ order, minimized: Array.from(minimized), widths, heights }),
      );
    } catch {
      // localStorage kann in privaten Modi/eingeschraenkten Umgebungen
      // fehlschlagen -- das Layout bleibt dann nur fuer die Sitzung
      // erhalten, kein Fehlerzustand fuer den Nutzer.
    }
  }, [order, minimized, widths, heights, hydrated]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function categoryOf(id: string): Category {
    if (sizeById[id] === "compact") return "compact";
    const width = widths[id] ?? defaultWidthById[id] ?? MIN_WIDTH;
    return width > MIN_WIDTH ? "wide" : "narrow";
  }

  function categoryTileIds(category: Category): string[] {
    return tileIds.filter((id) => categoryOf(id) === category);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    // Verschieben nur innerhalb derselben Kategorie (compact/wide/narrow) --
    // die drei Bereiche liegen in getrennten Containern, ein Ziel aus einem
    // anderen Bereich ist nie ein gueltiges Drop-Ziel.
    const category = categoryOf(activeId);
    if (categoryOf(overId) !== category) return;
    const ids = categoryTileIds(category);
    setOrder((prev) => reorderWithinSubset(prev, ids, activeId, overId));
  }

  function moveTile(id: string, direction: -1 | 1) {
    const ids = categoryTileIds(categoryOf(id));
    setOrder((prev) => swapWithinSubset(prev, ids, id, direction));
  }

  function toggleMinimized(id: string) {
    setMinimized((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function changeWidth(id: string, direction: -1 | 1) {
    setWidths((prev) => {
      const current = prev[id] ?? defaultWidthById[id] ?? MIN_WIDTH;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, current + direction));
      if (next === current) return prev;
      return { ...prev, [id]: next };
    });
  }

  const handleHeightChange = useCallback((id: string, height: number) => {
    setHeights((prev) => (prev[id] === height ? prev : { ...prev, [id]: height }));
  }, []);

  // Nur die Kacheln des aktuell aktiven Tabs sind sicht-/verschiebbar --
  // die volle Reihenfolge (order) bleibt intern trotzdem das globale Array
  // ueber ALLE Kacheln (siehe lib/dashboardTabReorder.ts).
  const visible = visibleOrder(order, tileIds);
  const compactIds = visible.filter((id) => categoryOf(id) === "compact");
  const wideIds = visible.filter((id) => categoryOf(id) === "wide");
  const narrowIds = visible.filter((id) => categoryOf(id) === "narrow");

  function tileProps(id: string, idx: number, ids: string[], compact: boolean) {
    return {
      id,
      title: titleById[id] ?? id,
      compact,
      width: widths[id] ?? defaultWidthById[id] ?? MIN_WIDTH,
      height: heights[id],
      isMinimized: minimized.has(id),
      onToggleMinimize: () => toggleMinimized(id),
      onMoveUp: () => moveTile(id, -1),
      onMoveDown: () => moveTile(id, 1),
      canMoveUp: idx > 0,
      canMoveDown: idx < ids.length - 1,
      onNarrower: () => changeWidth(id, -1),
      onWider: () => changeWidth(id, 1),
      onHeightChange: handleHeightChange,
    };
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-4">
        {/* Kompakt-Reihe: reine Kennzahl-Kacheln, natuerliche Hoehe,
            nebeneinander umbrechend statt im selben Grid wie die grossen
            Inhalts-Kacheln. */}
        {compactIds.length > 0 && (
          <SortableContext items={compactIds} strategy={rectSortingStrategy}>
            <div className="flex flex-wrap items-start gap-4">
              {compactIds.map((id, idx) => (
                <div key={id} style={{ flex: "1 1 220px" }}>
                  <SortableTile {...tileProps(id, idx, compactIds, true)}>{tiles[id]}</SortableTile>
                </div>
              ))}
            </div>
          </SortableContext>
        )}

        {/* Breite Inhalts-Kacheln (Breite > 1): je eigene volle Zeile. */}
        {wideIds.length > 0 && (
          <SortableContext items={wideIds} strategy={rectSortingStrategy}>
            <div className="flex flex-col gap-4">
              {wideIds.map((id, idx) => (
                <SortableTile key={id} {...tileProps(id, idx, wideIds, false)}>
                  {tiles[id]}
                </SortableTile>
              ))}
            </div>
          </SortableContext>
        )}

        {/* Schmale Inhalts-Kacheln (Breite 1, der Normalfall): echtes
            Masonry via CSS `columns` -- Kacheln fliessen nach Hoehe gepackt
            in die naechste Spalte statt in einer starren Grid-Zeile
            steckenzubleiben (siehe Kommentar bei Category oben). */}
        {narrowIds.length > 0 && (
          <SortableContext items={narrowIds} strategy={rectSortingStrategy}>
            <div className="columns-1 lg:columns-3 gap-4">
              {narrowIds.map((id, idx) => (
                <div key={id} className="break-inside-avoid mb-4">
                  <SortableTile {...tileProps(id, idx, narrowIds, false)}>{tiles[id]}</SortableTile>
                </div>
              ))}
            </div>
          </SortableContext>
        )}
      </div>
    </DndContext>
  );
}

function SortableTile({
  id,
  title,
  compact,
  width,
  height,
  isMinimized,
  onToggleMinimize,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onNarrower,
  onWider,
  onHeightChange,
  children,
}: {
  id: string;
  title: string;
  // Kompakt-Kacheln (siehe DashboardLayout oben): kein Breiten-Regler, kein
  // freies Hoehen-Resize -- einheitliche, natuerliche Groesse.
  compact: boolean;
  width: number;
  height: number | undefined;
  isMinimized: boolean;
  onToggleMinimize: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onNarrower: () => void;
  onWider: () => void;
  onHeightChange: (id: string, height: number) => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div className="flex items-center gap-1 max-sm:gap-0.5 mb-1.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`${title} verschieben`}
          className="flex items-center justify-center touch-none cursor-grab px-1 text-text-faint hover:text-text-muted active:cursor-grabbing max-sm:h-11 max-sm:w-11 max-sm:px-0"
        >
          ⠿
        </button>
        {/* Auf Mobile-Viewports (<640px) nebeneinander statt gestapelt, damit
            jeder Reorder-Button einzeln auf mindestens 44x44px kommt, statt
            zwei 22px-hohe Haelften uebereinander (WCAG 2.5.5 Target Size). */}
        <div className="flex flex-col max-sm:flex-row max-sm:gap-0.5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            aria-label={`${title} nach oben verschieben`}
            className="flex items-center justify-center px-0.5 text-[9px] leading-[10px] text-text-faint hover:text-text-muted disabled:opacity-20 max-sm:h-11 max-sm:w-11 max-sm:px-0 max-sm:text-sm"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            aria-label={`${title} nach unten verschieben`}
            className="flex items-center justify-center px-0.5 text-[9px] leading-[10px] text-text-faint hover:text-text-muted disabled:opacity-20 max-sm:h-11 max-sm:w-11 max-sm:px-0 max-sm:text-sm"
          >
            ▼
          </button>
        </div>
        <span className="flex-1 truncate text-[10px] uppercase tracking-[0.12em] text-text-faint">
          {title}
        </span>
        {/* Breite nur ab lg: sichtbar/relevant, und nur fuer Inhalts-Kacheln
            -- Kompakt-Kacheln haben keinen Breiten-Regler (siehe compact-Prop). */}
        {!compact && (
          <div className="hidden lg:flex items-center gap-0.5">
            <button
              type="button"
              onClick={onNarrower}
              disabled={width <= MIN_WIDTH}
              aria-label={`${title} schmaler machen`}
              className="flex items-center justify-center px-1 text-[10px] text-text-faint hover:text-text-muted disabled:opacity-20"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={onWider}
              disabled={width >= MAX_WIDTH}
              aria-label={`${title} breiter machen`}
              className="flex items-center justify-center px-1 text-[10px] text-text-faint hover:text-text-muted disabled:opacity-20"
            >
              ▶
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={onToggleMinimize}
          aria-label={isMinimized ? `${title} einblenden` : `${title} minimieren`}
          className="flex items-center justify-center px-1.5 text-xs text-text-faint hover:text-text-muted max-sm:h-11 max-sm:w-11 max-sm:px-0"
        >
          {isMinimized ? "+" : "−"}
        </button>
      </div>
      {!isMinimized &&
        (compact ? (
          <div className="overflow-auto">{children}</div>
        ) : (
          <ResizableTileBody id={id} height={height} onResize={onHeightChange}>
            {children}
          </ResizableTileBody>
        ))}
    </div>
  );
}

// Freies Vergroessern/Verkleinern der Hoehe per nativem Browser-Resize-Griff
// (CSS resize:vertical) statt einer Grid-Layout-Bibliothek -- Nutzer-Wunsch
// "selbst vergroessern wie im Trading Journal". Persistiert wird nur eine
// tatsaechliche Nutzer-Ziehgeste: Hoehe wird bei pointerdown gemerkt und nur
// bei pointerup uebernommen, wenn sie sich seither veraendert hat -- reine
// Inhaltsaenderungen (neue Daten, Tab-Wechsel) loesen kein pointerdown/-up
// auf diesem Element aus und ueberschreiben die gespeicherte Hoehe daher nie.
function ResizableTileBody({
  id,
  height,
  onResize,
  children,
}: {
  id: string;
  height: number | undefined;
  onResize: (id: string, height: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const startHeightRef = useRef<number | null>(null);

  function handlePointerDown() {
    if (ref.current) {
      startHeightRef.current = ref.current.getBoundingClientRect().height;
    }
  }

  useEffect(() => {
    function handlePointerUp() {
      if (startHeightRef.current == null || !ref.current) return;
      const endHeight = ref.current.getBoundingClientRect().height;
      if (Math.abs(endHeight - startHeightRef.current) > 1) {
        onResize(id, Math.round(endHeight));
      }
      startHeightRef.current = null;
    }
    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, [id, onResize]);

  return (
    <div
      ref={ref}
      onPointerDown={handlePointerDown}
      style={{ height: height ? `${height}px` : undefined }}
      className="overflow-auto resize-y"
    >
      {children}
    </div>
  );
}
