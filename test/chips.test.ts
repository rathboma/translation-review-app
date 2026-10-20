import { test } from "vitest";
import assert from "node:assert/strict";
import { chipLabel, locate, parseParts, plainText, sameTags, serializeParts, tagsOf } from "../shared/chips.ts";

const round = (html: string) => serializeParts(parseParts(html));

test("html round-trips through chips unchanged", () => {
  for (const html of [
    "Paga una vez.",
    'Lee la <a href="/features">documentación</a> y <strong>empieza</strong>.',
    "Usa <code>SELECT *</code> &amp; <em>más</em>.",
    'Una línea<br>otra línea<br/>y <img src="/a.png" alt="x &gt; y">',
    'Con un título <a href="/x" title="a > b" class="btn">enlace</a>',
    "5 &lt; 6 y 7 &gt; 3",
    "<b><i>anidado</i></b>",
    "",
  ]) {
    assert.equal(round(html), html);
  }
});

test("text is decoded in the parts and encoded again, tags are kept byte for byte", () => {
  const parts = parseParts('A &amp; B <a href="/x?a=1&amp;b=2">C &lt; D</a>');
  assert.deepEqual(parts.map((p) => (p.type === "text" ? p.value : p.html)), ["A & B ", '<a href="/x?a=1&amp;b=2">', "C < D", "</a>"]);
  assert.equal(plainText(parts), "A & B C < D");
  assert.deepEqual(tagsOf(parts), ['<a href="/x?a=1&amp;b=2">', "</a>"]);
});

test("entities that are not canonical still mean the same text", () => {
  const html = "Cuesta&nbsp;5 &#8364; &quot;hoy&quot;";
  const parts = parseParts(html);
  assert.equal(plainText(parts), "Cuesta 5 € \"hoy\"");
  assert.deepEqual(parseParts(serializeParts(parts)), parts);
});

test("tags roles and labels", () => {
  const tags = parseParts('<a href="/x">hi</a><br><img src="a.png"><wbr/>').filter((p) => p.type === "tag");
  assert.deepEqual(tags.map((t) => t.role), ["open", "close", "void", "void", "void"]);
  assert.deepEqual(tags.map(chipLabel), ["<a>", "</a>", "<br>", "<img>", "<wbr>"]);
});

test("a comment is a chip too", () => {
  const parts = parseParts("a<!-- note -->b");
  assert.equal(parts.length, 3);
  assert.equal(chipLabel(parts[1] as never), "<!-- -->");
});

test("moving a chip keeps the tags the same, dropping one does not", () => {
  const before = parseParts('Lee <a href="/x">esto</a> ahora');
  assert.ok(sameTags(before, parseParts('Lee ahora <a href="/x">esto</a>')));
  assert.ok(!sameTags(before, parseParts("Lee esto ahora")));
  assert.ok(!sameTags(before, parseParts('Lee <a href="/y">esto</a> ahora')));
});

test("locate finds a selection in the translation", () => {
  const plain = "Paga una vez, usa las funciones de pago para siempre.";
  assert.deepEqual(locate(plain, "una vez"), [5, 12]);
  assert.deepEqual(locate(plain, "  funciones "), [22, 31]);
  assert.equal(locate(plain, "nunca"), null);
  assert.equal(locate(plain, "   "), null);
});

test("locate ignores line breaks and indentation the page kept from the source", () => {
  const plain = "Paga una vez, usa las funciones";
  assert.deepEqual(locate(plain, "una\n      vez,\n usa"), [5, 17]);
});

test("locate picks the match closest to where the selection was", () => {
  const plain = "no, no, no";
  assert.deepEqual(locate(plain, "no", 0), [0, 2]);
  assert.deepEqual(locate(plain, "no", 4), [4, 6]);
  assert.deepEqual(locate(plain, "no", 9), [8, 10]);
});

test("hasWords sees text, not tags", async () => {
  const { hasWords } = await import("../shared/chips.ts");
  assert.equal(hasWords("<a href=\"/x\"></a><strong></strong>"), false);
  assert.equal(hasWords("  <b> </b> "), false);
  assert.equal(hasWords("<a href=\"/x\">x</a>"), true);
  assert.equal(hasWords("&nbsp;"), false);
  assert.equal(hasWords("日本語"), true);
});
