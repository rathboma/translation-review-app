// Checks the shape of a submission before anything else looks at it: the
// limits (at most 100 notes, strings under 5,000 characters), the fields each
// note must have, and the reviewer's name and email.
import { hasWords, nestingProblem, tooManyTags } from "./chips.ts";
import { KINDS, LIMITS, type Note, type NoteProblem, type Reviewer, type SegmentKind } from "./types.ts";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; notes?: NoteProblem[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseReviewer(input: unknown): Parsed<Reviewer> {
  const o = isObject(input) ? input : {};
  const name = typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim() : "";
  const email = typeof o.email === "string" ? o.email.trim() : "";
  if (!name) return { ok: false, error: "Your name is required." };
  if (name.length > LIMITS.name || CONTROL.test(name)) return { ok: false, error: `Your name must be a single line under ${LIMITS.name} characters.` };
  if (!email) return { ok: false, error: "Your email is required." };
  if (email.length > LIMITS.email || !EMAIL.test(email) || CONTROL.test(email)) return { ok: false, error: "That doesn't look like an email address." };
  return { ok: true, value: { name, email } };
}

function text(o: Record<string, unknown>, field: string, problems: string[], { required = true, max = LIMITS.text as number } = {}): string | undefined {
  const value = o[field];
  if (value === undefined || value === null || value === "") {
    if (required) problems.push(`${field} is missing`);
    return undefined;
  }
  if (typeof value !== "string") {
    problems.push(`${field} must be text`);
    return undefined;
  }
  if (value.length > max) {
    problems.push(`${field} is too long (${value.length} of ${max} characters)`);
    return undefined;
  }
  return value;
}

// One note, or the problems with it.
export function parseNote(input: unknown): { note?: Note; id: string; errors: string[] } {
  const o = isObject(input) ? input : {};
  const errors: string[] = [];
  const id = typeof o.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(o.id) ? o.id : "";
  if (!id) errors.push("id is missing or malformed");
  const lang = text(o, "lang", errors, { max: 32 });
  if (lang !== undefined && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(lang)) errors.push("lang is malformed");
  const path = text(o, "path", errors, { max: 500 });
  if (path !== undefined && !path.startsWith("/")) errors.push("path must start with /");
  const key = text(o, "key", errors);
  const where = text(o, "where", errors, { required: false });
  const current = text(o, "current", errors);
  const next = text(o, "new", errors);
  const comment = text(o, "comment", errors, { required: false });
  let scope: string | null = null;
  if (o.scope !== null && o.scope !== undefined) {
    const s = text(o, "scope", errors, { max: 64 });
    // A scope is the name of an include (header, cta-download): it is checked
    // because a note whose English has gone is filed with the scope it came with.
    if (s !== undefined && !/^[A-Za-z0-9_-]+$/.test(s)) errors.push("scope is malformed");
    else if (s !== undefined) scope = s;
  }
  for (const [name, value] of [["key", key], ["current", current], ["new", next]] as const) {
    if (value !== undefined && tooManyTags(value)) errors.push(`${name} has too many tags`);
  }
  const kind = (o.kind ?? "html") as SegmentKind;
  if (!KINDS.includes(kind)) errors.push(`kind must be one of ${KINDS.join(", ")}`);
  if (errors.length) return { id, errors };
  const note: Note = { id, lang: lang!, path: path!, key: key!, scope, kind, where: where ?? "", current: current!, new: next!, ...(comment ? { comment } : {}) };
  return { note, id, errors };
}

// The characters of a note's text, for the limit on all of them.
export const noteSize = (n: Pick<Note, "key" | "current" | "new" | "where"> & { comment?: string }): number =>
  n.key.length + n.current.length + n.new.length + n.where.length + (n.comment?.length ?? 0);

// The notes that go in one submission: as many from the start as the limits allow
// (the rest wait for the next).
export function batch<T extends Parameters<typeof noteSize>[0]>(notes: T[]): T[] {
  const out: T[] = [];
  let total = 0;
  for (const n of notes) {
    if (out.length >= LIMITS.notes || total + noteSize(n) > LIMITS.total) break;
    out.push(n);
    total += noteSize(n);
  }
  return out;
}

export interface ParsedSubmission {
  reviewer: Reviewer;
  // The site the notes were written on, or "" for the default.
  site: string;
  notes: Note[];
  turnstileToken: string;
}

export function parseSubmission(input: unknown): Parsed<ParsedSubmission> {
  if (!isObject(input)) return { ok: false, error: "The submission is not valid JSON." };
  const reviewer = parseReviewer(input);
  if (!reviewer.ok) return reviewer;
  const token = input.turnstileToken;
  if (typeof token !== "string" || !token || token.length > 2048) return { ok: false, error: "The human check is missing. Reload the page and try again." };
  if (!Array.isArray(input.notes) || input.notes.length === 0) return { ok: false, error: "There are no notes to submit." };
  if (input.notes.length > LIMITS.notes) return { ok: false, error: `Submit at most ${LIMITS.notes} notes at a time (there are ${input.notes.length}).` };
  const sizes = input.notes.reduce<number>((sum, raw) => sum + (isObject(raw) ? ["key", "current", "new", "where", "comment"].reduce((n, f) => n + (typeof raw[f] === "string" ? (raw[f] as string).length : 0), 0) : 0), 0);
  if (sizes > LIMITS.total) {
    return { ok: false, error: `These notes are too long to send at once (${sizes.toLocaleString("en")} of ${LIMITS.total.toLocaleString("en")} characters). Send some now and the rest after.` };
  }
  const notes: Note[] = [];
  const problems: NoteProblem[] = [];
  const ids = new Set<string>();
  const texts = new Set<string>();
  input.notes.forEach((raw, i) => {
    const parsed = parseNote(raw);
    const errors = [...parsed.errors];
    if (parsed.note) {
      const { note } = parsed;
      if (ids.has(note.id)) errors.push("two notes have the same id");
      const same = [note.lang, note.path, note.scope ?? "", note.key].join("\t");
      if (texts.has(same)) errors.push("another note is about the same text: keep one");
      ids.add(note.id);
      texts.add(same);
      // (Tags alone pass the lint, which checks the markup: they are not a translation.)
      if (note.new.trim() === "" || !hasWords(note.new)) errors.push("the new translation is empty");
      // Keeping the English is an answer for a string the copy left untranslated.
      else if (note.new === note.current && note.new !== note.key) errors.push("the new translation is the same as the current one");
      if (note.kind === "html") {
        const nesting = nestingProblem(note.key, note.new);
        if (nesting) errors.push(nesting);
      }
    }
    if (errors.length) problems.push({ id: parsed.id || `#${i + 1}`, errors, warnings: [] });
    else notes.push(parsed.note!);
  });
  if (problems.length) return { ok: false, error: "Some notes need fixing.", notes: problems };
  const site = typeof input.site === "string" ? input.site : "";
  return { ok: true, value: { reviewer: reviewer.value, site, notes, turnstileToken: token } };
}
