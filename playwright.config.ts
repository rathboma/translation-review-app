import { defineConfig } from "@playwright/test";

// The browser tests: the built app on `wrangler pages dev` (the real Functions,
// with a local KV) against mocks of the translation Worker, GitHub and
// Turnstile (e2e/mock-services.ts). Chromium is the one the sandbox ships.
const MOCK = 8799;
const APP = 8788;
const mock = `http://127.0.0.1:${MOCK}`;

const bindings = [
  `TRANSLATIONS_URL=${mock}`,
  "TRANSLATIONS_TOKEN=e2e-token",
  `GITHUB_API_URL=${mock}/github`,
  "GITHUB_REPO=beekeeper-studio/web",
  "GITHUB_TOKEN=gh-e2e-token",
  `TURNSTILE_VERIFY_URL=${mock}/turnstile/verify`,
  "TURNSTILE_SECRET=ts-e2e-secret",
  "TURNSTILE_SITE_KEY=e2e-site-key",
  "APP_URL=https://translate.beekeeperstudio.io",
].map((b) => `--binding ${b}`);

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${APP}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node e2e/mock-services.ts",
      url: `${mock}/__health`,
      env: { MOCK_PORT: String(MOCK) },
      reuseExistingServer: false,
    },
    {
      // A fresh KV every run: the rate limit counts per address. The app's own
      // Content-Security-Policy, with the mock (http, not https) let in where the
      // site's pages would load from: base-uri, styles, images and fonts.
      command: `rm -rf .e2e-state && vite build && sed -i 's#https:;#https: ${mock};#g' dist/_headers && wrangler pages dev dist --port ${APP} --ip 127.0.0.1 --persist-to .e2e-state --kv REVIEWERS ${bindings.join(" ")}`,
      url: `http://127.0.0.1:${APP}/`,
      env: { WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" },
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
