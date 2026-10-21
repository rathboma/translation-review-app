import { test } from "vitest";
import assert from "node:assert/strict";
import { annotate } from "../server/annotate.ts";
import { PRICING_EN, PRICING_ES } from "./server-helpers.ts";

const find = (page: ReturnType<typeof annotate>, key: string) => page.segments.find((s) => s.key === key)!;

test("both sides carry the same ids, and the segments say what the copy has", () => {
  const page = annotate(PRICING_EN, PRICING_ES);
  assert.equal(page.aligned, true);
  const pay = find(page, "Pay once, use the paid features forever.");
  assert.equal(pay.translation, "Paga una vez, usa las funciones de pago para siempre.");
  assert.equal(pay.scope, null);
  assert.equal(find(page, "Pricing").translation, "Precios");
  for (const side of [page.english, page.translated]) assert.ok(side.includes(`data-seg="${pay.id}"`));
  // The English page still says the English, the copy the Spanish.
  assert.ok(page.english.includes(`<p data-seg="${pay.id}">Pay once`));
  assert.ok(page.translated.includes(`<p data-seg="${pay.id}">Paga una vez`));
});

test("a string that is on the page twice is one segment, marked everywhere", () => {
  const page = annotate(PRICING_EN, PRICING_ES);
  const pay = find(page, "Pay once, use the paid features forever.");
  assert.equal(page.segments.filter((s) => s.key === pay.key).length, 1);
  assert.equal(page.english.split(`data-seg="${pay.id}"`).length - 1, 2);
  assert.equal(page.translated.split(`data-seg="${pay.id}"`).length - 1, 2);
});

test("html segments keep their inline markup, as the Worker keys them", () => {
  const page = annotate(PRICING_EN, PRICING_ES);
  const link = find(page, 'Get <a href="/get">Beekeeper Studio</a> now');
  assert.equal(link.translation, 'Obtén <a href="/get">Beekeeper Studio</a> ya');
  assert.equal(link.kind, "html");
  assert.match(link.where, /under "Pricing"/);
});

test("a shared include's strings know their scope", () => {
  const blog = find(annotate(PRICING_EN, PRICING_ES), "Blog");
  assert.equal(blog.scope, "footer");
  // Left as it is in the copy: nothing to show.
  assert.equal(blog.translation, null);
});

test("attributes and the head are segments, but have nothing on the page to mark", () => {
  const page = annotate(PRICING_EN, PRICING_ES);
  const alt = find(page, "The editor");
  assert.equal(alt.kind, "attr");
  assert.equal(alt.translation, "El editor");
  const title = page.segments.find((s) => s.kind === "head" && s.key === "Pricing plans");
  assert.ok(title, "the <title> is a head segment");
  assert.equal(title!.translation, "Planes y precios");
  assert.ok(!page.english.includes(`data-seg="${alt.id}"`));
});

test("bare text is wrapped so it can be marked", () => {
  const en = "<!DOCTYPE html><html><body><div><p>Hello <b>there</b></p>Loose words<p>x</p></div></body></html>";
  const es = "<!DOCTYPE html><html><body><div><p>Hola <b>ahí</b></p>Palabras sueltas<p>x</p></div></body></html>";
  const page = annotate(en, es);
  const loose = find(page, "Loose words");
  assert.equal(loose.kind, "text");
  assert.equal(loose.translation, "Palabras sueltas");
  assert.match(page.english, new RegExp(`<span data-seg="${loose.id}">Loose words</span>`));
  assert.match(page.translated, new RegExp(`<span data-seg="${loose.id}">Palabras sueltas</span>`));
});

test("pages that don't line up are not paired: no translation is put on the wrong English", () => {
  // The English page has a paragraph the copy was made without.
  const en = "<!DOCTYPE html><html><body><p>One</p><p>Two</p><p>Three</p></body></html>";
  const es = "<!DOCTYPE html><html><body><p>Uno</p><p>Tres</p></body></html>";
  const page = annotate(en, es);
  assert.equal(page.aligned, false);
  assert.deepEqual(page.segments.map((s) => s.translation), [null, null, null]);
  assert.ok(!page.translated.includes("data-seg"), "the copy has no marks");
  assert.ok(page.english.includes("data-seg"), "the English page still has its own");
  // The same count, but another kind of segment.
  const other = annotate(en, "<!DOCTYPE html><html><body><p>Uno</p><p>Dos</p><img alt='Tres'></body></html>");
  assert.equal(other.aligned, false);
});

test("a page that is not translated yet has no translations", () => {
  const page = annotate(PRICING_EN, PRICING_EN);
  assert.ok(page.segments.every((s) => s.translation === null));
});
