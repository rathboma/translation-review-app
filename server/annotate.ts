// A page for review: the English page and the translated copy of it, both
// marked up with `data-seg="<id>"` on the element of every html segment (a bare
// text node is wrapped in <span data-seg>), plus the list of segments with
// what the copy says for each.
//
// The two pages are cut into segments by the translation Worker's own code
// (vendor/translate), and the nth segment of one is taken to be the nth of the
// other: the copy is the English page with its text replaced, so they line up.
// When they don't (the English page changed since the copy was made: a
// paragraph more, a different kind of element) nothing is paired, since one
// extra paragraph would put every translation after it on the wrong English:
// the segments show no translation, and `aligned` is false.
//
// A segment here is a distinct (scope, key): the same English twice on a page is
// one segment with one id, on every element that holds it, because a correction
// changes both. Attribute and head segments are in the list but not in the markup.
import { defaultTreeAdapter, html as parse5Html } from "parse5";
import { serializeDocument, setAttr, type Element, type ParentNode, type TextNode } from "../vendor/translate/dom.ts";
import { parsePage, type Page } from "../vendor/translate/page.ts";
import type { Segment, SegmentKind } from "../shared/types.ts";

export class NotAPage extends Error {}

export interface Annotated {
  // Whether the copy's segments are the English page's, one for one.
  aligned: boolean;
  english: string;
  translated: string;
  segments: Segment[];
}

interface Item {
  kind: SegmentKind;
  scope: string | null;
  // The English (for the translated page: what it says there). Asset digests
  // are out of it, as they are out of the Worker's keys.
  key: string;
  where: string;
  node?: Element | TextNode;
  attr?: string;
}

// The body's segments and attributes, then the head's, in the Worker's order.
function items(page: Page): Item[] {
  const body = page.segments.map((s): Item => ({ kind: s.kind, scope: s.scope, key: s.key, where: s.where, node: s.node, attr: s.attr }));
  const head = page.head.segments.map((h): Item => ({ kind: "head", scope: null, key: h.key, where: h.where }));
  return [...body, ...head];
}

const idOf = (scope: string | null, key: string) => `${scope ?? ""}\t${key}`;

// <span data-seg> around each text node, once all the walking is done (a span
// would make its text an html segment of its own).
function wrap(texts: [TextNode, string][]): void {
  for (const [node, id] of texts) {
    const parent = node.parentNode as ParentNode;
    const span = defaultTreeAdapter.createElement("span", parse5Html.NS.HTML, [{ name: "data-seg", value: id }]);
    defaultTreeAdapter.insertBefore(parent, span, node);
    defaultTreeAdapter.detachNode(node);
    defaultTreeAdapter.appendChild(span, node);
  }
}

export function annotate(english: string, translated: string): Annotated {
  const en = parsePage(english);
  const tr = parsePage(translated);
  if (!en) throw new NotAPage("the English page has no <body>");
  if (!tr) throw new NotAPage("the translated page has no <body>");
  const own = items(en);
  const copy = items(tr);

  const ids = new Map<string, Segment>();
  const texts: [TextNode, string][] = [];
  const mark = (item: Item, id: string) => {
    if (item.kind === "html") setAttr(item.node as Element, "data-seg", id);
    else if (item.kind === "text") texts.push([item.node as TextNode, id]);
  };

  const aligned = own.length === copy.length && own.every((item, i) => copy[i].kind === item.kind && copy[i].attr === item.attr);
  own.forEach((item, i) => {
    let segment = ids.get(idOf(item.scope, item.key));
    if (!segment) {
      segment = { id: `s${ids.size + 1}`, key: item.key, kind: item.kind, where: item.where, scope: item.scope, translation: null };
      ids.set(idOf(item.scope, item.key), segment);
    }
    mark(item, segment.id);
    if (!aligned) return;
    const other = copy[i];
    mark(other, segment.id);
    // The first element that has the string says what the copy has for it.
    if (segment.translation === null && other.key !== item.key) segment.translation = other.key;
  });

  wrap(texts.filter(([node]) => !!node.parentNode));
  return { aligned, english: serializeDocument(en.doc), translated: serializeDocument(tr.doc), segments: [...ids.values()] };
}
