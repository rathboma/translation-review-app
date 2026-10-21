import { test, expect } from "@playwright/test";
import { MOCK } from "./helpers.ts";

test("the app answers, and its Functions reach the mock site", async ({ page, request }) => {
  const config = await request.get("/api/config");
  expect(config.status()).toBe(200);
  expect(await config.json()).toEqual({ site: MOCK, turnstileSiteKey: "e2e-site-key" });
  const pricing = await request.get("/api/page?lang=es&path=/pricing/");
  expect(pricing.status()).toBe(200);
  expect((await pricing.json()).segments.length).toBeGreaterThan(50);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Review the translations" })).toBeVisible();
});
