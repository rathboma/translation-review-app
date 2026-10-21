import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { calls, control, editor, english, frameOf, issueNotes, machine, newTranslation, openPricing, openQueue, pageShown, prepare, queueToggle, rewrite, savedNotes, selectedText, selectPhrase, signIn, submitAll, translated, wordPoint } from "./helpers.ts";

let violations: string[];
test.beforeEach(async ({ page }) => {
  violations = await prepare(page);
});
test.afterEach(() => expect(violations).toEqual([]));

const PAY = "Paga una vez, usa las funciones de pago para siempre.";
const dialog = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: "Submit notes" });

test("clicking a paragraph on either page opens the editor with the whole translation selected", async ({ page }) => {
  await openPricing(page);
  await english(page).locator("p", { hasText: "Only $99" }).click();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page)).toContainText("Only $99 a year for one user.");
  await expect.poll(() => selectedText(page)).toBe("Solo $99 al año para un usuario.");
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeHidden();

  await translated(page).locator("p", { hasText: "Solo $99" }).click();
  await expect(editor(page)).toBeVisible();
  await expect.poll(() => selectedText(page)).toBe("Solo $99 al año para un usuario.");
});

test("a double click selects a word, and the editor selects that word in the translation", async ({ page }) => {
  await openPricing(page);
  const { x, y } = await wordPoint(page, "Español page", "Solo $99", "usuario");
  await page.mouse.dblclick(x, y);
  await expect(editor(page)).toBeVisible();
  // Not the paragraph: the word, in the translation, ready to be retyped.
  await expect.poll(() => selectedText(page)).toBe("usuario");
  await page.keyboard.type("cliente");
  await expect(newTranslation(page)).toHaveText("Solo $99 al año para un cliente.");
});

test("a triple click, whose range runs into the next paragraph, is still one paragraph", async ({ page }) => {
  await openPricing(page);
  await translated(page).locator("p", { hasText: "Solo $99" }).click({ clickCount: 3 });
  await expect(editor(page)).toBeVisible();
  await expect.poll(() => selectedText(page)).toBe("Solo $99 al año para un usuario.");
});

