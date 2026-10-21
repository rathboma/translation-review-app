import { test, expect } from "@playwright/test";
import { calls, selectPhrase, editor, english, machine, newTranslation, openQueue, pageShown, pickPage, prepare, queueToggle, selectedText, signIn, submitAll, translated } from "./helpers.ts";

let violations: string[];
test.beforeEach(async ({ page }) => {
  violations = await prepare(page);
});
test.afterEach(() => {
  expect(violations, "the page's Content-Security-Policy refused something").toEqual([]);
});

test("sign in, pick a page, select text on the translated side, write a note, submit, and check what reached GitHub", async ({ page }) => {
  await page.goto("/");
  // The sign in screen says what is public and what is not.
  await expect(page.getByText("Your name is shown")).toBeVisible();
  await expect(page.getByText("Your email is not.")).toBeVisible();
  await page.getByRole("button", { name: "Start reviewing" }).click();
  await expect(page.getByRole("alert")).toContainText("name is required");
  await signIn(page);

  await pickPage(page, "es", "pric");
  await expect(page).toHaveURL(/\?lang=es&path=\/pricing\//);
  await pageShown(page);

  // Select "una vez" in the translated paragraph: the editor opens with it selected.
  await selectPhrase(page, "Español page", "Paga una vez, usa las funciones", "una vez");
  await expect(editor(page)).toBeVisible();
  await expect(editor(page)).toContainText("Pay once, use the paid features forever.");
  await expect(editor(page)).toContainText("Paga una vez, usa las funciones de pago para siempre.");
  await expect.poll(() => selectedText(page)).toBe("una vez");
  await page.keyboard.type("una sola vez");
  await expect(newTranslation(page)).toHaveText("Paga una sola vez, usa las funciones de pago para siempre.");
  await editor(page).getByLabel("Comment (optional)").fill('"una sola vez" reads more naturally.');
  await editor(page).getByRole("button", { name: "Save note" }).click();
  await expect(editor(page)).toBeHidden();
  await expect(queueToggle(page)).toContainText("1");

  // The queue shows page, English, current, new and the comment.
  await openQueue(page);
  const note = page.locator(".note").first();
  await expect(note).toContainText("/pricing/");
  await expect(note).toContainText("Pay once, use the paid features forever.");
  await expect(note).toContainText("Paga una vez, usa las funciones de pago para siempre.");
  await expect(note).toContainText("Paga una sola vez, usa las funciones de pago para siempre.");
  await expect(note).toContainText('"una sola vez" reads more naturally.');
  // Its paragraph is marked on both pages.
  await expect(translated(page).locator("p.rv-noted", { hasText: "Paga una vez" }).first()).toBeVisible();
  await expect(english(page).locator("p.rv-noted", { hasText: "Pay once" }).first()).toBeVisible();

  await submitAll(page);
  const dialog = page.getByRole("dialog", { name: "Submit notes" });
  await expect(dialog.getByRole("heading", { name: "Thank you!" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: /Translation notes \(es\): 1 note from María López/ })).toHaveAttribute("href", "https://github.com/beekeeper-studio/web/issues/4242");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(queueToggle(page)).toContainText("0");

  // What GitHub got.
  const { github } = await calls();
  expect(github).toHaveLength(1);
  const [issue] = github;
  expect(issue.repo).toBe("beekeeper-studio/web");
  expect(issue.authorization).toBe("Bearer gh-e2e-token");
  expect(issue.body.title).toBe("Translation notes (es): 1 note from María López");
  expect(issue.body.labels).toEqual(["translation", "lang:es"]);
  expect(issue.body.body).toContain("`Paga una sola vez, usa las funciones de pago para siempre.`");
  expect(JSON.stringify(issue)).not.toContain("maria@example.com");
  const [filed] = machine(issue.body.body).notes;
  expect(filed).toMatchObject({
    path: "/pricing/",
    key: "Pay once, use the paid features forever.",
    scope: null,
    source: "generated",
    current: "Paga una vez, usa las funciones de pago para siempre.",
    new: "Paga una sola vez, usa las funciones de pago para siempre.",
    comment: '"una sola vez" reads more naturally.',
    apply: {
      action: "add-explicit",
      file: "bin/translations/explicit/es.yml",
      entry: { path: "/pricing/", en: "Pay once, use the paid features forever.", es: "Paga una sola vez, usa las funciones de pago para siempre." },
    },
  });
  expect(filed.fingerprint).toMatch(/^[0-9a-f]{16,}$/);

  // The queue was cleared for good.
  await page.reload();
  await expect(page.locator(".queue-head .badge")).toHaveText("0");
});
