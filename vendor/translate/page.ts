// A built English page, parsed once: its body segments, its head segments
// and the context the model gets with them.
import { elements, parseDocument, serializeDocument, type Document, type Element } from "./dom.ts";
import { blankDates, headSegments, outline, type HeadSegment } from "./head.ts";
import { body, segments, type Segment } from "./segments.ts";
import { apply } from "./translator.ts";

export interface Page {
  doc: Document;
  body: Element;
  segments: Segment[];
  head: { segments: HeadSegment[]; commit(): void };
  title: string;
  headings: string[];
}

export function parsePage(html: string): Page | null {
  const doc = parseDocument(html);
  const bodyEl = body(doc);
  if (!bodyEl) return null;
  return { doc, body: bodyEl, segments: segments(bodyEl), head: headSegments(doc), ...outline(doc) };
}

// The page with every segment blanked out: its markup, scripts, styles and
// asset urls without its text. A change here (a renamed class, a new
// stylesheet digest) means the translated copy must be put together again,
// though nothing needs translating.
export function skeleton(html: string): string {
  const page = parsePage(html);
  if (!page) return html;
  apply(page.body, () => "");
  for (const segment of page.head.segments) segment.set("");
  page.head.commit();
  blankDates(page.doc);
  // Attribute order is not markup (see sortAttributes in assets.ts).
  for (const el of elements(page.doc)) el.attrs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return serializeDocument(page.doc);
}
