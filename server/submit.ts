// POST /api/submit: files a translator's notes as GitHub issues.
//
//   1. rate limit, then the Turnstile token
//   2. the shape of the submission (shared/validate.ts) and the manifest: the
//      language and the page must be translated ones
//   3. every new translation through the Worker's own lint (vendor/translate):
//      errors are returned per note and nothing is filed while any note has
//      one; warnings go into the issue
//   4. each page's live data again: a note whose English is gone is filed as
//      stale, and the file a correction goes in is worked out from what the
//      string's source is now
//   5. one issue per language (more if the body would pass GitHub's limit)
//   6. the reviewer's email is stored by issue number, never put in the issue
import { Lint } from "../vendor/translate/lint.ts";
import { applyFor } from "../shared/apply.ts";
import { NoteTooLarge, splitIssues, type Issue } from "../shared/issue.ts";
import { parseSubmission } from "../shared/validate.ts";
import type { AnnotatedPage, IssueRef, Note, NoteProblem, Report } from "../shared/types.ts";
import type { Env } from "./env.ts";
import { createIssue, GitHubError } from "./github.ts";
import { fail, json, mapLimit, readText } from "./http.ts";
import { checkRate, refundSubmission, reserveSubmission } from "./ratelimit.ts";
import { saveReviewer } from "./reviewers.ts";
import { verifyTurnstile } from "./turnstile.ts";
import { loadAnnotated, loadManifest, WorkerError } from "./worker-api.ts";

const MAX_BODY = 2_000_000;
const PAGE_CHECKS_AT_ONCE = 5;

export interface SubmitOptions {
  now?: () => Date;
}

class Problems {
  private map = new Map<string, NoteProblem>();
  get(id: string): NoteProblem {
    let problem = this.map.get(id);
    if (!problem) this.map.set(id, (problem = { id, errors: [], warnings: [] }));
    return problem;
  }
  get errors(): boolean {
    return [...this.map.values()].some((p) => p.errors.length);
  }
  list(): NoteProblem[] {
    return [...this.map.values()];
  }
}

export async function submitHandler(request: Request, env: Env, options: SubmitOptions = {}): Promise<Response> {
  const now = options.now?.() ?? new Date();
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";

  const text = await readText(request, MAX_BODY);
  if (text === null) return fail(413, "That submission is too large.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail(400, "The submission is not valid JSON.");
  }
  const token = typeof (raw as { turnstileToken?: unknown } | null)?.turnstileToken === "string" ? (raw as { turnstileToken: string }).turnstileToken : "";

  const rate = await checkRate(env, ip, now.getTime());
  if (!rate.allowed) return tooMany(rate.retryAfter);
  if (!token) return fail(400, "The human check is missing. Reload the page and try again.");
  if (!(await verifyTurnstile(env, token, ip))) return fail(403, "The human check failed. Try again.");

  // One of the visitor's five an hour, taken now and given back unless something
  // is filed: a refused submission, or GitHub being down, costs them nothing.
  const at = now.getTime();
  const slot = await reserveSubmission(env, ip, at);
  if (!slot.allowed) return tooMany(slot.retryAfter);
  const filed: IssueRef[] = [];
  try {
    return await submit(raw, request, env, ip, now, filed);
  } finally {
    if (filed.length === 0) await refundSubmission(env, ip, at).catch(() => {});
  }
}

