import { expect, type Frame, type Locator, type Page } from "@playwright/test";
import yaml from "js-yaml";

export const MOCK = "http://127.0.0.1:8799";

export interface Calls {
  worker: { path: string; authorization: string | null }[];
  github: { repo: string; authorization: string | null; body: { title: string; body: string; labels: string[] } }[];
  turnstile: { raw: string }[];
}

export async function control(body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${MOCK}/__control`, { method: "POST", body: JSON.stringify(body) });
  expect(response.ok).toBe(true);
}

export const calls = async (): Promise<Calls> => (await fetch(`${MOCK}/__calls`)).json() as Promise<Calls>;

// Cloudflare's script is not reached from the tests: a stand-in widget that
// hands out a token (and a new one after a reset, as the real one does).
const TURNSTILE = `
window.turnstile = {
  render(el, options) {
    window.__turnstile = { options, resets: 0 };
    el.setAttribute("data-widget", "stub");
    setTimeout(() => options.callback("mock-token"), 30);
    return "widget-1";
  },
  reset() {
    window.__turnstile.resets++;
    setTimeout(() => window.__turnstile.options.callback("mock-token"), 30);
  },
  remove() {},
};`;

export const randomIp = () => `198.51.${Math.floor(Math.random() * 250)}.${Math.floor(1 + Math.random() * 250)}`;

// Every test: a stand-in Turnstile, a clean mock, its own visitor address (the
// rate limit counts per address, and in production Cloudflare says whose it is;
// locally the header is believed), and a failure if the page's
// Content-Security-Policy refused something.
export async function prepare(page: Page, ip = randomIp()): Promise<string[]> {
  await control({ reset: true });
  await page.route("**/api/submit", (route) => route.continue({ headers: { ...route.request().headers(), "cf-connecting-ip": ip } }));
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) => route.fulfill({ contentType: "text/javascript", body: TURNSTILE }));
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/.test(message.text())) violations.push(message.text());
  });
  return violations;
}

export async function signIn(page: Page, name = "María López", email = "maria@example.com"): Promise<void> {
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Your email").fill(email);
  await page.getByRole("button", { name: "Start reviewing" }).click();
  await expect(page.getByLabel("Language")).toBeVisible();
}

export const english = (page: Page) => page.frameLocator('iframe[title="English page"]');
export const translated = (page: Page, label = "Español") => page.frameLocator(`iframe[title="${label} page"]`);

export async function frameOf(page: Page, title: string): Promise<Frame> {
  const handle = await page.locator(`iframe[title="${title}"]`).elementHandle();
  const frame = await handle!.contentFrame();
  if (!frame) throw new Error(`no frame ${title}`);
  return frame;
}

// Waits until a page is shown in both frames.
export async function pageShown(page: Page, text = "Paga una vez", label = "Español"): Promise<void> {
  await expect(translated(page, label).locator("p", { hasText: text }).first()).toBeVisible();
  await expect(english(page).locator("h1")).toBeVisible();
}

// Selects `phrase` in a page's paragraph, as a person does by dragging over it.
// (Playwright's mouse cannot drag across a sandboxed iframe, which has no
// scripts: it waits for the button to come up. So the selection is made in the
// page and the mouse-up the app listens for is sent. Double and triple clicks,
// which don't hold the button down, are real: see the tests that use them.)
export async function selectPhrase(page: Page, frameTitle: string, paragraph: string, phrase: string): Promise<void> {
  const frame = await frameOf(page, frameTitle);
  const found = await frame.evaluate(
    ({ paragraph, phrase }) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text;
        const owner = text.parentElement!.closest("[data-seg]");
        if (!owner || !owner.textContent!.includes(paragraph)) continue;
        const at = text.data.indexOf(phrase);
        if (at === -1) continue;
        const range = document.createRange();
        range.setStart(text, at);
        range.setEnd(text, at + phrase.length);
        const selection = document.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        return true;
      }
      return false;
    },
    { paragraph, phrase },
  );
  if (!found) throw new Error(`${JSON.stringify(phrase)} not found in ${JSON.stringify(paragraph)}`);
}

export const editor = (page: Page) => page.getByRole("dialog", { name: "Note" });
export const newTranslation = (page: Page): Locator => editor(page).getByRole("textbox", { name: "New translation" });
export const queueToggle = (page: Page) => page.locator(".queue-head .toggle");

export async function openQueue(page: Page): Promise<void> {
  if (!(await page.locator(".queue-body").isVisible())) await queueToggle(page).click();
}

// What is selected in the page (the editor's text box has the focus).
export const selectedText = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? "");

export async function pickPage(page: Page, language: string, query: string): Promise<void> {
  await page.getByLabel("Language").selectOption(language);
  const picker = page.getByRole("combobox", { name: "Page" });
  await picker.click();
  await picker.fill(query);
  await page.keyboard.press("Enter");
}

// The machine-readable block of a filed issue.
export function machine(body: string): any {
  const match = /(`{3,})yaml\n([\s\S]*?)\n\1\n/.exec(body);
  if (!match) throw new Error("no yaml block");
  return yaml.load(match[2]);
}

