// Keeping the two pages scrolled to the same place, by segment: the segment at
// the top of one page is brought to the same height on the other.

export interface Anchor {
  id: string;
  // Which of the elements with this id (the same English can be on a page more
  // than once, with one id): the pages are made by the same walk, so the nth of
  // one is the nth of the other.
  nth: number;
  // How far below the top of the viewport the segment's top is.
  offset: number;
}

// A value inside a quoted attribute selector.
const quoted = (value: string) => value.replace(/["\\]/g, "\\$&");

const scroller = (doc: Document) => (doc.scrollingElement ?? doc.documentElement) as HTMLElement;

// The first segment that ends below the top of the viewport.
export function anchorAt(doc: Document): Anchor | null {
  const seen = new Map<string, number>();
  for (const element of Array.from(doc.querySelectorAll<HTMLElement>("[data-seg]"))) {
    const id = element.getAttribute("data-seg")!;
    const nth = seen.get(id) ?? 0;
    seen.set(id, nth + 1);
    const box = element.getBoundingClientRect();
    if (box.height > 0 && box.bottom > 4) return { id, nth, offset: box.top };
  }
  return null;
}

// Scrolls `doc` so that the segment sits at `offset`. Returns whether it moved.
export function scrollToAnchor(doc: Document, anchor: Anchor): boolean {
  const all = doc.querySelectorAll<HTMLElement>(`[data-seg="${quoted(anchor.id)}"]`);
  const target = all[anchor.nth] ?? all[0];
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
  const target = doc.querySelector<HTMLElement>(`[data-seg="${quoted(id)}"]`);
  if (!target) return;
  const el = scroller(doc);
  const box = target.getBoundingClientRect();
  el.scrollTop = Math.max(0, el.scrollTop + box.top - doc.defaultView!.innerHeight / 3);
}

export function toggleClass(docs: Document[], id: string, cls: string, on: boolean): void {
  for (const doc of docs) {
    for (const element of Array.from(doc.querySelectorAll<HTMLElement>(`[data-seg="${quoted(id)}"]`))) element.classList.toggle(cls, on);
  }
}

export function clearClass(docs: Document[], cls: string): void {
  for (const doc of docs) for (const element of Array.from(doc.querySelectorAll<HTMLElement>(`.${cls}`))) element.classList.remove(cls);
}
