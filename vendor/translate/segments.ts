// Finds the translatable parts of a built page. A segment is the inner html
// of an element whose children are text and inline markup only (a heading, a
// paragraph with links in it, a button, a list item), a bare text node, or a
// translatable attribute. Segments are keyed by their whitespace-normalized
// English form, and know the shared include they sit in (the nearest
// `data-i18n-scope`), the element they are, and the heading above them.
import {
  attr, childNodes, classes, elementChildren, innerHTML, isElement, isText, closest, textContent,
  type ChildNode, type Document, type Element, type Node, type TextNode,
} from "./dom.ts";
import { stableKey } from "./assets.ts";
import { normalize, translatable, truncate } from "./text.ts";

export const INLINE = new Set(["a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em", "i", "img", "kbd",
  "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr"]);
// Neither translated nor descended into.
export const SKIP_TAGS = new Set(["script", "style", "svg", "pre", "noscript", "template", "iframe", "select", "textarea"]);
// Icon ligatures and the language switcher (language names stay as they are).
export const SKIP_CLASSES = new Set(["material-icons", "os-icon", "lang-switcher"]);
export const ATTRS = ["alt", "title", "placeholder", "aria-label", "data-tooltip"];
export const SCOPE_ATTR = "data-i18n-scope";

export type Kind = "html" | "text" | "attr";

export interface Segment {
  // What it is looked up and translated by: `raw` with its asset urls'
  // digests taken out (see assets.ts).
  key: string;
  // The whitespace-normalized English, as the page has it.
  raw: string;
  kind: Kind;
  // The element and the heading above it: 'p, under "Plans"'.
  where: string;
  // The shared include it is part of, or null for the page's own content.
  scope: string | null;
  // html: the element whose inner html is the segment; text: the text node;
  // attr: the element carrying `attr`.
  node: Element | TextNode;
  attr?: string;
}

export function body(doc: Document): Element | undefined {
  const html = doc.childNodes.find((n): n is Element => isElement(n) && n.tagName === "html");
  return html && elementChildren(html).find((el) => el.tagName === "body");
}

export function skip(el: Element): boolean {
  return SKIP_TAGS.has(el.tagName) || classes(el).some((c) => SKIP_CLASSES.has(c));
}

function inlineSubtree(el: Element): boolean {
  return INLINE.has(el.tagName) && elementChildren(el).every(inlineSubtree);
}

function segmentElement(el: Element): boolean {
  if (skip(el)) return false;
  const hasText = childNodes(el).some((child) => isText(child) && translatable(child.value));
  return hasText && elementChildren(el).every(inlineSubtree);
}

// Inline-only elements and loose text, in document order.
export function* eachSegment(node: Node): Generator<["html", Element] | ["text", TextNode]> {
  for (const child of childNodes(node)) {
    if (isText(child)) {
      if (translatable(child.value)) yield ["text", child];
    } else if (isElement(child) && !skip(child)) {
      if (segmentElement(child)) yield ["html", child];
      else yield* eachSegment(child);
    }
  }
}

function postOrder(node: Node, out: Element[] = []): Element[] {
  for (const child of childNodes(node)) postOrder(child, out);
  if (isElement(node)) out.push(node);
  return out;
}

// Every translatable attribute, including those inside skipped subtrees (an
// icon's title, say), children before their parents.
export function* eachAttribute(root: Element): Generator<[Element, string]> {
  for (const el of postOrder(root)) {
    for (const name of ATTRS) {
      const value = attr(el, name);
      if (value !== undefined && translatable(value)) yield [el, name];
    }
    const type = attr(el, "type");
    if (el.tagName === "input" && (type === "submit" || type === "button") && attr(el, "value") !== undefined) {
      yield [el, "value"];
    }
  }
}

export function htmlKey(el: Element): string {
  return normalize(innerHTML(el));
}

export function scopeOf(node: Node): string | null {
  const el = closest(node, (e) => attr(e, SCOPE_ATTR) !== undefined);
  return el ? attr(el, SCOPE_ATTR) || null : null;
}

// The nearest h1-h4 that starts before each element: a preceding one or one
// it sits in.
function headingsBefore(root: Node): Map<Element, Element | undefined> {
  const map = new Map<Element, Element | undefined>();
  let last: Element | undefined;
  const visit = (node: Node) => {
    if (isElement(node)) {
      map.set(node, last);
      if (/^h[1-4]$/.test(node.tagName)) last = node;
    }
    for (const child of childNodes(node)) visit(child);
  };
  visit(root);
  return map;
}

function rootOf(node: Node): Node {
  let current = node;
  while ("parentNode" in current && current.parentNode) current = current.parentNode;
  return current;
}

// Every segment and attribute of a body, segments first, in document order.
export function segments(bodyEl: Element): Segment[] {
  const headings = headingsBefore(rootOf(bodyEl));
  const where = (el: Element, what: string) => {
    const heading = headings.get(el);
    const text = heading && truncate(normalize(textContent(heading)), 60, 57);
    return text ? `${what}, under "${text}"` : what;
  };
  const out: Segment[] = [];
  for (const [kind, node] of eachSegment(bodyEl)) {
    const el = kind === "html" ? node : (node.parentNode as Element);
    const raw = kind === "html" ? htmlKey(node) : normalize(node.value);
    out.push({ key: kind === "html" ? stableKey(raw) : raw, raw, kind, where: where(el, el.tagName), scope: scopeOf(el), node });
  }
  for (const [el, name] of eachAttribute(bodyEl)) {
    const raw = normalize(attr(el, name) ?? "");
    out.push({ key: raw, raw, kind: "attr", where: where(el, `${el.tagName}[${name}]`), scope: scopeOf(el), node: el, attr: name });
  }
  return out;
}

// The distinct keys as the page has them (raw: the original Ruby library's
// keys, byte for byte), in document order.
export function extract(bodyEl: Element): string[] {
  return [...new Set(segments(bodyEl).map((s) => s.raw))];
}

export function extractWithContext(bodyEl: Element): [string, string][] {
  return segments(bodyEl).map((s) => [s.raw, s.where]);
}

export type { ChildNode };
