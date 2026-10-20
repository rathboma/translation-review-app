import { beforeEach, afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { submitHandler } from "../server/submit.ts";
import { MAX_PER_HOUR } from "../server/ratelimit.ts";
import { annotated, env, post, segment, submission, world, type World } from "./server-helpers.ts";
import { machineNotes, note } from "./helpers.ts";

const NOW = new Date("2026-10-21T10:14:00Z");
const send = (e: ReturnType<typeof env>, body: unknown, headers?: Record<string, string>) => submitHandler(post(body, headers), e, { now: () => NOW });

let w: World;
beforeEach(() => {
  w = world({
    "es /pricing/": annotated("es", "/pricing/", [
      segment(),
      segment({ id: "s2", key: "Blog", scope: "footer", source: "common", where: 'a, under "Links"', translation: "Blog" }),
      segment({ id: "s3", key: "Get <a href=\"/get\">Beekeeper Studio</a> now", source: "explicit", entryPath: "/pricing/**", translation: "Obtén <a href=\"/get\">Beekeeper Studio</a> ya" }),
    ]),
    "es /": annotated("es", "/", [segment({ id: "s1", key: "Welcome", translation: "Bienvenido", where: "h1" })]),
    "ja /pricing/": annotated("ja", "/pricing/", [segment({ id: "s1", key: "Pay once.", translation: "一度だけ支払う。" })]),
  });
});
afterEach(() => vi.unstubAllGlobals());

const json = async (response: Response) => (await response.json()) as any;

test("files one issue per language, with its labels, and answers with the links", async () => {
  const e = env();
  const response = await send(e, submission([
    note({ id: "a" }),
    note({ id: "b", lang: "ja", key: "Pay once.", current: "一度だけ支払う。", new: "1回だけお支払い。" }),
    note({ id: "c", path: "/", key: "Welcome", where: "h1", current: "Bienvenido", new: "Te damos la bienvenida" }),
  ]));
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.ok, true);
  assert.deepEqual(body.issues.map((i: any) => [i.lang, i.number]), [["es", 100], ["ja", 101]]);
  assert.equal(body.issues[0].url, "https://github.com/beekeeper-studio/web/issues/100");

  assert.equal(w.github.calls.length, 2);
  const [es, ja] = w.github.calls;
  assert.equal(es.url, "/repos/beekeeper-studio/web/issues");
  assert.equal(es.authorization, "Bearer gh-token");
  assert.equal(es.body.title, "Translation notes (es): 2 notes from María López");
  assert.deepEqual(es.body.labels, ["translation", "lang:es"]);
  assert.deepEqual(ja.body.labels, ["translation", "lang:ja"]);
  assert.equal(machineNotes(es.body.body).notes.length, 2);
  assert.equal(machineNotes(ja.body.body).notes[0].apply.entry.ja, "1回だけお支払い。");
  assert.match(es.body.body, /Submitted with translate\.beekeeperstudio\.io/);
});

test("the email is stored by issue number and never reaches GitHub", async () => {
  const e = env();
  await send(e, submission([note({ id: "a" }), note({ id: "b", lang: "ja", key: "Pay once.", current: "一度だけ支払う。", new: "1回だけお支払い。" })]));
  for (const call of w.github.calls) {
    assert.ok(!JSON.stringify(call).includes("maria@example.com"), "the email is in a GitHub request");
    assert.ok(!JSON.stringify(call).includes("example.com"));
  }
  const record = JSON.parse(e.REVIEWERS.data.get("issue:100")!);
  assert.deepEqual(record, { name: "María López", email: "maria@example.com", issues: [100, 101], at: NOW.toISOString() });
  assert.deepEqual(JSON.parse(e.REVIEWERS.data.get("issue:101")!), record);
});

test("the Worker is called with its token, the human check is verified with the secret and the visitor's address", async () => {
  await send(env(), submission([note()]));
  assert.ok(w.worker.calls.length >= 2);
  assert.ok(w.worker.calls.every((c) => c.authorization === "Bearer worker-token"));
  assert.deepEqual(w.turnstile.calls, [{ secret: "ts-secret", response: "token-1", remoteip: "203.0.113.7" }]);
});

