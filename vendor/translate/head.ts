// The <head> of a translated copy. It starts as the English page's head, so
// the stylesheets, scripts and the full hreflang set (which the English page
// already lists) carry over as they are. What changes:
//
// - <html lang> and <body data-lang> say the page's language
// - the title, description and their og:/twitter: copies are translated,
//   as segments like any other ("title", "meta description")
// - canonical and og:url point at the translated url itself: a copy whose
//   canonical names the English page drops out of search, and a launch that
//   got this wrong once cost rankings
// - og:locale is the language's, and its og:locale:alternate entry becomes
//   the English one
// - structured data (JSON-LD) has its headline, description and FAQ text
//   translated, and links to translated pages localized
// - a page with English left in it (partial) gets noindex
import { decodeHTML } from "entities";
import {
  attr, byTag, childNodes, elementChildren, findAll, isElement, isText, setAttr, setText, textContent,
  type Document, type Element,
} from "./dom.ts";
import { normalize, translatable } from "./text.ts";

export interface HeadSegment {
  key: string;
  where: string;
  set(translation: string): void;
}

function head(doc: Document): Element | undefined {
  const html = doc.childNodes.find((n): n is Element => isElement(n) && n.tagName === "html");
  return html && elementChildren(html).find((el) => el.tagName === "head");
}

function metas(root: Element, test: (el: Element) => boolean): Element[] {
  return findAll(root, (el) => el.tagName === "meta" && test(el));
}

const named = (...names: string[]) => (el: Element) =>
  names.includes(attr(el, "name") ?? "") || names.includes(attr(el, "property") ?? "");

// JSON-LD fields that are prose. `name` and `text` only where they are a
// question, an answer or a breadcrumb label rather than a product or a person.
const PROSE = new Set(["headline", "alternativeHeadline", "description"]);
const PROSE_IN: Record<string, Set<string>> = {
  name: new Set(["Question", "ListItem", "HowToStep", "HowToSection"]),
  text: new Set(["Answer", "HowToStep"]),
};

interface JsonLd {
  script: Element;
  data: unknown;
  pretty: boolean;
}

function jsonLd(root: Element): JsonLd[] {
  const out: JsonLd[] = [];
  for (const script of findAll(root, (el) => el.tagName === "script" && attr(el, "type") === "application/ld+json")) {
    const source = textContent(script);
    try {
      out.push({ script, data: JSON.parse(source), pretty: source.includes("\n ") });
    } catch {
      // Not ours to fix; leave it as it is.
    }
  }
  return out;
}

type Visit = (holder: Record<string, unknown>, field: string, value: string, type: string | undefined) => void;

function walk(value: unknown, visit: Visit, type?: string): void {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit, type));
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const own = typeof obj["@type"] === "string" ? (obj["@type"] as string) : type;
    for (const [field, inner] of Object.entries(obj)) {
      if (typeof inner === "string") visit(obj, field, inner, own);
      else walk(inner, visit, own);
    }
  }
}

function serializeJson(item: JsonLd): string {
  const json = JSON.stringify(item.data, null, item.pretty ? 2 : undefined).replace(/</g, "\\u003c");
  return item.pretty ? `\n${json}\n` : json;
}