test("a selection over two paragraphs is refused with a message", async ({ page }) => {
  await openPricing(page);
  const frame = await frameOf(page, "Español page");
  await frame.evaluate(() => {
    const paragraphs = Array.from(document.querySelectorAll("p[data-seg]"));
    const range = document.createRange();
    range.setStart(paragraphs[0].firstChild!, 2);
    range.setEnd(paragraphs[1].firstChild!, 3);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(page.getByRole("status").filter({ hasText: "Select within one paragraph." })).toBeVisible();
  await expect(editor(page)).toBeHidden();
});

test("a number that changed is an error in the editor, and the note can't be saved until it is fixed", async ({ page }) => {
  await openPricing(page);
  await selectPhrase(page, "Español page", "Solo $99", "$99");
  await page.keyboard.type("$89");
  await expect(editor(page)).toContainText("numbers missing from the translation: 99");
  await expect(editor(page).getByRole("button", { name: "Save note" })).toBeDisabled();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Solo $99 al año por usuario.");
  await expect(editor(page).getByRole("button", { name: "Save note" })).toBeEnabled();
});

test("hidden text: the title, the description, alt text and tooltips can be corrected from a drawer", async ({ page }) => {
  await openPricing(page);
  await page.getByRole("button", { name: /Hidden text/ }).click();
  const drawer = page.getByRole("complementary", { name: "Hidden text" });
  await expect(drawer.locator(".hidden-list li")).toHaveCount(3);
  await expect(drawer).toContainText("Logotipo de Beekeeper Studio");
  await expect(drawer).toContainText("Abre la página de descarga");
  await expect(drawer).toContainText("Precios de Beekeeper Studio");
  await drawer.getByPlaceholder("Filter…").fill("logo");
  await expect(drawer.locator(".hidden-list li")).toHaveCount(1);
  await drawer.locator(".hidden-list button").click();

  await expect(editor(page)).toBeVisible();
  await expect(editor(page)).toContainText("img[alt]");
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Logotipo de Beekeeper Studio, el editor SQL");
  await editor(page).getByRole("button", { name: "Save note" }).click();
  await page.getByRole("button", { name: /Hidden text/ }).click();
  await expect(page.getByRole("complementary", { name: "Hidden text" }).getByText("has a note")).toBeVisible();
  expect((await savedNotes(page))[0]).toMatchObject({ kind: "attr", key: "Beekeeper Studio logo", source: "generated", new: "Logotipo de Beekeeper Studio, el editor SQL" });
});

test("a string in a shared include says that a change applies on every page", async ({ page }) => {
  await openPricing(page);
  await translated(page).getByRole("link", { name: "Descargar" }).click();
  await expect(editor(page)).toContainText("This text is in the site header: a change applies on every page.");
});

test("text the copy left in English can be translated, or confirmed as English", async ({ page }) => {
  await openPricing(page);
  await translated(page).locator("p", { hasText: "The Business plan" }).click();
  await expect(editor(page)).toContainText("The copy still has English here");
  await expect(editor(page).getByRole("button", { name: "Keep the English" })).toBeEnabled();
  await editor(page).getByRole("button", { name: "Keep the English" }).click();
  await expect(editor(page)).toBeHidden();
  const [note] = await savedNotes(page);
  expect(note).toMatchObject({ source: "english", key: "The Business plan covers your whole team.", new: "The Business plan covers your whole team." });
});

test("every source of a translation is filed in the form that applies it, one issue per language", async ({ page }) => {
  await openPricing(page);
  // generated: a paragraph the model translated
  await rewrite(page, translated(page).locator("p", { hasText: "Solo $99" }), "Solo $99 al año por usuario.");
  // common: a link in the shared header
  await rewrite(page, translated(page).getByRole("link", { name: "Descargar" }), "Bajar Beekeeper");
  // explicit: a tooltip from a glob entry in git, through the hidden text drawer
  await page.getByRole("button", { name: /Hidden text/ }).click();
  await page.getByRole("complementary", { name: "Hidden text" }).getByText("Abre la página de descarga").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Abre la página para descargar");
  await editor(page).getByRole("button", { name: "Save note" }).click();
  // english: a paragraph the copy still has in English
  await rewrite(page, translated(page).locator("p", { hasText: "The Business plan" }), "El plan Business cubre a todo tu equipo.");
  // and another language
  await page.getByLabel("Language").selectOption("ja");
  await pageShown(page, "一度のお支払い", "日本語");
  await rewrite(page, translated(page, "日本語").locator("p", { hasText: "一度のお支払い" }).first(), "一度のお支払いで、有料機能を永久にご利用いただけます。");

  await expect(queueToggle(page)).toContainText("5");
  await submitAll(page);
  await expect(dialog(page).getByRole("heading", { name: "Thank you!" })).toBeVisible();
  await expect(dialog(page).getByRole("link")).toHaveCount(2);

  const { github } = await calls();
  expect(github.map((g) => g.body.title)).toEqual(["Translation notes (es): 4 notes from María López", "Translation notes (ja): 1 note from María López"]);
  expect(github.map((g) => g.body.labels)).toEqual([["translation", "lang:es"], ["translation", "lang:ja"]]);

  const es = Object.fromEntries(issueNotes(github[0]).map((n) => [n.source + (n.scope ? `:${n.scope}` : ""), n]));
  expect(Object.keys(es).sort()).toEqual(["common:header", "english", "explicit", "generated"]);
  expect(es.generated.apply).toEqual({
    action: "add-explicit",
    file: "bin/translations/explicit/es.yml",
    entry: { path: "/pricing/", en: "Only $99 a year for one user.", es: "Solo $99 al año por usuario." },
  });
  expect(es["common:header"].apply).toEqual({ action: "set-common", file: "bin/translations/common/es.json", set: ["header", "Download", "Bajar Beekeeper"] });
  // The glob entry that wins is the one to change, not the page.
  expect(es.explicit.apply).toEqual({
    action: "replace-explicit",
    file: "bin/translations/explicit/es.yml",
    entry: { path: "/pricing/**", en: "Opens the download page", es: "Abre la página para descargar" },
  });
  expect(es.english.apply).toEqual({
    action: "add-explicit",
    file: "bin/translations/explicit/es.yml",
    entry: { path: "/pricing/", en: "The Business plan covers your whole team.", es: "El plan Business cubre a todo tu equipo." },
  });
  expect(es.english.current).toBe("The Business plan covers your whole team.");
  expect(es["common:header"].path).toBe("/pricing/");
  expect(github[0].body.body).toContain("the site header: the change applies on every page");

  const [ja] = issueNotes(github[1]);
  expect(ja.apply).toEqual({
    action: "add-explicit",
    file: "bin/translations/explicit/ja.yml",
    entry: { path: "/pricing/", en: "Pay once, use the paid features forever.", ja: "一度のお支払いで、有料機能を永久にご利用いただけます。" },
  });
  expect(JSON.stringify(github)).not.toContain("maria@example.com");
});

test("a broken translation is refused, with the reason shown next to its note, and nothing is filed", async ({ page }) => {
  await openPricing(page);
  await page.evaluate(() => {
    const note = (id: string, key: string, current: string, next: string) => ({ id, lang: "es", path: "/pricing/", key, scope: null, source: "generated", kind: "html", where: 'p, under "Pricing"', current, new: next });
    const PAY = "Paga una vez, usa las funciones de pago para siempre.";
    localStorage.setItem(
      "translation-review:notes",
      JSON.stringify([
        note("lostlink", 'Read the <a href="/docs">documentation</a> and <strong>start for free</strong>.', 'Lee la <a href="/docs">documentación</a> y <strong>empieza gratis</strong>.', "Lee la documentación y empieza gratis."),
        note("price", "Only $99 a year for one user.", "Solo $99 al año para un usuario.", "Solo $89 al año para un usuario."),
        note("fine", "Pay once, use the paid features forever.", PAY, "Paga una sola vez, usa las funciones de pago para siempre."),
      ]),
    );
  });
  await page.reload();
  await pageShown(page);
  await expect(queueToggle(page)).toContainText("3");
  const before = (await calls()).worker.length;
  await submitAll(page);
  await expect(dialog(page).getByRole("alert")).toContainText("Some translations need fixing");
  await dialog(page).getByRole("button", { name: "Close" }).click();

  await openQueue(page);
  const lost = page.locator('.note[data-note="lostlink"]');
  const price = page.locator('.note[data-note="price"]');
  await expect(lost).toContainText("markup differs");
  await expect(price).toContainText("numbers missing from the translation: 99");
  await expect(page.locator('.note[data-note="fine"]')).not.toContainText("markup differs");
  await expect(page.locator(".queue-head .error-count")).toHaveText("2 to fix");
  const { github, worker } = await calls();
  expect(github).toHaveLength(0);
  // The manifest, for the lint, is all it asked: no page was fetched to check them.
  expect(worker.slice(before).filter((c) => c.path.startsWith("/_translations/annotated"))).toEqual([]);

  // Fix one, and only the other is left to fix.
  await lost.getByRole("button", { name: "Edit" }).click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Lee la ");
  await expect(editor(page)).toContainText("markup differs");
  await editor(page).getByRole("button", { name: "Start again from the current translation" }).click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Consulta la");
  await editor(page).getByRole("button", { name: /Update note/ }).click();
  await expect(page.locator(".queue-head .error-count")).toHaveText("1 to fix");
});

test("a note whose English has gone from the page is filed as stale", async ({ page }) => {
  await openPricing(page);
  await rewrite(page, translated(page).locator("p", { hasText: "Solo $99" }), "Solo $99 al año por usuario.");
  // Meanwhile the English page changes: that sentence is no longer on it.
  await control({ removeSegment: { page: "es /pricing/", key: "Only $99 a year for one user." } });
  await submitAll(page);
  await expect(dialog(page).getByRole("heading", { name: "Thank you!" })).toBeVisible();
  const { github } = await calls();
  const [note] = issueNotes(github[0]);
  expect(note.stale).toBe(true);
  expect(github[0].body.body).toContain("**Stale:** this English text is no longer on the page. Skip this note.");
});

test("when GitHub fails part way, the notes already filed leave the queue and the others stay", async ({ page }) => {
  await openPricing(page);
  await rewrite(page, translated(page).locator("p", { hasText: "Solo $99" }), "Solo $99 al año por usuario.");
  await page.getByLabel("Language").selectOption("ja");
  await pageShown(page, "一度のお支払い", "日本語");
  await rewrite(page, translated(page, "日本語").locator("p", { hasText: "一度のお支払い" }).first(), "一度のお支払いで、有料機能をずっと。");
  await control({ failGithub: [2] });
  await submitAll(page);
  await expect(dialog(page).getByRole("alert")).toContainText("One issue was filed before that");
  await expect(dialog(page).getByText("(already filed)")).toBeVisible();
  await expect(queueToggle(page)).toContainText("1");
  const [left] = await savedNotes(page);
  expect(left.lang).toBe("ja");
  // A retry files only what is left.
  await dialog(page).getByRole("button", { name: /^Submit 1 note$/ }).click();
  await expect(dialog(page).getByRole("heading", { name: "Thank you!" })).toBeVisible();
  const { github } = await calls();
  expect(github.map((g) => g.body.title.match(/\((\w+)\)/)![1])).toEqual(["es", "ja", "ja"]);
});

test("the queue survives a reload, and its notes can be edited and deleted", async ({ page }) => {
  await openPricing(page);
  await rewrite(page, translated(page).locator("p", { hasText: "Solo $99" }), "Solo $99 al año por usuario.", "más natural");
  await page.reload();
  await pageShown(page);
  await expect(queueToggle(page)).toContainText("1");
  // The paragraph is marked again, and clicking it edits the same note.
  await expect(translated(page).locator("p.rv-noted", { hasText: "Solo $99" })).toBeVisible();
  await translated(page).locator("p", { hasText: "Solo $99" }).click();
  await expect(editor(page)).toContainText("Solo $99 al año por usuario.");
  await expect(editor(page).getByLabel("Comment (optional)")).toHaveValue("más natural");
  await expect(editor(page).getByRole("button", { name: "Update note" })).toBeVisible();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Solo $99 al año por persona.");
  await editor(page).getByRole("button", { name: "Update note" }).click();
  expect(await savedNotes(page)).toHaveLength(1);
  expect((await savedNotes(page))[0].new).toBe("Solo $99 al año por persona.");

  await openQueue(page);
  await page.locator(".note").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".note").getByRole("button", { name: "Really delete?" })).toBeVisible();
  await page.locator(".note").getByRole("button", { name: "Really delete?" }).click();
  await expect(page.locator(".note")).toHaveCount(0);
  expect(await savedNotes(page)).toEqual([]);
});

