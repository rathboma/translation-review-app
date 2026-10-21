// A few DOM helpers over parse5's default tree. parse5 parses and serializes
// html exactly as the HTML spec says, which is what Nokogiri::HTML5 (the Ruby
// library this replaces) does too, so segment keys come out byte for byte the
// same in both.
import { parse, parseFragment, serialize, serializeOuter } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";

export type Document = DefaultTreeAdapterTypes.Document;
export type Element = DefaultTreeAdapterTypes.Element;
export type TextNode = DefaultTreeAdapterTypes.TextNode;
export type Node = DefaultTreeAdapterTypes.Node;
export type ChildNode = DefaultTreeAdapterTypes.ChildNode;
export type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type Template = DefaultTreeAdapterTypes.Template;

export function parseDocument(html: string): Document {
  return parse(html);
}

export function isElement(node: Node): node is Element {
  return "tagName" in node;
}

export function isText(node: Node): node is TextNode {
  return node.nodeName === "#text";
}

function isTemplate(node: Node): node is Template {
  return node.nodeName === "template" && "content" in node;
}

// A node's children. A <template>'s live in its content fragment.
export function childNodes(node: Node): ChildNode[] {
  if (isTemplate(node)) return node.content.childNodes;
  return "childNodes" in node ? node.childNodes : [];
}

export function elementChildren(node: Node): Element[] {
  return childNodes(node).filter(isElement);
}

export function attr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

export function hasAttr(el: Element, name: string): boolean {
  return el.attrs.some((a) => a.name === name);
}

export function setAttr(el: Element, name: string, value: string): void {
  const existing = el.attrs.find((a) => a.name === name);
  if (existing) existing.value = value;
  else el.attrs.push({ name, value });
}

export function removeAttr(el: Element, name: string): void {
  el.attrs = el.attrs.filter((a) => a.name !== name);
}

export function classes(el: Element): string[] {
  return (attr(el, "class") ?? "").split(/[ \t\n\f\r]+/).filter(Boolean);
}

export function innerHTML(node: ParentNode): string {
  return serialize(node);
}

export function outerHTML(node: ChildNode): string {
  return serializeOuter(node);
}

// Replaces an element's children with `html`, parsed as its innerHTML would be.
export function setInnerHTML(el: Element, html: string): void {
  const fragment = parseFragment(el, html, {});
  for (const child of fragment.childNodes) child.parentNode = el;
  el.childNodes = fragment.childNodes;
}

export function setText(el: Element, text: string): void {
  const node: TextNode = { nodeName: "#text", value: text, parentNode: el };
  el.childNodes = [node];
}

// All the text under a node, as Nokogiri's #text gives it.
export function textContent(node: Node): string {
  if (isText(node)) return node.value;
  let out = "";
  for (const child of childNodes(node)) {
    if (isText(child) || isElement(child)) out += textContent(child);
  }
  return out;
}

// Every element under `root`, root included, in document (pre-)order.
export function elements(root: Node): Element[] {
  const out: Element[] = [];
  const visit = (node: Node) => {
    if (isElement(node)) out.push(node);
    for (const child of childNodes(node)) visit(child);
  };
  visit(root);
  return out;
}

export function find(root: Node, test: (el: Element) => boolean): Element | undefined {
  return elements(root).find(test);
}

export function findAll(root: Node, test: (el: Element) => boolean): Element[] {
  return elements(root).filter(test);
}

export function byTag(root: Node, tag: string): Element | undefined {
  return find(root, (el) => el.tagName === tag);
}

// The element itself or its nearest ancestor that passes `test`.
export function closest(node: Node, test: (el: Element) => boolean): Element | undefined {
  let current: Node | null = node;
  while (current) {
    if (isElement(current) && test(current)) return current;
    current = "parentNode" in current ? current.parentNode : null;
  }
  return undefined;
}

export function serializeDocument(doc: Document): string {
  return serialize(doc);
}