export async function submitAll(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Submit \d+ notes?$/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Submit notes" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Submit \d+ notes?$/ })).toBeEnabled();
  await dialog.getByRole("button", { name: /^Submit \d+ notes?$/ }).click();
}

// The notes in the queue, as the browser keeps them.
export const savedNotes = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("translation-review:notes") ?? "[]") as Record<string, any>[]);

// The translation page, as a reviewer opens it.
export async function openPricing(page: Page, language = "es", query = "pric"): Promise<void> {
  await page.goto("/");
  await signIn(page);
  await pickPage(page, language, query);
  await (language === "ja" ? pageShown(page, "一度のお支払い", "日本語") : pageShown(page));
}

export const chipLabels = (page: Page) => newTranslation(page).locator(".chip").allTextContents();
// The words in the text box, without the chips' labels or the guards.
export const typed = (page: Page) =>
  newTranslation(page).evaluate((el) => {
    let text = "";
    const walk = (node: Node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? "";
        else if (!(child as HTMLElement).classList.contains("chip")) walk(child);
      }
    };
    walk(el);
    return text.replace(/\u200b/g, "");
  });

// Opens the editor on a paragraph of the translated page by clicking it, types
// `text` over its whole translation (the click selects it all) and saves.
export async function rewrite(page: Page, where: Locator, text: string, comment?: string): Promise<void> {
  await where.click();
  await expect(editor(page)).toBeVisible();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text);
  if (comment) await editor(page).getByLabel("Comment (optional)").fill(comment);
  await editor(page).getByRole("button", { name: /Save note|Update note|Keep the English/ }).click();
  await expect(editor(page)).toBeHidden();
}

export const issueNotes = (call: Calls["github"][number]) => machine(call.body.body).notes as any[];

// Where a word is on the page, in the browser window's coordinates.
export async function wordPoint(page: Page, frameTitle: string, paragraph: string, word: string): Promise<{ x: number; y: number }> {
  const frame = await frameOf(page, frameTitle);
  const box = await frame.evaluate(
    ({ paragraph, word }) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text;
        if (!text.parentElement!.closest("[data-seg]")?.textContent?.includes(paragraph)) continue;
        const at = text.data.indexOf(word);
        if (at === -1) continue;
        const range = document.createRange();
        range.setStart(text, at);
        range.setEnd(text, at + word.length);
        const r = range.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      return null;
    },
    { paragraph, word },
  );
  if (!box) throw new Error(`${JSON.stringify(word)} not found in ${JSON.stringify(paragraph)}`);
  const frameBox = (await page.locator(`iframe[title="${frameTitle}"]`).boundingBox())!;
  return { x: frameBox.x + box.x, y: frameBox.y + box.y };
}