test("signing out is for the next person at this browser: it asks, and the unsent notes go", async ({ page }) => {
  await openPricing(page);
  await rewrite(page, translated(page).locator("p", { hasText: "Solo $99" }), "Solo $99 al año por usuario.");
  // Declined: still signed in, still has the note.
  const messages: string[] = [];
  page.once("dialog", (d) => {
    messages.push(d.message());
    void d.dismiss();
  });
  await page.getByRole("button", { name: "Not you?" }).click();
  expect(messages[0]).toContain("The 1 note you haven't sent will be deleted");
  await expect(queueToggle(page)).toContainText("1");
  // Accepted: signed out, nothing left for the next person to send as theirs.
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Not you?" }).click();
  await expect(page.getByRole("heading", { name: "Review the translations" })).toBeVisible();
  await signIn(page, "Otra Persona", "otra@example.com");
  await expect(queueToggle(page)).toContainText("0");
  expect(await savedNotes(page)).toEqual([]);
});

test("without notes, signing out doesn't ask", async ({ page }) => {
  await openPricing(page);
  page.on("dialog", () => {
    throw new Error("asked");
  });
  await page.getByRole("button", { name: "Not you?" }).click();
  await expect(page.getByRole("heading", { name: "Review the translations" })).toBeVisible();
});

