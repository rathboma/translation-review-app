import { test, expect } from "@playwright/test";
import { chipLabels, editor, newTranslation, openPricing, prepare, savedNotes, selectPhrase, typed } from "./helpers.ts";

const LINK = "Lee la documentación y empieza gratis.";
const LINK_HTML = 'Lee la <a href="/docs">documentación</a> y <strong>empieza gratis</strong>.';

let violations: string[];
test.beforeEach(async ({ page }) => {
  violations = await prepare(page);
  await openPricing(page);
});
test.afterEach(() => expect(violations).toEqual([]));

async function openLink(page: import("@playwright/test").Page, phrase = "documentación") {
  await selectPhrase(page, "Español page", "Lee la documentación", phrase);
  await expect(editor(page)).toBeVisible();
}

async function save(page: import("@playwright/test").Page): Promise<string> {
  await editor(page).getByRole("button", { name: /Save note|Update note/ }).click();
  await expect(editor(page)).toBeHidden();
  const notes = await savedNotes(page);
  return notes[notes.length - 1].new;
}

test("inline tags are chips, and the selected words are selected between them", async ({ page }) => {
  await openLink(page);
  expect(await chipLabels(page)).toEqual(["<a>", "</a>", "<strong>", "</strong>"]);
  expect(await typed(page)).toBe(LINK);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("documentación");
});

test("retyping just the words of a link keeps them in the link", async ({ page }) => {
  await openLink(page);
  await page.keyboard.type("guía");
  expect(await save(page)).toBe('Lee la <a href="/docs">guía</a> y <strong>empieza gratis</strong>.');
});

test("deleting a link's words, then typing, still types in the link", async ({ page }) => {
  await openLink(page);
  await page.keyboard.press("Delete");
  expect(await chipLabels(page)).toEqual(["<a>", "</a>", "<strong>", "</strong>"]);
  await page.keyboard.type("ref");
  expect(await save(page)).toBe('Lee la <a href="/docs">ref</a> y <strong>empieza gratis</strong>.');
});

test("backspacing a link's words one by one, then typing, still types in the link", async ({ page }) => {
  await openLink(page);
  await page.keyboard.press("ArrowRight"); // the caret at the end of the selection, inside the link
  for (let i = 0; i < "documentación".length; i++) await page.keyboard.press("Backspace");
  expect(await chipLabels(page)).toEqual(["<a>", "</a>", "<strong>", "</strong>"]);
  await page.keyboard.type("x");
  expect(await save(page)).toBe('Lee la <a href="/docs">x</a> y <strong>empieza gratis</strong>.');
});

test("typing at a caret next to a chip stays on its side of it", async ({ page }) => {
  await openLink(page, "empieza");
  await page.keyboard.press("ArrowLeft"); // the caret at the start of "empieza", just inside <strong>
  await page.keyboard.type("¡");
  expect(await save(page)).toBe('Lee la <a href="/docs">documentación</a> y <strong>¡empieza gratis</strong>.');
});

test("select all and type replaces the words and leaves every chip", async ({ page }) => {
  await openLink(page);
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Nuevo");
  expect(await chipLabels(page)).toEqual(["<a>", "</a>", "<strong>", "</strong>"]);
  const html = await save(page);
  for (const tag of ['<a href="/docs">', "</a>", "<strong>", "</strong>"]) expect(html).toContain(tag);
  expect(html).toContain("Nuevo");
});

test("a chip can't be backspaced, deleted or typed over", async ({ page }) => {
  await openLink(page, "empieza");
  // The caret at the start of "empieza", just after <strong>: Backspace would take the chip.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");
  expect(await chipLabels(page)).toEqual(["<a>", "</a>", "<strong>", "</strong>"]);
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  expect(await chipLabels(page)).toEqual(["<a>", "</a>", "<strong>", "</strong>"]);
  expect(await typed(page).then((t) => t.replace(/[<>/a-z]/g, "").trim())).not.toContain("Lee");
});

test("a translation of only tags can't be saved: it has no words", async ({ page }) => {
  await openLink(page);
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await expect(editor(page).getByRole("button", { name: "Save note" })).toBeDisabled();
  await expect(editor(page)).toContainText("no words in the translation");
  await page.keyboard.type("Algo");
  await expect(editor(page).getByRole("button", { name: "Save note" })).toBeEnabled();
});

test("a chip can be dragged to another place", async ({ page }) => {
  await openLink(page);
  const open = newTranslation(page).locator(".chip", { hasText: "<strong>" });
  // Dropped at the very start of the first line of text.
  await open.dragTo(newTranslation(page), { targetPosition: { x: 6, y: 18 } });
  expect(await chipLabels(page)).toEqual(["<strong>", "<a>", "</a>", "</strong>"]);
  expect(await save(page)).toBe('<strong>Lee la <a href="/docs">documentación</a> y empieza gratis</strong>.');
});

test("a selected chip moves with Alt and the arrow keys", async ({ page }) => {
  await openLink(page);
  const open = newTranslation(page).locator(".chip", { hasText: "<strong>" });
  await open.click();
  await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Alt+ArrowRight");
  expect(await save(page)).toBe('Lee la <a href="/docs">documentación</a> y em<strong>pieza gratis</strong>.');
});

test("undo and redo, which the editor keeps itself", async ({ page }) => {
  await openLink(page);
  await page.keyboard.type("guía");
  await expect.poll(() => typed(page)).toBe("Lee la guía y empieza gratis.");
  await page.keyboard.press("Control+Z");
  await expect.poll(() => typed(page)).not.toContain("guía");
  expect(await chipLabels(page)).toEqual(["<a>", "</a>", "<strong>", "</strong>"]);
  await page.keyboard.press("Control+Shift+Z");
  await expect.poll(() => typed(page)).toBe("Lee la guía y empieza gratis.");
});

