import { test, expect } from "@playwright/test";

test("the app answers, and its Functions reach the mock Worker", async ({ page, request }) => {
  const manifest = await request.get("/api/manifest");
  expect(manifest.status()).toBe(200);
  const body = await manifest.json();
  expect(Object.keys(body.languages)).toEqual(["es", "ja"]);
  expect(body.turnstileSiteKey).toBe("e2e-site-key");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Review the translations" })).toBeVisible();
});