test("two tabs share one queue: a note made in one appears in the other", async ({ page, context }) => {
  await openPricing(page);
  const other = await context.newPage();
  await other.goto("/");
  await expect(queueToggle(other)).toContainText("0");
  await rewrite(page, translated(page).locator("p", { hasText: "Solo $99" }), "Solo $99 al año por usuario.");
  await expect(queueToggle(other)).toContainText("1");
  await other.close();
});

test("more notes than one submission holds: the first hundred are sent, the rest stay", async ({ page }) => {
  await openPricing(page);
  await page.evaluate(() => {
    const notes = Array.from({ length: 105 }, (_, i) => ({
      id: `n${i}`, lang: "es", path: "/pricing/", key: `Gone ${i}`, scope: null, source: "generated", kind: "html", where: "p", current: `Se fue ${i}`, new: `Se fue de verdad ${i}`,
    }));
    localStorage.setItem("translation-review:notes", JSON.stringify(notes));
  });
  await page.reload();
  await pageShown(page);
  await expect(queueToggle(page)).toContainText("105");
  await page.getByRole("button", { name: "Submit 105 notes" }).click();
  await expect(dialog(page)).toContainText("100 notes (Español: 100) of your 105");
  await expect(dialog(page).getByRole("button", { name: "Submit 100 notes" })).toBeEnabled();
  await dialog(page).getByRole("button", { name: "Submit 100 notes" }).click();
  await expect(dialog(page).getByRole("heading", { name: "Thank you!" })).toBeVisible();
  await expect(dialog(page)).toContainText("5 more notes are still in your queue");
  // They are about English that isn't on the page: filed as stale, and the translator is told.
  await expect(dialog(page)).toContainText("100 of the notes were filed as stale");
  await dialog(page).getByRole("button", { name: "Done" }).click();
  expect(await savedNotes(page)).toHaveLength(5);
  const { github } = await calls();
  expect(github.length).toBeGreaterThanOrEqual(1);
  expect(github.flatMap((g) => issueNotes(g)).length).toBe(100);
});

