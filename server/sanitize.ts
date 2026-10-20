// Makes a page of the site fit to show in a sandboxed iframe (srcdoc,
// sandbox="allow-same-origin", so the frontend can read selections in it and
// nothing in it can run). The sandbox is what keeps scripts out; this takes
// them out too, and everything else that would behave badly in a review:
//
//   - every <script>, inline event handler and javascript: url
//   - <noscript> (the sandbox has no scripts, so its tracking pixels would load),
//     iframes, objects and embeds (the page's videos and widgets)
//   - noindex, refresh and CSP <meta> tags, preloads and other <link> hints
//   - crossorigin and integrity on stylesheets: the page is shown from this
//     app's origin, and without them a stylesheet loads whatever its CORS headers
//
// and adds a <base> so the page's styles and images load from the site, and the
// review stylesheet (hover and selected states).
import { defaultTreeAdapter, html as parse5Html, parse, serialize } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

const DROP_ELEMENTS = new Set([
  "script", "noscript", "iframe", "frame", "object", "embed", "applet", "template", "base", "portal",
  // SVG animation can set a link's href to a javascript: url.
  "animate", "set", "animatemotion", "animatetransform",
]);
const DROP_LINK_RELS = new Set(["preload", "modulepreload", "prefetch", "prerender", "dns-prefetch", "preconnect", "manifest", "canonical", "alternate", "amphtml"]);
const DROP_META_EQUIV = new Set(["refresh", "content-security-policy", "set-cookie", "x-ua-compatible"]);
const DROP_META_NAMES = new Set(["robots", "googlebot", "bingbot", "referrer"]);
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "xlink:href", "poster", "data", "background", "srcset"]);
const DROP_ATTRS = new Set(["srcdoc", "autoplay", "autofocus", "ping", "nonce"]);

// The states the frontend toggles on segments (rv-hover, rv-selected,
// rv-noted). Animations are off so a page waiting for a script to reveal it
// is not a blank one, and a segment's wrapper span doesn't change the layout.
export const REVIEW_CSS = `
*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
[data-seg]{cursor:pointer}
span[data-seg]{display:inline}
[data-seg].rv-noted{box-shadow:0 2px 0 0 #15db95}
[data-seg].rv-hover{outline:2px solid #fad83b!important;outline-offset:2px;background-color:rgba(250,216,59,.22)!important;border-radius:2px}
[data-seg].rv-selected{outline:2px solid #4ad0ff!important;outline-offset:2px;background-color:rgba(74,208,255,.22)!important;border-radius:2px}
::selection{background:rgba(74,208,255,.45)}
`.trim();

function attr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

const children = (node: Node): Node[] => ("childNodes" in node ? (node.childNodes as Node[]) : []);

function dropElement(el: Element): boolean {
  const tag = el.tagName;
  if (DROP_ELEMENTS.has(tag)) return true;
  if (tag === "link") {
    const rels = (attr(el, "rel") ?? "").toLowerCase().split(/\s+/);
    return rels.some((r) => DROP_LINK_RELS.has(r));
  }
  if (tag === "meta") {
    if (DROP_META_EQUIV.has((attr(el, "http-equiv") ?? "").toLowerCase())) return true;
    if (DROP_META_NAMES.has((attr(el, "name") ?? "").toLowerCase())) return true;
  }
  return false;
}

// "java\tscript:" is a javascript: url to a browser. (Only with its colon:
// "javascript-tips.html" is a relative url.)
const SCRIPT_URL = /^(?:javascript:|vbscript:|data:text\/html)/i;
const unsafeUrl = (value: string) => SCRIPT_URL.test(value.replace(/[\u0000- \u007f-\u009f]+/g, ""));

function cleanAttributes(el: Element): void {
  const stylesheet = el.tagName === "link";
  el.attrs = el.attrs.filter(({ name, value }) => {
    const lower = name.toLowerCase();
    if (lower.startsWith("on") || DROP_ATTRS.has(lower)) return false;
    if (URL_ATTRS.has(lower) && unsafeUrl(value)) return false;
    if (stylesheet && (lower === "crossorigin" || lower === "integrity")) return false;
    if (el.tagName === "a" && lower === "target") return false;
    return true;
  });
}

// The idioms that load a stylesheet late, by a handler this removes: media="print"
// switched to "all" on load, and a preload that turns itself into a stylesheet.
// Here the page should simply have the stylesheet.
function upgradeLink(el: Element): void {
  if (el.tagName !== "link" || attr(el, "onload") === undefined) return;
  const rels = (attr(el, "rel") ?? "").toLowerCase().split(/\s+/);
  if (rels.includes("preload") && (attr(el, "as") ?? "").toLowerCase() === "style") {
    el.attrs = el.attrs.filter((a) => a.name !== "as" && a.name !== "rel");
    el.attrs.push({ name: "rel", value: "stylesheet" });
  }
  if (rels.includes("stylesheet") || attr(el, "rel") === "stylesheet") el.attrs = el.attrs.filter((a) => a.name !== "media");
}

function clean(node: Node): void {
  const kept: Node[] = [];
  for (const child of children(node)) {
    if ("tagName" in child) {
      upgradeLink(child);
      if (dropElement(child)) continue;
      cleanAttributes(child);
    }
    clean(child);
    kept.push(child);
  }
  if ("childNodes" in node) (node as ParentNode).childNodes = kept as ParentNode["childNodes"];
}

function find(node: Node, tag: string): Element | undefined {
  for (const child of children(node)) {
    if ("tagName" in child && child.tagName === tag) return child;
    const found = find(child, tag);
    if (found) return found;
  }
  return undefined;
}

// The page as it is after cleaning, cleaned again as long as that changes it: a
// browser parses what is sent, and for a few constructs (foreign content, the
// parser's adoption of misnested tags) that is not the tree that was cleaned.
function cleaned(html: string): string {
  let out = html;
  for (let pass = 0; pass < 4; pass++) {
    const doc = parse(out);
    clean(doc);
    const next = serialize(doc);
    if (next === out) break;
    out = next;
  }
  return out;
}

// `base`: the origin the page's relative urls load from, with its trailing slash.
export function sanitizePage(html: string, base: string): string {
  const doc = parse(cleaned(html));
  const head = find(doc, "head");
  if (head) {
    // Built as nodes, never spliced into markup.
    const baseEl = defaultTreeAdapter.createElement("base", parse5Html.NS.HTML, [{ name: "href", value: base }]);
    const styleEl = defaultTreeAdapter.createElement("style", parse5Html.NS.HTML, [{ name: "data-review", value: "" }]);
    defaultTreeAdapter.insertText(styleEl, REVIEW_CSS);
    // The <base> first, so every url after it resolves against it.
    if (head.childNodes.length) defaultTreeAdapter.insertBefore(head, baseEl, head.childNodes[0]);
    else defaultTreeAdapter.appendChild(head, baseEl);
    defaultTreeAdapter.appendChild(head, styleEl);
  }
  return serialize(doc);
}
