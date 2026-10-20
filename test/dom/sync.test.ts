// @vitest-environment jsdom
import { test } from "vitest";
import assert from "node:assert/strict";
import { anchorAt, scrollToAnchor } from "../../src/lib/sync.ts";

// jsdom has no layout: each element is given the top and height a page would.
function page(tops: Record<string, number[]>, scrollTop: number): Document {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write("<!doctype html><body></body>");
  doc.close();
  const scroller = doc.documentElement;
  scroller.scrollTop = scrollTop;
  Object.defineProperty(doc, "scrollingElement", { value: scroller });
  for (const [id, at] of Object.entries(tops)) {
    for (const top of at) {
      const p = doc.createElement("p");
      p.setAttribute("data-seg", id);
      p.getBoundingClientRect = () => ({ top: top - scroller.scrollTop, bottom: top - scroller.scrollTop + 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: top - scroller.scrollTop, toJSON() {} }) as DOMRect;
      doc.body.append(p);
    }
  }
  return doc;
}

test("the other page scrolls to the same occurrence of a repeated segment, not the first", () => {
  // "Download" is at the top and again far down, on both pages (the pages differ in height).
  const english = page({ intro: [0], download: [100, 3000] }, 2990);
  const spanish = page({ intro: [0], download: [140, 3400] }, 0);
  const anchor = anchorAt(english)!;
  assert.deepEqual([anchor.id, anchor.nth], ["download", 1]);
  assert.equal(scrollToAnchor(spanish, anchor), true);
  assert.equal(spanish.documentElement.scrollTop, 3400 - anchor.offset);
});

test("a segment that is only once on the page is nth 0, and a missing occurrence falls back to the first", () => {
  const english = page({ a: [0], b: [500] }, 480);
  const anchor = anchorAt(english)!;
  assert.deepEqual([anchor.id, anchor.nth], ["b", 0]);
  const other = page({ a: [0], b: [800] }, 0);
  assert.equal(scrollToAnchor(other, { id: "b", offset: 10, nth: 3 }), true);
  assert.equal(other.documentElement.scrollTop, 790);
  assert.equal(scrollToAnchor(other, { id: "missing", offset: 0, nth: 0 }), false);
});
