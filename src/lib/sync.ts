// Keeping the two pages scrolled to the same place, by segment: the segment at
// the top of one page is brought to the same height on the other.

export interface Anchor {
  id: string;
  // How far below the top of the viewport the segment's top is.
  offset: number;
}

const scroller = (doc: Document) => (doc.scrollingElement ?? doc.documentElement) as HTMLElement;

// The first segment that ends below the top of the viewport.
export function anchorAt(doc: Document): Anchor | null {
  for (const element of Array.from(doc.querySelectorAll<HTMLElement>("[data-seg]"))) {
    const box = element.getBoundingClientRect();
    if (box.height > 0 && box.bottom > 4) return { id: element.getAttribute("data-seg")!, offset: box.top };
  }
  return null;
}

// Scrolls `doc` so that segment `id` sits at `offset`. Returns whether it moved.
export function scrollToAnchor(doc: Document, anchor: Anchor): boolean {
  const target = doc.querySelector<HTMLElement>(`[data-seg="${CSS.escape(anchor.id)}"]`);
  if (!target) return false;
  const box = target.getBoundingClientRect();
  const el = scroller(doc);
  const next = Math.max(0, Math.round(el.scrollTop + box.top - anchor.offset));
  if (Math.abs(next - el.scrollTop) < 2) return false;
  el.scrollTop = next;
  return true;
}

// Brings a segment into view, in the middle of the page.
export function reveal(doc: Document, id: string): void {
  const target = doc.querySelector<HTMLElement>(`[data-seg="${CSS.escape(id)}"]`);
  if (!target) return;
  const el = scroller(doc);
  const box = target.getBoundingClientRect();
  el.scrollTop = Math.max(0, el.scrollTop + box.top - doc.defaultView!.innerHeight / 3);
}

export function toggleClass(docs: Document[], id: string, cls: string, on: boolean): void {
  for (const doc of docs) {
    for (const element of Array.from(doc.querySelectorAll<HTMLElement>(`[data-seg="${CSS.escape(id)}"]`))) element.classList.toggle(cls, on);
  }
}

export function clearClass(docs: Document[], cls: string): void {
  for (const doc of docs) for (const element of Array.from(doc.querySelectorAll<HTMLElement>(`.${cls}`))) element.classList.remove(cls);
}