// The translatable parts of the head. Call each segment's `set` with its
// translation (plain text), then `commit()` to write the structured data back.
export function headSegments(doc: Document): { segments: HeadSegment[]; commit(): void } {
  const root = head(doc);
  const segments: HeadSegment[] = [];
  if (!root) return { segments, commit() {} };
  const content = (el: Element, where: string) => {
    const value = attr(el, "content");
    if (value && translatable(value)) {
      segments.push({ key: normalize(value), where, set: (t) => setAttr(el, "content", decodeHTML(t)) });
    }
  };

  const ogTitle = metas(root, named("og:title"))[0];
  const titleText = ogTitle ? normalize(attr(ogTitle, "content") ?? "") : "";
  const title = byTag(root, "title");
  if (title) {
    const text = normalize(textContent(title));
    // "Pricing | Beekeeper Studio": the page title plus the site's suffix,
    // which stays as it is.
    const suffix = titleText && text.startsWith(titleText) ? text.slice(titleText.length) : null;
    if (suffix !== null && (suffix === "" || /^ [|·—–-] /.test(suffix))) {
      segments.push({ key: titleText, where: "title", set: (t) => setText(title, decodeHTML(t) + suffix) });
    } else if (translatable(text)) {
      segments.push({ key: text, where: "title", set: (t) => setText(title, decodeHTML(t)) });
    }
  }
  for (const el of metas(root, named("og:title", "twitter:title"))) content(el, "title");
  for (const el of metas(root, named("description", "og:description", "twitter:description"))) content(el, "meta description");
  for (const el of metas(root, named("og:image:alt", "twitter:image:alt"))) content(el, "image description");

  const items = jsonLd(root);
  for (const item of items) {
    walk(item.data, (holder, field, value, type) => {
      const prose = PROSE.has(field) || (type !== undefined && PROSE_IN[field]?.has(type));
      if (!prose || !translatable(value) || /^https?:\/\//.test(value)) return;
      segments.push({ key: normalize(value), where: `structured data, ${type ?? "item"} ${field}`, set: (t) => { holder[field] = decodeHTML(t); } });
    });
  }
  return {
    segments,
    commit() {
      for (const item of items) setText(item.script, serializeJson(item));
    },
  };
}

// Dates that change on every build for pages without one of their own
// (Jekyll stamps features, database and alternative pages with the build
// time), blanked out of the page's skeleton so they don't make every copy
// look outdated. A copy keeps the dates of the build it was rendered from.
const DATES = new Set(["datePublished", "dateModified", "dateCreated", "uploadDate"]);

export function blankDates(doc: Document): void {
  const root = head(doc);
  if (!root) return;
  for (const el of metas(root, (m) => /^article:\w+_time$/.test(attr(m, "property") ?? ""))) setAttr(el, "content", "");
  for (const item of jsonLd(root)) {
    walk(item.data, (holder, field) => {
      if (DATES.has(field)) holder[field] = "";
    });
    setText(item.script, serializeJson(item));
  }
}

export interface HeadOptions {
  // The cased tag and Open Graph locale of the page's language, and English's.
  lang: string;
  locale: string;
  englishLocale: string;
  // The translated page's absolute url.
  url: string;
  noindex: boolean;
  // Localizes a url when it is one of the site's translated pages.
  localize: (url: string) => string;
}

export function rewriteHead(doc: Document, opts: HeadOptions): void {
  const html = doc.childNodes.find((n): n is Element => isElement(n) && n.tagName === "html");
  if (!html) return;
  setAttr(html, "lang", opts.lang);
  const body = elementChildren(html).find((el) => el.tagName === "body");
  if (body) setAttr(body, "data-lang", opts.lang);
  const root = head(doc);
  if (!root) return;

  for (const link of findAll(root, (el) => el.tagName === "link" && (attr(el, "rel") ?? "").split(/\s+/).includes("canonical"))) {
    setAttr(link, "href", opts.url);
  }
  for (const el of metas(root, named("og:url"))) setAttr(el, "content", opts.url);
  for (const el of metas(root, named("og:locale"))) setAttr(el, "content", opts.locale);
  for (const el of metas(root, named("og:locale:alternate"))) {
    if (attr(el, "content") === opts.locale) setAttr(el, "content", opts.englishLocale);
  }
  for (const item of jsonLd(root)) {
    let changed = false;
    walk(item.data, (holder, field, value) => {
      const localized = opts.localize(value);
      if (localized !== value) {
        holder[field] = localized;
        changed = true;
      }
    });
    if (changed) setText(item.script, serializeJson(item));
  }

  if (opts.noindex) {
    const robots = metas(root, named("robots"))[0];
    if (robots) {
      const value = attr(robots, "content") ?? "";
      if (!/noindex/i.test(value)) setAttr(robots, "content", value ? `noindex, ${value}` : "noindex");
    } else {
      const meta: Element = { nodeName: "meta", tagName: "meta", attrs: [{ name: "name", value: "robots" }, { name: "content", value: "noindex" }], namespaceURI: root.namespaceURI, parentNode: root, childNodes: [] };
      // After the charset declarations, which must come first.
      const nodes = childNodes(root);
      let at = 0;
      nodes.forEach((n, i) => {
        if (isElement(n) && n.tagName === "meta" && (attr(n, "charset") !== undefined || /content-type/i.test(attr(n, "http-equiv") ?? ""))) at = i + 1;
      });
      root.childNodes.splice(at, 0, meta);
    }
  }
}

// The page's title and its outline (h1-h3), for the model's context.
export function outline(doc: Document): { title: string; headings: string[] } {
  const root = head(doc);
  const og = root && metas(root, named("og:title"))[0];
  const titleEl = root && byTag(root, "title");
  const title = og ? normalize(attr(og, "content") ?? "") : titleEl ? normalize(textContent(titleEl)) : "";
  const html = doc.childNodes.find((n): n is Element => isElement(n) && n.tagName === "html");
  const body = html && elementChildren(html).find((el) => el.tagName === "body");
  const headings = body
    ? findAll(body, (el) => /^h[1-3]$/.test(el.tagName)).map((h) => `${h.tagName}: ${normalize(textContent(h))}`).filter((h) => h.length > 4).slice(0, 60)
    : [];
  return { title, headings };
}
