// Digested asset urls: /assets/css/main-<sha>.css from jekyll-assets,
// /assets/js/main-<HASH>.js from esbuild. They change whenever the file does,
// so they are kept out of segment keys (a new logo must not make the header
// "new text"), and a stored copy's are refreshed from the live English page.
export const DIGESTED = /\/assets\/[\w./-]+?-(?:[0-9a-f]{64,128}|[0-9A-Z]{8})\.[a-z0-9]+/g;
const PARTS = /^(\/assets\/[\w./-]+?)-(?:[0-9a-f]{64,128}|[0-9A-Z]{8})(\.[a-z0-9]+)$/;
const INTEGRITY = /\bintegrity="[^"]*"/g;

function undigested(url: string): string {
  const [, stem, ext] = PARTS.exec(url)!;
  return stem + ext;
}

// Attributes in name order: jekyll-assets writes an <img>'s attributes in a
// different order depending on its cache, so the same page can come out of
// two builds with its attributes shuffled.
export function sortAttributes(html: string): string {
  return html.replace(/<([a-zA-Z][\w-]*)((?:\s+[^\s=>"'/]+(?:="[^"]*")?)+)\s*(\/?)>/g, (_, tag: string, attrs: string, slash: string) => {
    const list = attrs.match(/[^\s=>"'/]+(?:="[^"]*")?/g) ?? [];
    return `<${tag} ${list.sort((a, b) => a.split("=")[0].localeCompare(b.split("=")[0])).join(" ")}${slash}>`;
  });
}

// The form a segment is keyed by: asset urls without their digests,
// integrity hashes emptied and attributes in name order.
export function stableKey(key: string): string {
  return sortAttributes(key.replace(DIGESTED, undigested).replace(INTEGRITY, 'integrity=""'));
}

// The digested urls of `html`, by their undigested form; names used with
// more than one digest map to null.
function current(html: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const url of html.match(DIGESTED) ?? []) {
    const key = undigested(url);
    const seen = out.get(key);
    out.set(key, seen === undefined || seen === url ? url : null);
  }
  return out;
}

// A translation (keyed and written in the stable form) with the asset urls
// and integrity hashes of the English html it replaces put back.
export function restoreAssets(translation: string, english: string): string {
  if (!english.includes("/assets/") && !english.includes("integrity=")) return translation;
  const urls = current(english);
  const hashes = english.match(INTEGRITY) ?? [];
  let i = 0;
  return translation
    .replace(/\/assets\/[\w./-]+?\.[a-z0-9]+/g, (url) => urls.get(url) ?? url)
    .replace(/\bintegrity=""/g, (attr) => hashes[i++] ?? attr);
}

// Swaps every digested asset url in `html` for the url `english` uses now for
// the same file.
export function refreshAssets(html: string, english: string): string {
  const urls = current(english);
  return html.replace(DIGESTED, (url) => urls.get(undigested(url)) ?? url);
}

export function assetUrls(html: string): string[] {
  return [...new Set(html.match(DIGESTED) ?? [])].sort();
}