function tooMany(seconds: number): Response {
  const minutes = Math.ceil(seconds / 60);
  return fail(429, `Too many submissions from your network. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, {}, { "retry-after": String(seconds) });
}

async function submit(raw: unknown, request: Request, env: Env, ip: string, now: Date, filed: IssueRef[]): Promise<Response> {
  const parsed = parseSubmission(raw);
  if (!parsed.ok) return fail(422, parsed.error, parsed.notes ? { notes: parsed.notes } : {});
  const { reviewer, notes } = parsed.value;

  const filedNotes: string[] = [];
  try {
    const manifest = await loadManifest(env);
    const problems = new Problems();

    for (const note of notes) {
      if (!Object.hasOwn(manifest.languages, note.lang)) problems.get(note.id).errors.push(`${note.lang} is not a translated language`);
      else if (!manifest.pages.includes(note.path)) problems.get(note.id).errors.push(`${note.path} is not one of the translated pages`);
    }
    if (problems.errors) return fail(422, "Some notes need fixing.", { notes: problems.list() });

    // Lint, as the Worker lints what Claude writes.
    const linters = new Map<string, Lint>();
    for (const note of notes) {
      if (!linters.has(note.lang)) linters.set(note.lang, new Lint(manifest.glossary, note.lang));
      const result = linters.get(note.lang)!.check(note.key, note.new);
      if (result.errors.length || result.warnings.length) {
        const problem = problems.get(note.id);
        problem.errors.push(...result.errors);
        problem.warnings.push(...result.warnings);
      }
    }
    if (problems.errors) return fail(422, "Some translations need fixing before they can be filed.", { notes: problems.list() });

    // The live pages.
    const pageKeys = [...new Set(notes.map((n) => `${n.lang}\t${n.path}`))];
    const loaded = await mapLimit(pageKeys, PAGE_CHECKS_AT_ONCE, async (k) => {
      const [lang, path] = k.split("\t");
      return [k, await loadAnnotated(env, lang, path)] as const;
    });
    const pages = new Map<string, AnnotatedPage | null>(loaded);

    // A note that says what the page says already is nothing to apply (someone
    // made the same change meanwhile). Keeping the English is the exception.
    for (const note of notes) {
      const live = pages.get(`${note.lang}\t${note.path}`)?.segments.find((s) => s.scope === note.scope && s.key === note.key);
      if (live && live.source !== "english" && note.new === (live.translation ?? live.key)) {
        problems.get(note.id).errors.push("the translation is already the current translation: delete this note");
      }
    }
    if (problems.errors) return fail(422, "Some notes need fixing.", { notes: problems.list() });

    const reports: Report[] = notes.map((note) => report(note, pages.get(`${note.lang}\t${note.path}`) ?? null, problems.get(note.id).warnings));
    // Reports in the order the notes were made, grouped by language.
    const issues: { lang: string; issues: Issue[] }[] = [];
    for (const lang of [...new Set(notes.map((n) => n.lang))]) {
      const own = reports.filter((r) => r.note.lang === lang);
      issues.push({
        lang,
        issues: splitIssues({ lang, label: manifest.languages[lang].label, name: reviewer.name, submitted: now, reports: own, appUrl: env.APP_URL || new URL(request.url).origin }),
      });
    }

    for (const group of issues) {
      for (const issue of group.issues) {
        const created = await createIssue(env, issue);
        filed.push({ lang: group.lang, number: created.number, url: created.url, title: issue.title });
        filedNotes.push(...issue.reports.map((r) => r.note.id));
      }
    }
    await remember(env, reviewer, filed, now);
    console.log(`submit: ${notes.length} notes filed as ${filed.map((i) => `#${i.number}`).join(", ")}`);
    // How many were filed as stale, which the translator can't fix: they are told.
    return json({ ok: true, issues: filed, stale: reports.filter((r) => r.stale).length });
  } catch (error) {
    if (filed.length) await remember(env, reviewer, filed, now);
    if (error instanceof NoteTooLarge) return fail(422, "A note is too long to file.", { notes: [{ id: error.id, errors: ["this note is too long to file: shorten it"], warnings: [] }] });
    if (error instanceof WorkerError) {
      console.log(`submit: the translation service failed: ${error.message}`);
      return fail(502, `Couldn't check your notes against the live pages (${error.message}). They are still in your queue: try again in a minute.`);
    }
    if (error instanceof GitHubError) {
      console.log(`submit: ${error.message}`);
      const partly = filed.length ? ` ${filed.length === 1 ? "One issue was" : `${filed.length} issues were`} filed before that: those notes are not in your queue any more.` : " Your notes are still in your queue.";
      return fail(502, `Couldn't file the issue on GitHub (${error.message}).${partly}`, { issues: filed, filed: filedNotes });
    }
    throw error;
  }
}

// A note as it goes into an issue, checked against the live page.
function report(note: Note, page: AnnotatedPage | null, warnings: string[]): Report {
  const segment = page?.segments.find((s) => s.scope === note.scope && s.key === note.key);
  if (!segment) {
    // The English is gone (or the page is): the translator can't fix that.
    return {
      note,
      fingerprint: page?.fingerprint ?? null,
      stale: true,
      warnings,
      apply: applyFor({ lang: note.lang, path: note.path, key: note.key, scope: note.scope, source: note.source, translation: note.new }),
    };
  }
  const now = segment.translation ?? segment.key;
  return {
    // What the string's source is now decides how it is applied.
    note: { ...note, source: segment.source, where: segment.where },
    fingerprint: page!.fingerprint,
    stale: false,
    warnings,
    ...(now !== note.current ? { changedTo: now } : {}),
    apply: applyFor({ lang: note.lang, path: note.path, key: note.key, scope: segment.scope, source: segment.source, entryPath: segment.entryPath, translation: note.new }),
  };
}

// The email is kept by issue number, for the owner. The issue is already
// filed by now, so a failure here is logged, not returned.
async function remember(env: Env, reviewer: { name: string; email: string }, issues: IssueRef[], at: Date): Promise<void> {
  try {
    await saveReviewer(env, reviewer, issues.map((i) => i.number), at);
  } catch (error) {
    console.error(`submit: couldn't store the reviewer of ${issues.map((i) => `#${i.number}`).join(", ")}: ${error instanceof Error ? error.message : error}`);
  }
}
