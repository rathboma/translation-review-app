// @vitest-environment jsdom
import { test } from "vitest";
import assert from "node:assert/strict";
import { clickedSegment, readSelection, segmentOf } from "../../src/lib/selection.ts";

// A document in an iframe, as the pages are in the app: it has its own window
// (so selections work) and its nodes are from another realm.
function doc(body: string): Document {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const d = frame.contentDocument!;
  d.open();
  d.write(`<!doctype html><html><body>${body}</body></html>`);
  d.close();
  return d;
}

function select(d: Document, from: [Node, number], to: [Node, number]) {
  const range = d.createRange();
  range.setStart(...from);
  range.setEnd(...to);
  const selection = d.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

const text = (d: Document, selector: string) => d.querySelector(selector)!.firstChild!;

const PAGE = `<h1 data-seg="s1">Pricing</h1>
<p data-seg="s2">Pay <a href="/get">once</a> and use it <b>forever</b>.</p>
<p data-seg="s3">Second paragraph</p>
<pre>code block</pre>`;

test("a node's segment is the nearest data-seg above it, across a link", () => {
  const d = doc(PAGE);
  assert.equal(segmentOf(text(d, "a"))!.getAttribute("data-seg"), "s2");
  assert.equal(segmentOf(d.querySelector("b"))!.getAttribute("data-seg"), "s2");
  assert.equal(segmentOf(d.querySelector("h1"))!.getAttribute("data-seg"), "s1");
  assert.equal(segmentOf(text(d, "pre")), null);
  assert.equal(segmentOf(null), null);
  assert.equal(clickedSegment(d.querySelector("a"))!.getAttribute("data-seg"), "s2");
});

test("no selection, or a collapsed one, selects nothing", () => {
  const d = doc(PAGE);
  assert.deepEqual(readSelection(d), { kind: "none" });
  select(d, [text(d, "h1"), 2], [text(d, "h1"), 2]);
  assert.deepEqual(readSelection(d), { kind: "none" });
});

test("a selection inside a link inside a paragraph is in the paragraph, with its text and offsets", () => {
  const d = doc(PAGE);
  select(d, [text(d, "a"), 0], [text(d, "a"), 4]);
  const result = readSelection(d);
  assert.equal(result.kind, "segment");
  if (result.kind !== "segment") return;
  assert.equal(result.selection.id, "s2");
  assert.equal(result.selection.text, "once");
  // "Pay " is 4 characters before the link.
  assert.deepEqual([result.selection.start, result.selection.end], [4, 8]);
  assert.equal(result.selection.element.textContent, "Pay once and use it forever.");
});

test("a selection from plain text through a link to bold text, in one paragraph", () => {
  const d = doc(PAGE);
  select(d, [text(d, "p"), 1], [text(d, "b"), 3]);
  const result = readSelection(d);
  assert.equal(result.kind, "segment");
  if (result.kind !== "segment") return;
  assert.equal(result.selection.text, "ay once and use it for");
  assert.equal(result.selection.start, 1);
});

test("a selection over two paragraphs is refused", () => {
  const d = doc(PAGE);
  select(d, [text(d, "a"), 1], [d.querySelectorAll("p")[1].firstChild!, 6]);
  assert.deepEqual(readSelection(d), { kind: "several" });
});

test("a triple click, whose range ends at the start of the next paragraph, is still one paragraph", () => {
  const d = doc(PAGE);
  const p = d.querySelectorAll("p")[0];
  select(d, [p.firstChild!, 0], [d.querySelectorAll("p")[1], 0]);
  const result = readSelection(d);
  assert.equal(result.kind, "segment");
  if (result.kind !== "segment") return;
  assert.equal(result.selection.id, "s2");
  assert.equal(result.selection.text, "Pay once and use it forever.");
});

test("a selection that also covers whitespace between paragraphs is one paragraph", () => {
  const d = doc(PAGE);
  select(d, [text(d, "h1"), 3], [d.body.childNodes[1], 1]);
  const result = readSelection(d);
  assert.equal(result.kind, "segment");
  if (result.kind !== "segment") return;
  assert.equal(result.selection.id, "s1");
  assert.equal(result.selection.text, "cing");
});

test("text outside any segment is nothing", () => {
  const d = doc(PAGE);
  select(d, [text(d, "pre"), 0], [text(d, "pre"), 4]);
  assert.deepEqual(readSelection(d), { kind: "none" });
});

test("the same English in two places is still two paragraphs", () => {
  const d = doc('<p data-seg="s1">Same</p><p data-seg="s1">Same</p>');
  select(d, [d.querySelectorAll("p")[0].firstChild!, 0], [d.querySelectorAll("p")[1].firstChild!, 4]);
  assert.deepEqual(readSelection(d), { kind: "several" });
});
