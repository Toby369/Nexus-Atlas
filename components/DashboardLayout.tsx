"use client";

import { useEffect, useState, type ReactNode } from "react";
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
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DASHBOARD_TILES, DASHBOARD_TILE_IDS } from "@/lib/dashboardTiles";

const STORAGE_KEY = "nexus-atlas-dashboard-layout-v1";

interface StoredLayout {
  order: string[];
  minimized: string[];
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

export default function DashboardLayout({ tiles }: { tiles: Record<string, ReactNode> }) {
  // Server-Render und erster Client-Render nutzen bewusst dieselbe
  // Default-Reihenfolge (kein Zugriff auf localStorage moeglich/erlaubt vor
  // der Hydration) -- der gespeicherte Zustand wird erst danach in einem
  // Effekt nachgeladen, um einen Hydration-Mismatch zu vermeiden.
  const [order, setOrder] = useState<string[]>(DASHBOARD_TILE_IDS);
  const [minimized, setMinimized] = useState<Set<string>>(new Set());
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
      }
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ order, minimized: Array.from(minimized) }),
      );
    } catch {
      // localStorage kann in privaten Modi/eingeschraenkten Umgebungen
      // fehlschlagen -- das Layout bleibt dann nur fuer die Sitzung
      // erhalten, kein Fehlerzustand fuer den Nutzer.
    }
  }, [order, minimized, hydrated]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  function moveTile(id: string, direction: -1 | 1) {
    setOrder((prev) => {
      const idx = prev.indexOf(id);
      const swapWith = idx + direction;
      if (idx === -1 || swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return next;
    });
  }

  function toggleMinimized(id: string) {
    setMinimized((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <div className="space-y-4">
          {order.map((id, idx) => (
            <SortableTile
              key={id}
              id={id}
              title={titleById[id] ?? id}
              isMinimized={minimized.has(id)}
              onToggleMinimize={() => toggleMinimized(id)}
              onMoveUp={() => moveTile(id, -1)}
              onMoveDown={() => moveTile(id, 1)}
              canMoveUp={idx > 0}
              canMoveDown={idx < order.length - 1}
            >
              {tiles[id]}
            </SortableTile>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableTile({
  id,
  title,
  isMinimized,
  onToggleMinimize,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  children,
}: {
  id: string;
  title: string;
  isMinimized: boolean;
  onToggleMinimize: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
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
        <button
          type="button"
          onClick={onToggleMinimize}
          aria-label={isMinimized ? `${title} einblenden` : `${title} minimieren`}
          className="flex items-center justify-center px-1.5 text-xs text-text-faint hover:text-text-muted max-sm:h-11 max-sm:w-11 max-sm:px-0"
        >
          {isMinimized ? "+" : "−"}
        </button>
      </div>
      {!isMinimized && children}
    </div>
  );
}
