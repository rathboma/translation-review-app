// Reading what a translator did in a page: which segment a click or a
// selection is in. The pages are in iframes, so their nodes belong to another
// realm: nodeType is checked instead of instanceof.

export interface SegmentSelection {
  id: string;
  element: HTMLElement;
  // The selected text, and where it starts and ends in the segment's text.
  text: string;
  start: number;
  end: number;
  // Where the selection is, in its document's viewport.
  rect: { top: number; bottom: number; left: number; right: number };
}

export type SelectionResult =
  | { kind: "none" }
  // The selection runs over more than one paragraph: select within one.
  | { kind: "several" }
  | { kind: "segment"; selection: SegmentSelection };

const ELEMENT = 1;

// The nearest [data-seg] element at or above `node`.
export function segmentOf(node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    if (current.nodeType === ELEMENT && (current as Element).hasAttribute("data-seg")) return current as HTMLElement;
    current = current.parentNode;
  }
  return null;
}

// The part of `range` inside `element`.
function clip(range: Range, element: Element): Range {
  const doc = element.ownerDocument;
  const inside = doc.createRange();
  inside.selectNodeContents(element);
  if (inside.compareBoundaryPoints(Range.START_TO_START, range) < 0) inside.setStart(range.startContainer, range.startOffset);
  if (inside.compareBoundaryPoints(Range.END_TO_END, range) > 0) inside.setEnd(range.endContainer, range.endOffset);
  return inside;
}

function rectOf(range: Range, element: Element): SegmentSelection["rect"] {
  const box = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : element.getBoundingClientRect();
  return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
}

// The segment a selection is in. A selection that touches the start of the
// next paragraph (a triple click does) is still in the first one: only
// segments with selected text count.
export function readSelection(doc: Document): SelectionResult {
  const selection = doc.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return { kind: "none" };
  const range = selection.getRangeAt(0);
  const hits = Array.from(doc.querySelectorAll<HTMLElement>("[data-seg]"))
    .filter((element) => range.intersectsNode(element))
    .map((element) => ({ element, clipped: clip(range, element) }))
    .filter(({ clipped }) => clipped.toString().trim() !== "");
  if (hits.length === 0) return { kind: "none" };
  if (hits.length > 1) return { kind: "several" };
  const { element, clipped } = hits[0];
  const before = doc.createRange();
  before.selectNodeContents(element);
  before.setEnd(clipped.startContainer, clipped.startOffset);
  const text = clipped.toString();
  const start = before.toString().length;
  return { kind: "segment", selection: { id: element.getAttribute("data-seg")!, element, text, start, end: start + text.length, rect: rectOf(clipped, element) } };
}

// A click's segment: the one under the pointer.
export function clickedSegment(target: EventTarget | null): HTMLElement | null {
  return segmentOf(target as Node | null);
}
