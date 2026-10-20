import { test } from "vitest";
import assert from "node:assert/strict";
import { parse } from "parse5";
import { REVIEW_CSS, sanitizePage } from "../server/sanitize.ts";

const BASE = "https://www.beekeeperstudio.io/";
const page = (head: string, body: string) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
const clean = (head: string, body = "<p>Hi</p>") => sanitizePage(page(head, body), BASE);

test("scripts, handlers and javascript urls are gone", () => {
  const html = clean(
    '<script src="/assets/js/main-ABCD1234.js" defer></script><script>alert(1)</script><script type="application/ld+json">{}</script>',
    '<p onclick="x()" onMouseOver="y()" data-seg="s1">Hi</p><a href="javascript:alert(1)">a</a><a href=" JaVa\tScript:alert(1)">b</a><a href="/ok" target="_blank">c</a><img src=x onerror=alert(1)>',
  );
  assert.ok(!/<script/i.test(html), html);
  assert.ok(!/onclick|onmouseover|onerror/i.test(html), html);
  assert.ok(!/javascript:/i.test(html.replace(/\s+/g, "")), html);
  assert.ok(html.includes('<a href="/ok">c</a>'), "a normal link survives, without its target");
  assert.ok(html.includes('data-seg="s1"'), "segments survive");
});

test("noscript, iframes, objects and embeds are removed (the sandbox has no scripts, so a noscript pixel would load)", () => {
  const html = clean("<noscript><img src='https://analytics.example/pixel.gif'></noscript>", '<iframe src="https://www.youtube.com/embed/x"></iframe><object data="a.swf"></object><embed src="b"><p>Keep</p><template><p>t</p></template>');
  for (const gone of ["noscript", "pixel.gif", "<iframe", "<object", "<embed", "<template"]) assert.ok(!html.includes(gone), `${gone}: ${html}`);
  assert.ok(html.includes("<p>Keep</p>"));
});

test("noindex and refresh meta tags, preloads and canonical links are removed", () => {
  const html = clean(
    '<meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=/x"><meta http-equiv="Content-Security-Policy" content="default-src none">' +
      '<link rel="preload" href="/a.woff2" as="font" crossorigin><link rel="preconnect" href="https://x"><link rel="canonical" href="https://www.beekeeperstudio.io/es/"><link rel="alternate" hreflang="es" href="/es/">' +
      '<meta name="description" content="keep"><meta property="og:title" content="keep">',
  );
  for (const gone of ["noindex", "refresh", "Content-Security-Policy", "preload", "preconnect", "canonical", "hreflang"]) assert.ok(!html.includes(gone), `${gone}: ${html}`);
  assert.ok(html.includes('content="keep"'));
});

test("stylesheets stay, without crossorigin and integrity, so they load whatever their CORS headers", () => {
  const html = clean('<link rel="stylesheet" href="/assets/css/main-abc.css" crossorigin="anonymous" integrity="sha384-x"><link rel="icon" href="/favicon.ico">');
  assert.ok(html.includes('<link rel="stylesheet" href="/assets/css/main-abc.css">'), html);
  assert.ok(html.includes('rel="icon"'));
});

test("a <base> comes first in the head, an existing one is replaced, and the review stylesheet is last", () => {
  const html = clean('<base href="https://evil.example/"><link rel="stylesheet" href="/a.css"><title>T</title>');
  const doc = parse(html) as any;
  const head = doc.childNodes.find((n: any) => n.tagName === "html").childNodes.find((n: any) => n.tagName === "head");
  const tags = head.childNodes.filter((n: any) => n.tagName).map((n: any) => n.tagName);
  assert.equal(tags[0], "base");
  assert.equal(tags.filter((t: string) => t === "base").length, 1);
  assert.equal(tags[tags.length - 1], "style");
  assert.ok(html.includes(`<base href="${BASE}">`));
  assert.ok(!html.includes("evil.example"));
  assert.ok(html.includes(REVIEW_CSS.split("\n")[0]));
  assert.ok(html.includes("rv-hover") && html.includes("rv-selected"));
});

test("the base is a value, never markup, and the page's own text is untouched", () => {
  const odd = 'https://x.test/"><script>1</script>&';
  const html = sanitizePage(page("", "<h1>Pricing &amp; plans</h1><p data-seg=\"s2\">Pay <a href=\"/get\">once</a>.</p>"), odd);
  const doc = parse(html) as any;
  const all: any[] = [];
  const walk = (n: any) => { all.push(n); (n.childNodes ?? []).forEach(walk); };
  walk(doc);
  assert.ok(!all.some((n) => n.tagName === "script"), "no script element came out of the base");
  assert.equal(all.find((n) => n.tagName === "base").attrs.find((a: any) => a.name === "href").value, odd);
  assert.ok(html.includes("<h1>Pricing &amp; plans</h1>"));
  assert.ok(html.includes('<p data-seg="s2">Pay <a href="/get">once</a>.</p>'));
});

test("forms don't steal focus and videos don't autoplay", () => {
  const html = clean("", '<input autofocus name="q"><video autoplay muted src="/v.mp4"></video>');
  assert.ok(!html.includes("autofocus") && !html.includes("autoplay"), html);
});