test("a stale note is reported to the translator", async ({ page }) => {
  await openPricing(page);
  await rewrite(page, translated(page).locator("p", { hasText: "Solo $99" }), "Solo $99 al año por usuario.");
  await control({ removeSegment: { page: "es /pricing/", key: "Only $99 a year for one user." } });
  await submitAll(page);
  await expect(dialog(page).getByRole("heading", { name: "Thank you!" })).toBeVisible();
  await expect(dialog(page)).toContainText("1 of the notes was filed as stale");
});

test("a note that says what the page says already is refused, with the reason beside it", async ({ page }) => {
  await openPricing(page);
  await page.evaluate(() => {
    localStorage.setItem("translation-review:notes", JSON.stringify([
      { id: "moot", lang: "es", path: "/pricing/", key: "Only $99 a year for one user.", scope: null, source: "generated", kind: "html", where: "p", current: "Solo $99 por año.", new: "Solo $99 al año para un usuario." },
    ]));
  });
  await page.reload();
  await pageShown(page);
  await submitAll(page);
  await expect(dialog(page).getByRole("alert")).toContainText("Some notes need fixing");
  await dialog(page).getByRole("button", { name: "Close" }).click();
  await openQueue(page);
  await expect(page.locator('.note[data-note="moot"]')).toContainText("already the current translation");
  expect((await calls()).github).toHaveLength(0);
});

