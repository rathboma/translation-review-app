import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// Unit tests: node by default; test/dom/*.test.ts run in jsdom (selection
// mapping needs a DOM; each says so with a `@vitest-environment` docblock). The
// browser end to end tests are in e2e/ (Playwright).
export default defineConfig({
  plugins: [vue()],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
