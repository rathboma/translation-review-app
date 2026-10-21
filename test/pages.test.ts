import { beforeEach, afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { configHandler, pageHandler } from "../server/pages.ts";
import { resolveSite } from "../server/site.ts";
import { env, PRICING_EN, PRICING_ES, SITE, world, type World } from "./server-helpers.ts";

let w: World;
beforeEach(() => {
  w = world();
});
afterEach(() => vi.unstubAllGlobals());

const get = (params: string) => new Request(`https://translate.test/api/page?${params}`);
const json = async (r: Response) => (await r.json()) as any;

test("the config is the default site and the public Turnstile key, nothing else", async () => {
  const response = configHandler(env({ TURNSTILE_SITE_KEY: "site-key" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { site: SITE, turnstileSiteKey: "site-key" });
});

test("a page comes back with both sides marked up, made safe to show, and its segments", async () => {
  const response = await pageHandler(get("lang=es&path=/pricing/"), env());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await json(response);
  assert.deepEqual([body.lang, body.path, body.site], ["es", "/pricing/", SITE]);
  for (const side of ["english", "translated"]) {
    assert.ok(body[side].includes(`<base href="${SITE}/">`), `${side} has a base`);
    assert.ok(!/<script|onclick|onload/.test(body[side]), `${side} has no scripts`);
    assert.ok(body[side].includes('data-seg="s2"'), `${side} marks its segments`);
  }
  assert.ok(body.translated.includes("Paga una vez"));
  const pay = body.segments.find((s: any) => s.key === "Pay once, use the paid features forever.");
  assert.equal(pay.translation, "Paga una vez, usa las funciones de pago para siempre.");
  assert.equal(pay.kind, "html");
});

test("the two pages are the English one and the language's, and nothing is sent with the requests", async () => {
  await pageHandler(get("lang=pt-br&path=/pricing/"), env());
  w.site.pages["/pt-br/pricing/"] = PRICING_ES;
  await pageHandler(get("lang=pt-br&path=/pricing/"), env());
  const urls = w.site.calls.map((c) => c.url.href);
  assert.ok(urls.includes(`${SITE}/pricing/`) && urls.includes(`${SITE}/pt-br/pricing/`), urls.join(" "));
  for (const call of w.site.calls) {
    assert.equal(call.headers.get("authorization"), null);
    assert.equal(call.headers.get("cookie"), null);
  }
});

test("the site can be another one, which is where the pages and their base come from", async () => {
  const response = await pageHandler(get("lang=es&path=/pricing/&site=https://pr-1-beekeeper-web.example.workers.dev/some/page"), env());
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.site, "https://pr-1-beekeeper-web.example.workers.dev");
  assert.ok(body.english.includes('<base href="https://pr-1-beekeeper-web.example.workers.dev/">'));
  assert.ok(w.site.calls.every((c) => c.url.origin === "https://pr-1-beekeeper-web.example.workers.dev"));
});

test("a site that is not a web address is refused before anything is fetched", async () => {
  for (const site of ["javascript:alert(1)", "ftp://example.com", "file:///etc/passwd", "not a url"]) {
    const response = await pageHandler(get(`lang=es&path=/pricing/&site=${encodeURIComponent(site)}`), env());
    assert.equal(response.status, 400, site);
    assert.equal((await json(response)).code, "bad-site");
  }
  assert.equal(w.site.calls.length, 0);
});

test("resolveSite: the default when none is asked for, else the origin", () => {
  assert.equal(resolveSite(env(), null), SITE);
  assert.equal(resolveSite(env(), "  "), SITE);
  assert.equal(resolveSite(env({ TRANSLATIONS_URL: "https://www.beekeeperstudio.io/" }), undefined), "https://www.beekeeperstudio.io");
  assert.equal(resolveSite(env(), "https://example.com:8443/x?y#z"), "https://example.com:8443");
  assert.equal(resolveSite(env(), "http://127.0.0.1:8788"), "http://127.0.0.1:8788");
  assert.equal(resolveSite(env(), "example.com"), null);
});

test("pages and languages that are not there are told apart", async () => {
  const unknownLang = await pageHandler(get("lang=fr&path=/pricing/"), env());
  assert.equal(unknownLang.status, 404);
  assert.equal((await json(unknownLang)).code, "unknown-language");
  for (const lang of ["constructor", "toString", "__proto__"]) assert.equal((await pageHandler(get(`lang=${lang}&path=/pricing/`), env())).status, 404, lang);
  const missing = await pageHandler(get("lang=es&path=/nope/"), env());
  assert.equal(missing.status, 404);
  assert.equal((await json(missing)).code, "not-found");
});

test("a page with no copy, which the site answers with its English, is not shown twice", async () => {
  w.site.pages["/es/pricing/"] = { redirectedTo: "/pricing/", html: PRICING_EN };
  const response = await pageHandler(get("lang=es&path=/pricing/"), env());
  assert.equal(response.status, 404);
  const body = await json(response);
  assert.equal(body.code, "not-translated");
  assert.match(body.error, /no Español copy of \/pricing\//);
});

test("a path is a path of the site, whatever it looks like", async () => {
  for (const path of ["pricing", "https://evil.example/", "/a b", "/x#y", ""]) {
    const response = await pageHandler(get(`lang=es&path=${encodeURIComponent(path)}`), env());
    assert.equal(response.status, 400, path);
    assert.equal((await json(response)).code, "bad-path");
  }
  assert.equal(w.site.calls.length, 0);
  // A path with slashes in front of it is still a path on the site.
  await pageHandler(get("lang=es&path=//evil.example/x"), env());
  assert.ok(w.site.calls.length > 0 && w.site.calls.every((c) => c.url.origin === SITE));
});

test("a site that is down, or answers with something else than a page, is an error with a reason", async () => {
  w.site.down = true;
  const down = await pageHandler(get("lang=es&path=/pricing/"), env());
  assert.equal(down.status, 502);
  assert.match((await json(down)).error, /Couldn't reach/);
  w.site.down = false;
  w.site.pages["/pricing/"] = { status: 500 };
  const broken = await pageHandler(get("lang=es&path=/pricing/"), env());
  assert.equal(broken.status, 502);
  assert.match((await json(broken)).error, /answered 500/);
});
