// Swaps every segment of a body for its translation. Html segments take the
// translated fragment as html; text nodes and attributes take it as text, so
// an `&amp;` in a translation can't double-escape. The whitespace around the
// English text is kept, so a translated label still sits a space away from
// the checkbox or icon next to it.
import { decodeHTML } from "entities";
import { restoreAssets, stableKey } from "./assets.ts";
import { attr, innerHTML, setAttr, setInnerHTML } from "./dom.ts";
import { eachAttribute, eachSegment, htmlKey, scopeOf, type Kind } from "./segments.ts";
import type { Element } from "./dom.ts";
import { normalize } from "./text.ts";

export type Lookup = (key: string, scope: string | null, kind: Kind) => string | undefined;

function around(original: string, replacement: string): string {
  const lead = /^[ \t\n\f\r]*/.exec(original)![0];
  const trail = /[ \t\n\f\r]*$/.exec(original)![0];
  return lead.length === original.length ? replacement : lead + replacement + trail;
}

// Translates in place. Returns the English keys that had no translation (left
// in English).
export function apply(body: Element, lookup: Lookup): string[] {
  const missing = new Set<string>();
  // Segments first, then attributes, read again from the translated tree: an
  // attribute inside a translated fragment is still keyed by its English.
  for (const [kind, node] of [...eachSegment(body)]) {
    if (kind === "html") {
      const key = stableKey(htmlKey(node));
      const translated = lookup(key, scopeOf(node), kind);
      if (translated === undefined) missing.add(key);
      else setInnerHTML(node, around(innerHTML(node), restoreAssets(translated, innerHTML(node))));
    } else {
      const key = normalize(node.value);
      const translated = lookup(key, scopeOf(node), kind);
      if (translated === undefined) missing.add(key);
      else node.value = around(node.value, decodeHTML(translated));
    }
  }
  for (const [el, name] of [...eachAttribute(body)]) {
    const key = normalize(attr(el, name) ?? "");
    const translated = lookup(key, scopeOf(el), "attr");
    if (translated === undefined) missing.add(key);
    else setAttr(el, name, decodeHTML(translated));
  }
  return [...missing];
}