test("no secret reaches the browser, and the Worker is only asked with its token", async ({ page }) => {
  const bodies: string[] = [];
  page.on("response", async (response) => {
    if (response.url().includes("/api/")) bodies.push(await response.text().catch(() => ""));
  });
  await openPricing(page);
  await rewrite(page, translated(page).locator("p", { hasText: "Solo $99" }), "Solo $99 al año por usuario.");
  await submitAll(page);
  await expect(dialog(page).getByRole("heading", { name: "Thank you!" })).toBeVisible();
  expect(bodies.length).toBeGreaterThan(2);
  for (const secret of ["e2e-token", "gh-e2e-token", "ts-e2e-secret"]) {
    for (const body of bodies) expect(body).not.toContain(secret);
    // Nor is it in the app that was sent.
    for (const file of readdirSync("dist/assets")) expect(readFileSync(`dist/assets/${file}`, "utf8")).not.toContain(secret);
  }
  const { worker, github } = await calls();
  expect(worker.length).toBeGreaterThan(0);
  expect(worker.every((c) => c.authorization === "Bearer e2e-token")).toBe(true);
  expect(github.every((g) => g.authorization === "Bearer gh-e2e-token")).toBe(true);
  expect(JSON.stringify(github)).not.toContain("maria@example.com");
});

test("the sixth submission an hour from one address is refused, and the notes stay", async ({ page, request }) => {
  const ip = "203.0.113.77";
  violations = await prepare(page, ip);
  const note = (id: string) => ({ id, lang: "es", path: "/pricing/", key: "Pay once, use the paid features forever.", scope: null, source: "generated", kind: "html", where: "p", current: PAY, new: `Paga una sola vez ${id}, usa las funciones de pago para siempre.` });
  for (let i = 0; i < 5; i++) {
    const response = await request.post("/api/submit", { data: { name: "Rate Test", email: "rate@example.com", turnstileToken: "mock-token", notes: [note(`n${i}`)] }, headers: { "cf-connecting-ip": ip } });
    expect(response.status(), `submission ${i + 1}`).toBe(200);
  }
  await openPricing(page);
  await rewrite(page, translated(page).locator("p", { hasText: "Solo $99" }), "Solo $99 al año por usuario.");
  await submitAll(page);
  await expect(dialog(page).getByRole("alert")).toContainText("Too many submissions from your network. Try again in 60 minutes.");
  await expect(queueToggle(page)).toContainText("1");
  expect((await calls()).github).toHaveLength(5);
});

test("tags in the wrong order pass the Worker's lint, and are an error in the queue and the editor all the same", async ({ page }) => {
  await openPricing(page);
  // The same tags as the English, so the lint, which compares them as a list, is content.
  await page.evaluate(() => {
    localStorage.setItem("translation-review:notes", JSON.stringify([
      { id: "crossed", lang: "es", path: "/pricing/", key: 'Read the <a href="/docs">documentation</a> and <strong>start for free</strong>.', scope: null, source: "generated", kind: "html", where: "p",
        current: 'Lee la <a href="/docs">documentación</a> y <strong>empieza gratis</strong>.', new: 'Lee la documentación</a><a href="/docs"> y <strong>empieza gratis</strong>.' },
    ]));
  });
  await page.reload();
  await pageShown(page);
  await openQueue(page);
  const row = page.locator('.note[data-note="crossed"]');
  await expect(row).toContainText("the tags are not nested correctly");
  await row.getByRole("button", { name: "Edit" }).click();
  await expect(editor(page)).toContainText("the tags are not nested correctly");
  await expect(editor(page).getByRole("button", { name: /Update note|Save note/ })).toBeDisabled();
  // And the server refuses it, whatever a browser says.
  await page.keyboard.press("Escape");
  await submitAll(page);
  await expect(dialog(page).getByRole("alert")).toContainText(/Some (notes|translations) need fixing/);
  expect((await calls()).github).toHaveLength(0);
});
