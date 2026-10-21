import { beforeEach, afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { manifestHandler, pageHandler } from "../server/pages.ts";
import { annotated, env, world, WORKER, type World } from "./server-helpers.ts";

let w: World;
beforeEach(() => {
  w = world({ "es /pricing/": annotated("es", "/pricing/") });
});
afterEach(() => vi.unstubAllGlobals());

const get = (params: string) => new Request(`https://translate.test/api/page?${params}`);
const json = async (r: Response) => (await r.json()) as any;

test("the manifest is trimmed to what the frontend needs, plus the public Turnstile key", async () => {
  const response = await manifestHandler(env({ TURNSTILE_SITE_KEY: "site-key" }));
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.deepEqual(Object.keys(body).sort(), ["glossary", "languages", "pages", "site", "turnstileSiteKey"]);
  assert.deepEqual(body.languages.es, { lang: "es-MX", label: "Español" });
  assert.deepEqual(body.pages, ["/", "/pricing/", "/get"]);
  assert.equal(body.turnstileSiteKey, "site-key");
  assert.ok(!JSON.stringify(body).includes("worker-token"), "the token stays here");
  assert.ok(!("common" in body) && !("explicit" in body));
});

test("a page comes back with both sides made safe to show", async () => {
  const response = await pageHandler(get("lang=es&path=/pricing/"), env());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await json(response);
  assert.equal(body.lang, "es");
  assert.equal(body.fingerprint, "fp-es-pricing");
  assert.equal(body.segments.length, 1);
  for (const side of ["english", "translated"]) {
    assert.ok(body[side].includes(`<base href="${WORKER}/">`), `${side} has a base`);
    assert.ok(!/<script|onclick/.test(body[side]), `${side} has no scripts`);
    assert.ok(body[side].includes('data-seg="s1"'));
  }
  assert.ok(body.translated.includes("Paga una vez"));
});

test("unknown languages and pages, and pages with no copy yet, are told apart", async () => {
  const unknownLang = await pageHandler(get("lang=fr&path=/pricing/"), env());
  assert.equal(unknownLang.status, 404);
  assert.equal((await json(unknownLang)).code, "unknown-language");
  const unknownPage = await pageHandler(get("lang=es&path=/nope/"), env());
  assert.equal((await json(unknownPage)).code, "unknown-page");
  const notYet = await pageHandler(get("lang=ja&path=/get"), env());
  assert.equal(notYet.status, 404);
  const body = await json(notYet);
  assert.equal(body.code, "not-translated");
  assert.match(body.error, /not translated yet/);
});

test("a path is never fetched by the Function, only asked of the Worker", async () => {
  await pageHandler(get("lang=es&path=https://evil.example/"), env());
  assert.ok(w.worker.calls.every((c) => c.url.origin === WORKER));
  assert.ok(!w.worker.calls.some((c) => c.url.pathname.endsWith("annotated")), "an unlisted path never reaches the Worker");
});

test("the manifest and page are a 502 while the Worker is down", async () => {
  w.worker.down = true;
  const response = await pageHandler(get("lang=es&path=/pricing/"), env());
  assert.equal(response.status, 502);
  assert.match((await json(response)).error, /Couldn't reach the translations/);
});

test("a wrong token is the Worker's 401, reported as a 502 without leaking it", async () => {
  const response = await manifestHandler(env({ TRANSLATIONS_TOKEN: "wrong" }));
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.match(text, /unauthorized/);
  assert.ok(!text.includes("wrong"));
});