test("a failed human check files nothing and checks nothing else", async () => {
  w.turnstile.pass = false;
  const response = await send(env(), submission([note()]));
  assert.equal(response.status, 403);
  assert.equal(w.github.calls.length, 0);
  assert.equal(w.worker.calls.length, 0);
});

test("malformed submissions are refused with a reason", async () => {
  assert.equal((await send(env(), "{nope")).status, 400);
  assert.equal((await send(env(), submission([note()], { turnstileToken: "" }))).status, 400);
  const empty = await send(env(), submission([]));
  assert.equal(empty.status, 422);
  assert.match((await json(empty)).error, /no notes/);
  const tooLarge = await send(env(), "x".repeat(2_000_001));
  assert.equal(tooLarge.status, 413);
  assert.equal(w.github.calls.length, 0);
});

test("at most 100 notes", async () => {
  const many = Array.from({ length: 101 }, (_, i) => note({ id: `n${i}`, key: `Key ${i}` }));
  const response = await send(env(), submission(many));
  assert.equal(response.status, 422);
  assert.match((await json(response)).error, /at most 100/);
  assert.equal(w.github.calls.length, 0);
});

test("a language or page that isn't translated is refused, by note", async () => {
  const response = await send(env(), submission([note({ id: "a", lang: "fr" }), note({ id: "b", path: "/nope/" }), note({ id: "c", key: "Ok" })]));
  assert.equal(response.status, 422);
  const body = await json(response);
  assert.deepEqual(body.notes.map((n: any) => n.id), ["a", "b"]);
  assert.match(body.notes[0].errors[0], /fr is not a translated language/);
  assert.match(body.notes[1].errors[0], /not one of the translated pages/);
});

test("a broken translation is refused with the reason next to its note, and nothing is filed", async () => {
  const lostLink = note({ id: "link", key: "Get <a href=\"/get\">Beekeeper Studio</a> now", source: "explicit", current: "Obtén <a href=\"/get\">Beekeeper Studio</a> ya", new: "Obtén Beekeeper Studio ya" });
  const price = note({ id: "price", key: "Only $99 a year", current: "Solo $99 al año", new: "Solo $89 al año" });
  const fine = note({ id: "fine" });
  const response = await send(env(), submission([lostLink, price, fine]));
  assert.equal(response.status, 422);
  const body = await json(response);
  assert.equal(body.ok, false);
  const byId = Object.fromEntries(body.notes.map((n: any) => [n.id, n]));
  assert.match(byId.link.errors.join(" "), /markup differs/);
  assert.match(byId.price.errors.join(" "), /numbers missing from the translation: 99/);
  assert.equal(byId.fine, undefined);
  assert.equal(w.github.calls.length, 0, "nothing is filed while any note has an error");
  assert.equal(w.worker.calls.filter((c) => c.url.pathname.endsWith("annotated")).length, 0, "no page was fetched either");
});

test("the Worker's glossary and keep list are enforced", async () => {
  const response = await send(env(), submission([note({ key: "Beekeeper Studio is great", current: "Beekeeper Studio es genial", new: "El estudio de abejas es genial" })]));
  assert.equal(response.status, 422);
  assert.match((await json(response)).notes[0].errors[0], /"Beekeeper Studio" must stay as it is/);
});

test("lint warnings go into the issue, and don't stop it", async () => {
  const response = await send(env(), submission([note({ id: "w", key: "Download", scope: null, current: "Descargar", new: "Bajar", where: "a" })]));
  const body = await json(response);
  assert.equal(body.ok, true, JSON.stringify(body));
  const issue = w.github.calls[0].body.body;
  assert.match(issue, /Lint warnings: `glossary: "Download" is usually "Descarga"`/);
  assert.deepEqual(machineNotes(issue).notes[0].warnings, ['glossary: "Download" is usually "Descarga"']);
});

