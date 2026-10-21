// @vitest-environment jsdom
import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

const KEY = "translation-review:";
const good = { id: "n1", lang: "es", path: "/pricing/", key: "Pay once.", scope: null, source: "generated", kind: "html", where: "p", current: "Paga una vez.", new: "Paga una sola vez." };

// The store reads localStorage when it is first imported.
async function start(saved: Record<string, unknown>) {
  localStorage.clear();
  for (const [key, value] of Object.entries(saved)) localStorage.setItem(KEY + key, typeof value === "string" ? value : JSON.stringify(value));
  vi.resetModules();
  return (await import("../../src/lib/state.ts")).state;
}

beforeEach(() => localStorage.clear());

test("saved notes and reviewer come back", async () => {
  const state = await start({ reviewer: { name: "María", email: "m@example.com" }, notes: [good] });
  assert.deepEqual(state.reviewer, { name: "María", email: "m@example.com" });
  assert.deepEqual(state.notes, [good]);
});

test("corrupt saved data is dropped, not a reason for the app not to start", async () => {
  for (const notes of ["{not json", { not: "a list" }, "null", 7, [null, 5, "x", {}, { ...good, source: "magic" }, { ...good, new: undefined }]]) {
    const state = await start({ notes });
    assert.deepEqual(state.notes, [], JSON.stringify(notes));
  }
  assert.equal((await start({ reviewer: "{nope" })).reviewer, null);
  assert.equal((await start({ reviewer: { name: "", email: "x" } })).reviewer, null);
});

test("a good note survives the company of bad ones", async () => {
  const state = await start({ notes: [{ junk: true }, good, 12, { ...good, id: "has spaces" }] });
  assert.deepEqual(state.notes.map((n) => n.id), ["n1"]);
});

test("a plus sign in a page path survives the address", async () => {
  await start({});
  const { pathQuery } = await import("../../src/lib/state.ts");
  for (const path of ["/blog/c++-guide/", "/a b/", "/x?y=1&z#top", "/plain/"]) {
    const query = new URLSearchParams(pathQuery("es", path));
    assert.equal(query.get("path"), path, path);
    assert.equal(query.get("lang"), "es");
  }
});

test("a language that is a property of every object is not a place to start", async () => {
  const state = await start({ last: { lang: "constructor", path: "/" } });
  state.manifest = { site: "x", languages: { es: { lang: "es-MX", label: "Español" } }, pages: ["/"], glossary: {}, turnstileSiteKey: "" };
  const { startingPlace } = await import("../../src/lib/state.ts");
  assert.deepEqual(startingPlace("?lang=toString&path=/"), { lang: "", path: "" });
  assert.deepEqual(startingPlace("?lang=es&path=/"), { lang: "es", path: "/" });
});
