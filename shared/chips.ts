// The editor shows an html translation as text with its inline tags (links,
// bold, code...) as non-editable chips, so a translator can move a link but not
// break or drop it. This is the model behind it: an html fragment is a list of
// parts, text (decoded) and tags (kept byte for byte). It serializes back to
// the same tags and the same text; an entity other than &amp; &lt; &gt; comes
// back as the character it stands for (&mdash; as the dash).
import { decodeHTML } from "entities";

export type Part =
  | { type: "text"; value: string }
  | { type: "tag"; html: string; role: "open" | "close" | "void"; name: string };

const NAME = /^<\/?([a-zA-Z][^\s/>]*)/;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

function tag(html: string): Part {
  if (html.startsWith("<!--")) return { type: "tag", html, role: "void", name: "!--" };
  const name = NAME.exec(html)![1].toLowerCase();
  const role = html.startsWith("</") ? "close" : html.endsWith("/>") || VOID.has(name) ? "void" : "open";
  return { type: "tag", html, role, name };
}

// Where the comment or tag that starts at `start` (a "<") ends, or -1 if it is
// not one. A quoted attribute value may hold a ">" (a title, a data attribute).
// A scan, not a regular expression: a pattern with a quantifier inside a
// quantifier takes cubic time on "<a<a<a...", and this is run on what strangers type.
function scanTag(html: string, start: number, lastGreaterThan: number): number {
  if (start > lastGreaterThan) return -1;
  if (html.startsWith("<!--", start)) {
    const end = html.indexOf("-->", start + 4);
    return end === -1 ? -1 : end + 3;
  }
  const first = html[start + 1] === "/" ? html[start + 2] : html[start + 1];
  if (first === undefined || !/[a-zA-Z]/.test(first)) return -1;
  for (let i = start + 2; i < html.length; i++) {
    const c = html[i];
    if (c === ">") return i + 1;
    if (c === '"' || c === "'") {
      const close = html.indexOf(c, i + 1);
      if (close === -1) return -1;
      i = close;
    }
  }
  return -1;
}

// How many "<" a string may hold: a segment has a handful of tags, and each "<"
// is where a scan can start.
export const MAX_ANGLES = 100;

export const tooManyTags = (text: string): boolean => {
  let count = 0;
  for (let i = text.indexOf("<"); i !== -1; i = text.indexOf("<", i + 1)) if (++count > MAX_ANGLES) return true;
  return false;
};

export function parseParts(html: string): Part[] {
  const parts: Part[] = [];
  const text = (raw: string) => {
    if (raw === "") return;
    const value = decodeHTML(raw);
    const previous = parts[parts.length - 1];
    if (previous?.type === "text") previous.value += value;
    else parts.push({ type: "text", value });
  };
  const lastGreaterThan = html.lastIndexOf(">");
  let last = 0;
  for (let at = html.indexOf("<"); at !== -1; at = html.indexOf("<", at)) {
    const end = scanTag(html, at, lastGreaterThan);
    if (end === -1) {
      at++;
      continue;
    }
    text(html.slice(last, at));
    parts.push(tag(html.slice(at, end)));
    last = at = end;
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

// Whether there is a word in an html fragment, apart from its tags: a letter, a
// number or a picture. Spaces, punctuation and invisible characters are not one.
export function hasWords(html: string): boolean {
  return /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(plainText(parseParts(html)));
}

// Whether every tag is closed in the order it was opened (voids aside).
export function wellNested(parts: Part[]): boolean {
  const open: string[] = [];
  for (const part of parts) {
    if (part.type !== "tag" || part.role === "void") continue;
    if (part.role === "open") open.push(part.name);
    else if (open.pop() !== part.name) return false;
  }
  return open.length === 0;
}

// What is wrong with the nesting of a translation's tags, if the English's are
// right. The lint compares the tags as a sorted list, so a link moved to the
// wrong words, or one closed before it is opened, passes it. (An English that is
// itself badly nested sets no standard.)
export function nestingProblem(key: string, value: string): string | null {
  if (tooManyTags(key) || tooManyTags(value)) return null;
  if (!wellNested(parseParts(key)) || wellNested(parseParts(value))) return null;
  return "the tags are not nested correctly: a tag is closed before it is opened, or two overlap";
}