test("a note whose English has gone from the page is filed as stale", async () => {
  const response = await send(env(), submission([note({ id: "a" }), note({ id: "gone", key: "Pay once, use the paid features for one year.", current: "Paga una vez.", new: "Paga una sola vez." })]));
  assert.equal((await json(response)).ok, true);
  const [first, second] = machineNotes(w.github.calls[0].body.body).notes;
  assert.equal(first.stale, undefined);
  assert.equal(second.stale, true);
  assert.match(w.github.calls[0].body.body, /\*\*Stale:\*\* this English text is no longer on the page/);
});

test("a page that has lost its copy makes its notes stale too", async () => {
  delete w.worker.pages["es /"];
  const response = await send(env(), submission([note({ id: "a", path: "/", key: "Welcome", current: "Bienvenido", new: "Hola" })]));
  assert.equal((await json(response)).ok, true);
  const [only] = machineNotes(w.github.calls[0].body.body).notes;
  assert.equal(only.stale, true);
  assert.equal(only.fingerprint, null);
});

test("how a note is applied comes from where the string's translation is now, not from what the browser said", async () => {
  // The browser thought it was a generated translation: the page has it from an explicit glob entry now.
  const response = await send(env(), submission([
    note({ id: "a", key: "Get <a href=\"/get\">Beekeeper Studio</a> now", source: "generated", current: "Obtén <a href=\"/get\">Beekeeper Studio</a> ya", new: "Consigue <a href=\"/get\">Beekeeper Studio</a> ya" }),
    note({ id: "b", key: "Blog", scope: "footer", source: "generated", path: "/pricing/", current: "Blog", new: "Blog técnico" }),
  ]));
  assert.equal((await json(response)).ok, true);
  const [a, b] = machineNotes(w.github.calls[0].body.body).notes;
  assert.equal(a.source, "explicit");
  assert.deepEqual(a.apply, { action: "replace-explicit", file: "bin/translations/explicit/es.yml", entry: { path: "/pricing/**", en: "Get <a href=\"/get\">Beekeeper Studio</a> now", es: "Consigue <a href=\"/get\">Beekeeper Studio</a> ya" } });
  assert.deepEqual(b.apply, { action: "set-common", file: "bin/translations/common/es.json", set: ["footer", "Blog", "Blog técnico"] });
  assert.equal(b.fingerprint, "fp-es-pricing");
});

test("a translation that changed since the note was written is flagged", async () => {
  const response = await send(env(), submission([note({ id: "a", current: "Paga una vez (la de ayer).", new: "Paga una sola vez." })]));
  assert.equal((await json(response)).ok, true);
  const [only] = machineNotes(w.github.calls[0].body.body).notes;
  assert.equal(only.current_now, "Paga una vez, usa las funciones de pago para siempre.");
  assert.match(w.github.calls[0].body.body, /Heads up: the current translation has changed/);
});

test("five submissions an hour per address, the sixth is told when to come back", async () => {
  const e = env();
  for (let i = 0; i < MAX_PER_HOUR; i++) {
    const ok = await send(e, submission([note({ id: `n${i}` })], { turnstileToken: `t${i}` }));
    assert.equal(ok.status, 200, `submission ${i + 1}`);
  }
  const limited = await send(e, submission([note()], { turnstileToken: "t-more" }));
  assert.equal(limited.status, 429);
  assert.equal(Number(limited.headers.get("retry-after")), 3600);
  assert.match((await json(limited)).error, /Try again in 60 minutes/);
  assert.equal(w.turnstile.calls.length, MAX_PER_HOUR, "a limited visitor doesn't use up a human check");
  // Another address is another visitor, and an hour later the window has passed.
  assert.equal((await send(e, submission([note()]), { "cf-connecting-ip": "198.51.100.9" })).status, 200);
  const later = await submitHandler(post(submission([note()])), e, { now: () => new Date(NOW.getTime() + 3_601_000) });
  assert.equal(later.status, 200);
});