test("pasting is plain text, however it was copied", async ({ page }) => {
  await openLink(page);
  await newTranslation(page).evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/html", "<b>negrita</b><script>x</script>");
    data.setData("text/plain", "pegado\ncon salto");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  expect(await save(page)).toBe('Lee la <a href="/docs">pegado con salto</a> y <strong>empieza gratis</strong>.');
});

test("typed angle brackets and ampersands are text, not markup", async ({ page }) => {
  await openLink(page, "gratis");
  await page.keyboard.type("A & B <3");
  expect(await save(page)).toBe('Lee la <a href="/docs">documentación</a> y <strong>empieza A &amp; B &lt;3</strong>.');
});

test("Enter doesn't break the line, Escape closes, Ctrl+Enter saves", async ({ page }) => {
  await openLink(page);
  await page.keyboard.type("guía");
  await page.keyboard.press("Enter");
  expect(await typed(page)).toBe("Lee la guía y empieza gratis.");
  await page.keyboard.press("Control+Enter");
  await expect(editor(page)).toBeHidden();
  expect((await savedNotes(page))[0].new).toBe('Lee la <a href="/docs">guía</a> y <strong>empieza gratis</strong>.');
  await openLink(page);
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeHidden();
});

test("a Japanese IME composing over a selection types in the link, and the link survives", async ({ page }) => {
  await openLink(page);
  const client = await page.context().newCDPSession(page);
  await client.send("Input.imeSetComposition", { text: "に", selectionStart: 1, selectionEnd: 1 });
  await client.send("Input.imeSetComposition", { text: "にほん", selectionStart: 3, selectionEnd: 3 });
  await client.send("Input.insertText", { text: "日本" });
  expect(await chipLabels(page)).toEqual(["<a>", "</a>", "<strong>", "</strong>"]);
  expect(await save(page)).toBe('Lee la <a href="/docs">日本</a> y <strong>empieza gratis</strong>.');
});

// ---- found by review ----------------------------------------------------------

const GUARD = "\u200b";
// Guards that are not at the chip side of a text node.
const strayGuards = (page: import("@playwright/test").Page) =>
  newTranslation(page).evaluate((el, guard) => {
    let stray = 0;
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const data = node.textContent ?? "";
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== guard) continue;
        const chipBefore = i === 0 && (node.previousSibling as HTMLElement | null)?.classList?.contains("chip");
        const chipAfter = i === data.length - 1 && (node.nextSibling as HTMLElement | null)?.classList?.contains("chip");
        if (!chipBefore && !chipAfter) stray++;
      }
    }
    return stray;
  }, GUARD);

test("a chip can't be moved past the one it pairs with: the link would be closed before it is opened", async ({ page }) => {
  await openLink(page);
  const open = newTranslation(page).locator(".chip", { hasText: /^<a>$/ });
  await open.click();
  // Right along "documentación" (13 letters), to the end of the link, then one more: past </a>.
  for (let i = 0; i < 16; i++) await page.keyboard.press("Alt+ArrowRight");
  expect(await chipLabels(page)).toEqual(["<a>", "</a>", "<strong>", "</strong>"]);
  expect(await save(page)).toBe('Lee la documentación<a href="/docs"></a> y <strong>empieza gratis</strong>.');
});

test("a chip can't be dragged to a place that crosses another pair", async ({ page }) => {
  await openLink(page);
  const close = newTranslation(page).locator(".chip", { hasText: "</strong>" });
  // Dropped at the very start of the first line: </strong> before <strong> would be mis-nested.
  await close.dragTo(newTranslation(page), { targetPosition: { x: 6, y: 18 } });
  expect(await chipLabels(page)).toEqual(["<a>", "</a>", "<strong>", "</strong>"]);
  await expect(newTranslation(page)).toHaveClass(/nudge/);
  // Nothing moved, so there is nothing to save: type something to see the text is whole.
  await page.keyboard.type("!");
  await save(page);
  // The chips are where they were, in order, around the same words (the "!" is the typing).
  expect((await savedNotes(page))[0].new).toContain(LINK_HTML);
});

test("moving a chip across words leaves no invisible breaks in them", async ({ page }) => {
  await openLink(page);
  await newTranslation(page).locator(".chip", { hasText: "<strong>" }).click();
  for (let i = 0; i < 4; i++) await page.keyboard.press("Alt+ArrowRight");
  expect(await strayGuards(page)).toBe(0);
  await page.keyboard.type("X");
  expect(await strayGuards(page)).toBe(0);
});

test("copying across chips copies the words, not the chips' labels", async ({ page }) => {
  await openLink(page);
  await page.keyboard.press("Control+A");
  const copied = await newTranslation(page).evaluate((el) => {
    const data = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData("text/plain");
  });
  expect(copied).toBe(LINK);
});

test("cutting words across chips takes the words and leaves the chips", async ({ page }) => {
  await openLink(page);
  await page.keyboard.press("Control+A");
  const cut = await newTranslation(page).evaluate((el) => {
    const data = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent("cut", { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData("text/plain");
  });
  expect(cut).toBe(LINK);
  expect(await chipLabels(page)).toEqual(["<a>", "</a>", "<strong>", "</strong>"]);
  expect((await typed(page)).trim()).toBe("");
});
