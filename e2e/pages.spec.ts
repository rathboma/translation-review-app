import { test, expect } from "@playwright/test";
import { english, frameOf, openPricing, pageShown, prepare, signIn, translated } from "./helpers.ts";

let violations: string[];
test.beforeEach(async ({ page }) => {
  violations = await prepare(page);
});
test.afterEach(() => expect(violations).toEqual([]));

test("the pages are shown without their scripts, with their styles and images from the site", async ({ page }) => {
  await openPricing(page);
  for (const title of ["English page", "Español page"]) {
    const frame = await frameOf(page, title);
    const facts = await frame.evaluate(() => ({
      scriptRan: document.documentElement.getAttribute("data-script-ran"),
      onloadRan: document.body.getAttribute("data-onload-ran"),
      scripts: document.querySelectorAll("script").length,
      noscripts: document.querySelectorAll("noscript").length,
      handlers: Array.from(document.querySelectorAll("*")).filter((el) => el.getAttributeNames().some((n) => n.startsWith("on"))).length,
      base: document.querySelector("base")?.getAttribute("href"),
      robots: document.querySelectorAll('meta[name="robots"]').length,
      preloads: document.querySelectorAll('link[rel="preload"]').length,
      h1Color: getComputedStyle(document.querySelector("h1")!).color,
      imageLoaded: (document.querySelector("img") as HTMLImageElement).naturalWidth,
      stylesheet: document.querySelector('link[rel="stylesheet"]')?.getAttribute("integrity"),
    }));
    expect(facts, title).toMatchObject({
      scriptRan: null,
      onloadRan: null,
      scripts: 0,
      noscripts: 0,
      handlers: 0,
      base: "http://127.0.0.1:8799/",
      robots: 0,
      preloads: 0,
      h1Color: "rgb(1, 2, 3)", // main.css, from the site through the <base>
      imageLoaded: 1, // /img/logo.png, from the site
      stylesheet: null,
    });
  }
});

test("the pages are sandboxed: no scripts, and a link goes nowhere", async ({ page }) => {
  await openPricing(page);
  await expect(page.locator('iframe[title="English page"]')).toHaveAttribute("sandbox", "allow-same-origin");
  await expect(page.locator('iframe[title="Español page"]')).toHaveAttribute("sandbox", "allow-same-origin");
  const before = page.url();
  await translated(page).getByRole("link", { name: "documentación" }).click();
  await page.waitForTimeout(300);
  expect(page.url()).toBe(before);
  await expect(translated(page).locator("h1")).toHaveText("Precios");
});

test("a deep link opens that page, and the last choice is remembered", async ({ page }) => {
  await page.goto("/?lang=ja&path=/pricing/");
  await signIn(page);
  await expect(translated(page, "日本語").locator("p", { hasText: "一度のお支払い" }).first()).toBeVisible();
  await expect(page.getByLabel("Language")).toHaveValue("ja");
  await expect(page.getByRole("combobox", { name: "Page" })).toHaveValue("/pricing/");

  await page.goto("/");
  await expect(translated(page, "日本語").locator("p", { hasText: "一度のお支払い" }).first()).toBeVisible();
  await expect(page).toHaveURL(/\?lang=ja&path=\/pricing\//);
});

test("a link to a page that isn't there falls back to picking one", async ({ page }) => {
  await page.goto("/?lang=es&path=/nope/");
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Pick a language and a page" })).toBeVisible();
  await expect(page.getByLabel("Language")).toHaveValue("es");
});

test("a page with no copy yet says so, in a way that isn't an error", async ({ page }) => {
  await page.goto("/?lang=es&path=/get");
  await signIn(page);
  await expect(page.getByText("This page isn't translated yet.")).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  // And the next page can still be opened.
  const picker = page.getByRole("combobox", { name: "Page" });
  await picker.click();
  await picker.fill("pric");
  await page.keyboard.press("Enter");
  await pageShown(page);
});

test("the page picker searches, and says when nothing matches", async ({ page }) => {
  await page.goto("/");
  await signIn(page);
  await page.getByLabel("Language").selectOption("es");
  const picker = page.getByRole("combobox", { name: "Page" });
  await picker.click();
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options).toHaveText(["/", "/pricing/", "/get"]);
  await picker.fill("ge");
  await expect(options).toHaveText(["/get"]);
  await picker.fill("zzz");
  await expect(page.getByText("No page matches")).toBeVisible();
  await picker.fill("");
  await options.getByText("/", { exact: true }).click();
  await expect(translated(page).locator("h1")).toHaveText("El editor SQL que vas a querer");
});

test("hovering a segment lights it and its counterpart on the other page", async ({ page }) => {
  await openPricing(page);
  await english(page).locator("p", { hasText: "Only $99" }).hover();
  for (const title of ["English page", "Español page"]) {
    const frame = await frameOf(page, title);
    await expect.poll(() => frame.evaluate(() => Array.from(document.querySelectorAll(".rv-hover")).map((el) => el.textContent))).toHaveLength(1);
  }
  await translated(page).locator("h1").hover();
  const en = await frameOf(page, "English page");
  await expect.poll(() => en.evaluate(() => Array.from(document.querySelectorAll(".rv-hover")).map((el) => el.tagName))).toEqual(["H1"]);
  // Off the segments, nothing is lit.
  await page.mouse.move(5, 5);
  await expect.poll(() => en.evaluate(() => document.querySelectorAll(".rv-hover").length)).toBe(0);
});

test("the two pages scroll together, by segment, in both directions", async ({ page }) => {
  await openPricing(page);
  const en = await frameOf(page, "English page");
  const es = await frameOf(page, "Español page");
  const top = (frame: typeof en) =>
    frame.evaluate(() => {
      const first = Array.from(document.querySelectorAll("[data-seg]")).find((el) => el.getBoundingClientRect().bottom > 4)!;
      return { id: first.getAttribute("data-seg"), y: Math.round(first.getBoundingClientRect().top), scroll: document.scrollingElement!.scrollTop };
    });
  await en.evaluate(() => window.scrollTo(0, 700));
  await expect.poll(async () => (await top(es)).scroll).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  const a = await top(en);
  const b = await top(es);
  expect(b.id).toBe(a.id);
  expect(Math.abs(b.y - a.y)).toBeLessThan(4);

  await es.evaluate(() => window.scrollTo(0, 100));
  await expect.poll(async () => (await top(en)).scroll).toBeLessThan(a.scroll);
  await page.waitForTimeout(250);
  const c = await top(es);
  const d = await top(en);
  expect(d.id).toBe(c.id);
  expect(Math.abs(d.y - c.y)).toBeLessThan(4);
});

test("below 900 pixels wide there is only a message", async ({ page }) => {
  await openPricing(page);
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(page.getByRole("heading", { name: "Please use a wider screen" })).toBeVisible();
  await expect(page.locator(".app")).toBeHidden();
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect(page.getByRole("heading", { name: "Please use a wider screen" })).toBeHidden();
  await expect(page.locator(".app")).toBeVisible();
});
