// The editor shows an html translation as text with its inline tags (links,
// bold, code...) as non-editable chips, so a translator can move a link but not
// break or drop it. This is the model behind it: an html fragment is a list of
// parts, text (decoded) and tags (kept byte for byte), and serializes back to
// the same html.
import { decodeHTML } from "entities";

export type Part =
  | { type: "text"; value: string }
  | { type: "tag"; html: string; role: "open" | "close" | "void"; name: string };

// A comment, or a tag with its attributes. A quoted attribute value may hold a
// ">" (a title, a data attribute).
const TAG = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^\s/>]*(?:"[^"]*"|'[^']*'|[^>"'])*>/g;
const NAME = /^<\/?([a-zA-Z][^\s/>]*)/;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

function tag(html: string): Part {
  if (html.startsWith("<!--")) return { type: "tag", html, role: "void", name: "!--" };
  const name = NAME.exec(html)![1].toLowerCase();
  const role = html.startsWith("</") ? "close" : html.endsWith("/>") || VOID.has(name) ? "void" : "open";
  return { type: "tag", html, role, name };
}

export function parseParts(html: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  const text = (raw: string) => {
    if (raw === "") return;
    const value = decodeHTML(raw);
    const previous = parts[parts.length - 1];
    if (previous?.type === "text") previous.value += value;
    else parts.push({ type: "text", value });
  };
  for (const match of html.matchAll(TAG)) {
    text(html.slice(last, match.index));
    parts.push(tag(match[0]));
    last = match.index + match[0].length;
  }
  text(html.slice(last));
  return parts;
}

// Text as html: only what has to be escaped. decodeHTML(encodeText(x)) === x.
export function encodeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function serializeParts(parts: Part[]): string {
  return parts.map((p) => (p.type === "text" ? encodeText(p.value) : p.html)).join("");
}

// What a reader sees: the text parts, without the tags.
export function plainText(parts: Part[]): string {
  return parts.map((p) => (p.type === "text" ? p.value : "")).join("");
}

export const tagsOf = (parts: Part[]): string[] => parts.flatMap((p) => (p.type === "tag" ? [p.html] : []));

// The tags are the same ones, whatever their order (they may be moved).
export function sameTags(a: Part[], b: Part[]): boolean {
  const x = tagsOf(a).sort();
  const y = tagsOf(b).sort();
  return x.length === y.length && x.every((t, i) => t === y[i]);
}

// A short label for a chip: <a>, </a>, <br>; the whole tag is its tooltip.
export function chipLabel(part: Extract<Part, { type: "tag" }>): string {
  if (part.name === "!--") return "<!-- -->";
  return part.role === "close" ? `</${part.name}>` : `<${part.name}>`;
}

// Where `selected` is in `plain` (a selection made on the rendered page), as
// [start, end) offsets, or null. Whitespace may differ (the page keeps the
// source's line breaks); of several matches the one closest to `hint` wins.
export function locate(plain: string, selected: string, hint = 0): [number, number] | null {
  const wanted = selected.trim();
  if (wanted === "") return null;
  const pick = (matches: [number, number][]) =>
    matches.length ? matches.reduce((best, m) => (Math.abs(m[0] - hint) < Math.abs(best[0] - hint) ? m : best)) : null;
  const exact: [number, number][] = [];
  for (let i = plain.indexOf(wanted); i !== -1; i = plain.indexOf(wanted, i + 1)) exact.push([i, i + wanted.length]);
  if (exact.length) return pick(exact);
  const source = wanted.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const loose = [...plain.matchAll(new RegExp(source, "gu"))].map((m) => [m.index, m.index + m[0].length] as [number, number]);
  return pick(loose);
}
