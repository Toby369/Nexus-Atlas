// Reine Hilfsfunktionen fuer Tab-gescopte Drag-/Pfeil-Reorder-Operationen
// in components/DashboardLayout.tsx (09.09.2026, Tab-Navigation). Die
// vollstaendige Kachel-Reihenfolge bleibt EIN globales, in localStorage
// persistiertes Array (unveraendert gegenueber vor der Tab-Einfuehrung) --
// aber Drag-Handle und Pfeil-Buttons duerfen jeweils nur innerhalb der
// Kacheln des gerade sichtbaren Tabs verschieben, da ein Nachbar aus einem
// anderen Tab in der sichtbaren Liste gar nicht angezeigt wird und daher nie
// ein gueltiges Ziel sein darf.
//
// Kein React-/dnd-kit-Import hier -- reine, isoliert testbare Funktionen.

export function visibleOrder(fullOrder: string[], tileIds: string[]): string[] {
  const allowed = new Set(tileIds);
  return fullOrder.filter((id) => allowed.has(id));
}

function mergeSubsetBack(fullOrder: string[], tileIds: string[], reorderedSubset: string[]): string[] {
  const allowed = new Set(tileIds);
  let i = 0;
  return fullOrder.map((id) => (allowed.has(id) ? reorderedSubset[i++] : id));
}

// Verschiebt activeId an die Position von overId, jeweils nur innerhalb der
// durch tileIds definierten Teilmenge -- Gegenstueck zu dnd-kits
// arrayMove(), aber tab-gescopt statt auf dem vollen Array.
export function reorderWithinSubset(
  fullOrder: string[],
  tileIds: string[],
  activeId: string,
  overId: string
): string[] {
  const subset = visibleOrder(fullOrder, tileIds);
  const oldIndex = subset.indexOf(activeId);
  const newIndex = subset.indexOf(overId);
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return fullOrder;

  const reordered = [...subset];
  const [moved] = reordered.splice(oldIndex, 1);
  reordered.splice(newIndex, 0, moved);
  return mergeSubsetBack(fullOrder, tileIds, reordered);
}

// Tauscht id mit ihrem direkten Nachbarn innerhalb der sichtbaren Teilmenge
// (direction -1 = nach oben, +1 = nach unten) -- fuer die Pfeil-Buttons.
export function swapWithinSubset(
  fullOrder: string[],
  tileIds: string[],
  id: string,
  direction: -1 | 1
): string[] {
  const subset = visibleOrder(fullOrder, tileIds);
  const idx = subset.indexOf(id);
  const swapWith = idx + direction;
  if (idx === -1 || swapWith < 0 || swapWith >= subset.length) return fullOrder;

  const reordered = [...subset];
  [reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]];
  return mergeSubsetBack(fullOrder, tileIds, reordered);
}
