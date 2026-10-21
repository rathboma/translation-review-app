// Regression tests for what an independent review found. Each one failed before
// its fix.
import { afterEach, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { hasWords, nestingProblem, parseParts, wellNested } from "../shared/chips.ts";
import { renderIssue, quote } from "../shared/issue.ts";
import { scopeLabel } from "../shared/apply.ts";
import { parseSubmission } from "../shared/validate.ts";
import { ipBucket } from "../server/ratelimit.ts";
import { submitHandler } from "../server/submit.ts";
import { annotated, env, post, segment, submission, world, type World } from "./server-helpers.ts";
import { machineNotes, note, report } from "./helpers.ts";

const NOW = new Date("2026-10-21T10:14:00Z");
const send = (e: ReturnType<typeof env>, body: unknown, headers?: Record<string, string>) => submitHandler(post(body, headers), e, { now: () => NOW });
const issueInput = (reports = [report()]) => ({ lang: "es", label: "Español", name: "María López", submitted: NOW, reports, appUrl: "https://translate.beekeeperstudio.io" });

let w: World;
beforeEach(() => {
  w = world({ "es /pricing/": annotated("es", "/pricing/", [segment()]) });
});
afterEach(() => vi.unstubAllGlobals());

const time = (fn: () => unknown) => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

// ---- text from a stranger reaches the public issue only inside code ------------

test("a stale note's scope is text from a stranger: it goes in a code span, not into the markdown", () => {
  const scope = "@beekeeper-studio/maintainers @octocat #1 [x](https://evil.example)";
  const body = renderIssue(issueInput([report({ scope, source: "generated" }, { stale: true })])).body;
  const outside = body.replace(/(`{3,})[^\n]*\n[\s\S]*?\n\1\n/g, "").replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, "");
  for (const bad of ["@beekeeper-studio", "@octocat", "#1", "](https", "evil.example"]) assert.ok(!outside.includes(bad), `${bad} is rendered: ${outside}`);
});

test("scope names that are properties of every object are not in the table", () => {
  for (const scope of ["constructor", "toString", "__proto__", "hasOwnProperty"]) assert.ok(!scopeLabel(scope).includes("function"), scope);
  assert.equal(scopeLabel("constructor"), 'the shared "constructor" include');
});

test("a scope is a name: letters, digits, hyphens", async () => {
  const bad = await send(env(), submission([note({ scope: "@everyone [x](y)", key: "Nope", source: "generated" })]));
  assert.equal(bad.status, 422);
  assert.equal(w.github.calls.length, 0);
});

test("a name in the title is cut by characters, not UTF-16 halves, and carries nothing that links", () => {
  const emoji = "x".repeat(59) + "😀" + "tail";
  const title = renderIssue({ ...issueInput(), name: emoji }).title;
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(title), "a lone surrogate in the title");
  const linked = renderIssue({ ...issueInput(), name: "#1 owner/repo#2 @octocat `x`" }).title;
  assert.ok(!/[#@`]/.test(linked.replace(/^Translation notes \(es\): 1 note from /, "")), linked);
});

test("quote() escapes the non-characters a YAML parser other than js-yaml rejects", () => {
  assert.equal(quote("a\ufffeb\uffffc"), '"a\\ufffeb\\uffffc"');
  assert.equal(machineNotes(renderIssue(issueInput([report({ new: "Paga\ufffe\uffff una vez" })])).body).notes[0].new, "Paga\ufffe\uffff una vez");
});

// ---- the language is a language of the manifest, not a property of an object -----

test("a language that is a property of every object is not a language", async () => {
  for (const lang of ["constructor", "toString", "__proto__"]) {
    const response = await send(env(), submission([note({ lang })]));
    assert.equal(response.status, 422, lang);
  }
  assert.equal(w.github.calls.length, 0);
});

// ---- work a stranger can ask of the Function is bounded ---------------------------

test("tags in a string are counted before anything parses it", () => {
  const response = parseSubmission(submission([note({ new: "<a".repeat(2500) })]));
  assert.equal(response.ok, false);
  assert.match((response as { notes: { errors: string[] }[] }).notes[0].errors.join(" "), /too many tags/);
});

test("parsing html for chips is linear, whatever the angle brackets", () => {
  for (const hostile of ["<a".repeat(2500), "<a'".repeat(1600), '<a "'.repeat(1000) + ">", "<!--".repeat(1200), "<a ".repeat(1600) + ">"]) {
    const ms = time(() => hasWords(hostile.slice(0, 5000)));
    assert.ok(ms < 150, `${ms.toFixed(0)} ms for ${JSON.stringify(hostile.slice(0, 12))}`);
  }
  assert.equal(parseParts('a <b title="x > y">c</b> d').filter((p) => p.type === "tag").length, 2);
});

test("one submission cannot ask for a hundred issues: the notes are limited in total length", async () => {
  const long = (c: string) => c.repeat(4000);
  const notes = Array.from({ length: 100 }, (_, i) => note({ id: `n${i}`, key: `${long("k")}${i}`, current: long("c"), new: `${long("c")}x${i}`, comment: long("m") }));
  const response = await send(env(), submission(notes));
  assert.equal(response.status, 422);
  assert.match(((await response.json()) as any).error, /too long to send at once/);
  assert.equal(w.github.calls.length, 0);
});

test("a translation that is only invisible characters or punctuation has no words", () => {
  for (const empty of ["\u200b", "­", "⁠\u200b", "...", " - ", "<b>\u200b</b>", "&nbsp;"]) assert.equal(hasWords(empty), false, JSON.stringify(empty));
  for (const real of ["a", "日本", "1", "👍", "<b>x</b>"]) assert.equal(hasWords(real), true, real);
});

// ---- notes that mean nothing, and what the translator is told ----------------------

test("tags that are out of order are refused, as the lint would not", () => {
  assert.equal(wellNested(parseParts("<b><a>x</a></b>")), true);
  assert.equal(wellNested(parseParts("<b><a>x</b></a>")), false);
  assert.equal(wellNested(parseParts("x</a><a>y")), false);
  assert.equal(wellNested(parseParts("a<br>b<img src=x>c")), true);
  const key = 'Read the <a href="/docs">docs</a> now';
  assert.equal(nestingProblem(key, 'Read the <a href="/docs">docs</a> now'), null);
  assert.match(nestingProblem(key, 'Read the docs</a><a href="/docs"> now')!, /nested/);
  // A key that is itself broken sets no standard.
  assert.equal(nestingProblem("a </b> b <b> c", "x </b> y <b> z"), null);
});

test("mis-nested tags in a note are refused by the server, next to the note", async () => {
  const key = 'Read the <a href="/docs">docs</a> now';
  const response = await send(env(), submission([note({ key, current: 'Lee los <a href="/docs">docs</a> ya', new: 'Lee los docs</a><a href="/docs"> ya' })]));
  assert.equal(response.status, 422);
  assert.match(JSON.stringify(((await response.json()) as any).notes), /nested/);
});

test("a note that is already the live translation is a no-op, and says to delete it", async () => {
  const live = "Paga una vez, usa las funciones de pago para siempre.";
  const response = await send(env(), submission([note({ id: "same", current: "una vieja traducción", new: live })]));
  assert.equal(response.status, 422);
  const [problem] = ((await response.json()) as any).notes;
  assert.equal(problem.id, "same");
  assert.match(problem.errors.join(" "), /already the current translation/);
  assert.equal(w.github.calls.length, 0);
});

test("the answer says how many notes were filed as stale, so a translator isn't left to find out", async () => {
  const response = await send(env(), submission([note({ id: "ok" }), note({ id: "gone", key: "Not on the page any more", current: "Ya no", new: "Tampoco" })]));
  const body = (await response.json()) as any;
  assert.equal(body.ok, true);
  assert.equal(body.stale, 1);
});

test("a page that has lost its copy files its notes as stale, and says so", async () => {
  delete w.worker.pages["es /pricing/"];
  const body = (await (await send(env(), submission([note()]))).json()) as any;
  assert.equal(body.stale, 1);
});

// ---- the rate limit ---------------------------------------------------------------

test("an IPv6 visitor is counted by their /64, not by each address in it", () => {
  assert.equal(ipBucket("203.0.113.7"), "203.0.113.7");
  assert.equal(ipBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), ipBucket("2001:db8:1:2::1"));
  assert.equal(ipBucket("2001:0db8:0001:0002:0:0:0:9"), ipBucket("2001:db8:1:2:ffff:ffff:ffff:ffff"));
  assert.notEqual(ipBucket("2001:db8:1:2::1"), ipBucket("2001:db8:1:3::1"));
  assert.equal(ipBucket("::1"), ipBucket("0:0:0:0:5:6:7:8"));
  assert.equal(ipBucket("unknown"), "unknown");
});

test("a GitHub outage doesn't use up the visitor's five submissions", async () => {
  w.github.fail = () => true;
  const e = env();
  for (let i = 0; i < 8; i++) assert.equal((await send(e, submission([note()], { turnstileToken: `t${i}` }))).status, 502, `attempt ${i + 1}`);
  w.github.fail = () => false;
  assert.equal((await send(e, submission([note()]))).status, 200);
});

test("simultaneous submissions from one address can't all slip past a limit that is checked, then charged", async () => {
  const e = env();
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => send(e, submission([note({ id: `p${i}`, new: `Paga una sola vez ${i}.` })], { turnstileToken: `t${i}` }))));
  const filed = results.filter((r) => r.status === 200).length;
  assert.ok(filed <= 5 + 3, `${filed} of 12 got through a limit of 5`);
});
