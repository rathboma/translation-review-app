import { test } from "vitest";
import assert from "node:assert/strict";
import { parseNote, parseReviewer, parseSubmission } from "../shared/validate.ts";
import { note } from "./helpers.ts";

const body = (overrides: Record<string, unknown> = {}) => ({ name: "María López", email: "maria@example.com", turnstileToken: "tok", notes: [note()], ...overrides });

function refused(input: unknown) {
  const parsed = parseSubmission(input);
  assert.equal(parsed.ok, false);
  return parsed as Extract<typeof parsed, { ok: false }>;
}

test("a good submission parses, with the name tidied", () => {
  const parsed = parseSubmission(body({ name: "  María   López " }));
  assert.ok(parsed.ok);
  assert.equal(parsed.value.reviewer.name, "María López");
  assert.equal(parsed.value.notes.length, 1);
});

test("name and email are required", () => {
  assert.match(refused(body({ name: " " })).error, /name is required/);
  assert.match(refused(body({ email: "" })).error, /email is required/);
  assert.match(refused(body({ email: "not an email" })).error, /email address/);
  // Whitespace is tidied, control characters are refused.
  assert.deepEqual(parseReviewer({ name: "a\nb", email: "a@b.co" }), { ok: true, value: { name: "a b", email: "a@b.co" } });
  assert.equal(parseReviewer({ name: "a\u0007b", email: "a@b.co" }).ok, false);
  assert.equal(parseReviewer({ name: "x".repeat(101), email: "a@b.co" }).ok, false);
});

test("at most 100 notes", () => {
  const many = Array.from({ length: 101 }, (_, i) => note({ id: `n${i}`, key: `Key ${i}` }));
  assert.match(refused(body({ notes: many })).error, /at most 100/);
  const hundred = many.slice(0, 100);
  assert.ok(parseSubmission(body({ notes: hundred })).ok);
});

test("no notes, no human check", () => {
  assert.match(refused(body({ notes: [] })).error, /no notes/);
  assert.match(refused(body({ turnstileToken: "" })).error, /human check/);
  assert.match(refused("nope").error, /not valid/);
});

test("strings are under 5,000 characters, the problem is named by note", () => {
  const long = "x".repeat(5001);
  const result = refused(body({ notes: [note({ id: "a" }), note({ id: "b", key: "Other", new: long })] }));
  assert.deepEqual(result.notes!.map((n) => n.id), ["b"]);
  assert.match(result.notes![0].errors[0], /new is too long/);
  assert.ok(parseSubmission(body({ notes: [note({ new: "y".repeat(5000) })] })).ok);
});

test("each note's fields must be present", () => {
  for (const field of ["lang", "path", "key", "current", "new"]) {
    const { errors } = parseNote({ ...note(), [field]: undefined });
    assert.ok(errors.some((e) => e.startsWith(`${field} is missing`)), `${field}: ${errors}`);
  }
  assert.ok(parseNote({ ...note(), source: "magic" }).errors[0].includes("source"));
  assert.ok(parseNote({ ...note(), id: "has spaces" }).errors[0].includes("id"));
  assert.ok(parseNote({ ...note(), path: "pricing" }).errors[0].includes("path"));
  assert.ok(parseNote({ ...note(), source: "common", scope: null }).errors[0].includes("scope"));
  assert.ok(parseNote({ ...note(), lang: 7 }).errors[0].includes("lang"));
});

test("a note must change something, unless it confirms English for an untranslated string", () => {
  const same = refused(body({ notes: [note({ new: note().current })] }));
  assert.match(same.notes![0].errors[0], /same as the current/);
  assert.match(refused(body({ notes: [note({ new: "  " })] })).notes![0].errors[0], /empty/);
  assert.ok(parseSubmission(body({ notes: [note({ source: "english", current: "Blog", key: "Blog", new: "Blog" })] })).ok);
});

test("two notes about the same text, or with the same id, are refused", () => {
  const dup = refused(body({ notes: [note({ id: "a" }), note({ id: "b", new: "Otra" })] }));
  assert.match(dup.notes![0].errors[0], /same text/);
  assert.match(refused(body({ notes: [note({ id: "a" }), note({ id: "a", key: "Other" })] })).notes![0].errors[0], /same id/);
  // The same English in another scope or page is another string.
  assert.ok(parseSubmission(body({ notes: [note({ id: "a" }), note({ id: "b", scope: "footer" }), note({ id: "c", path: "/get" })] })).ok);
});

test("a comment is optional, text is kept as typed", () => {
  const parsed = parseSubmission(body({ notes: [note({ comment: "  too formal " })] }));
  assert.ok(parsed.ok);
  assert.equal(parsed.value.notes[0].comment, "  too formal ");
  assert.equal(parseNote({ ...note(), comment: "" }).note!.comment, undefined);
});

test("a translation of tags with no words is empty", () => {
  const tagsOnly = refused(body({ notes: [note({ key: 'Read <a href="/x">this</a>', current: 'Lee <a href="/x">esto</a>', new: '<a href="/x"></a>' })] }));
  assert.match(tagsOnly.notes![0].errors[0], /empty/);
  assert.ok(parseSubmission(body({ notes: [note({ key: 'Read <a href="/x">this</a>', current: 'Lee <a href="/x">esto</a>', new: 'Mira <a href="/x">esto</a>' })] })).ok);
});