test("the address is stored hashed", async () => {
  const e = env();
  await send(e, submission([note()]));
  const keys = [...e.REVIEWERS.data.keys()].filter((k) => k.startsWith("rate:"));
  assert.equal(keys.length, 1);
  assert.ok(!keys[0].includes("203.0.113.7"));
});

test("refused submissions don't use up the allowance, so fixing a translation is free", async () => {
  const e = env();
  for (let i = 0; i < MAX_PER_HOUR + 3; i++) {
    const changedPrice = note({ id: "a", key: "Only $99 a year", current: "Solo $99 al año", new: "Solo $89 al año" });
    const refused = await send(e, submission([changedPrice], { turnstileToken: `t${i}` }));
    assert.equal(refused.status, 422, `attempt ${i + 1}`);
  }
  assert.equal((await send(e, submission([note()]))).status, 200);
});

test("when the translation service is down nothing is filed, and the allowance is untouched", async () => {
  w.worker.down = true;
  const e = env();
  const response = await send(e, submission([note()]));
  assert.equal(response.status, 502);
  assert.match((await json(response)).error, /still in your queue/);
  assert.equal(w.github.calls.length, 0);
  assert.ok(![...e.REVIEWERS.data.keys()].some((k) => k.startsWith("rate:")));
});

test("when GitHub fails part way, the response says which notes were filed", async () => {
  w.github.fail = (call) => call === 2;
  const e = env();
  const response = await send(e, submission([
    note({ id: "a" }),
    note({ id: "b", lang: "ja", key: "Pay once.", current: "一度だけ支払う。", new: "1回だけお支払い。" }),
  ]));
  assert.equal(response.status, 502);
  const body = await json(response);
  assert.equal(body.ok, false);
  assert.deepEqual(body.filed, ["a"]);
  assert.deepEqual(body.issues.map((i: any) => i.number), [100]);
  assert.match(body.error, /One issue was filed/);
  assert.ok(e.REVIEWERS.data.has("issue:100"), "the filed issue's reviewer is kept");
});

test("GitHub failing on the first issue leaves everything in the queue", async () => {
  w.github.fail = () => true;
  const response = await send(env(), submission([note()]));
  assert.equal(response.status, 502);
  const body = await json(response);
  assert.deepEqual(body.filed, []);
  assert.match(body.error, /Your notes are still in your queue/);
  assert.ok(!JSON.stringify(body).includes("gh-token"));
});

test("a long submission is split into several issues of one language", async () => {
  const long = "palabra ".repeat(500).trim();
  const segments = Array.from({ length: 30 }, (_, i) => segment({ id: `s${i}`, key: `Key ${i}`, translation: long }));
  w.worker.pages["es /pricing/"] = annotated("es", "/pricing/", segments);
  const notes = segments.map((s, i) => note({ id: `n${i}`, key: s.key, current: long, new: `${long} ${i}` }));
  const response = await send(env(), submission(notes));
  const body = await json(response);
  assert.equal(body.ok, true, JSON.stringify(body));
  assert.ok(body.issues.length > 1);
  assert.deepEqual(w.github.calls.map((c) => c.body.title.match(/\(part (\d+) of (\d+)\)$/)?.slice(1).join("/")), body.issues.map((_: unknown, i: number) => `${i + 1}/${body.issues.length}`));
  for (const call of w.github.calls) assert.ok(call.body.body.length <= 60_000);
  const filed = w.github.calls.flatMap((c) => machineNotes(c.body.body).notes.map((n: any) => n.key));
  assert.deepEqual(filed, notes.map((n) => n.key));
});

test("a note too big to file is refused by id", async () => {
  const text = "\\".repeat(4999);
  w.worker.pages["es /pricing/"] = annotated("es", "/pricing/", [segment({ key: text, translation: text })]);
  const big = note({ id: "big", key: text, current: text, new: `${text}"`, comment: text, where: text });
  const response = await send(env(), submission([big]));
  assert.equal(response.status, 422);
  assert.equal((await json(response)).notes[0].id, "big");
  assert.equal(w.github.calls.length, 0);
});
