// The shapes the frontend, the Pages Functions and the translation Worker
// (workers/translate in beekeeper-studio/web) pass around.

// Where a segment's current translation comes from, in the Worker's order
// (workers/translate/src/resolve.ts). It decides how a correction is applied.
export type Source = "explicit" | "common" | "generated" | "english";
export const SOURCES: readonly Source[] = ["explicit", "common", "generated", "english"];

// html: the inner html of a text element; text: a bare text node; attr: an
// attribute (alt, title, placeholder, aria-label, data-tooltip, submit value);
// head: a field of the page's <head> (title, meta description, structured data).
// Only html segments carry inline markup.
export type SegmentKind = "html" | "text" | "attr" | "head";
export const KINDS: readonly SegmentKind[] = ["html", "text", "attr", "head"];

// One translatable string of a page, as GET /_translations/annotated has it.
// A segment is a distinct (scope, key): the same English twice on a page is one
// segment, and a correction changes both.
export interface Segment {
  // The same on the English and the translated side: data-seg="<id>".
  id: string;
  // The whitespace-normalized English: what a translation is looked up by.
  key: string;
  kind: SegmentKind;
  // The element and the heading above it: 'p, under "Pricing"'.
  where: string;
  // The shared include (header, footer...) it is part of, or null.
  scope: string | null;
  source: Source;
  // The current translation (null while the copy has English there).
  translation: string | null;
  // source explicit: the path of the explicit entry that wins (an exact url, a
  // glob or *), which is where a correction goes.
  entryPath?: string;
}

export interface AnnotatedPage {
  lang: string;
  path: string;
  fingerprint: string;
  // Both pages carry data-seg="<id>" on the element of every html segment
  // (text segments are wrapped in <span data-seg>). By GET /api/page they are
  // also made safe to show: no scripts, a <base>, and the review stylesheet.
  english: string;
  translated: string;
  segments: Segment[];
}

// What the manifest endpoint gives the frontend (a trimmed copy of the Worker's).
export interface Glossary {
  keep?: string[];
  terms?: Record<string, Record<string, string | string[]>>;
}

export interface LanguageInfo {
  label: string;
  // The cased BCP 47 tag: es-MX, pt-BR, ja.
  lang: string;
}

export interface ManifestInfo {
  site: string;
  languages: Record<string, LanguageInfo>;
  pages: string[];
  glossary: Glossary;
  turnstileSiteKey: string;
}

// A reviewer's note: the whole new translation of one segment.
export interface Note {
  // Made by the browser; errors come back by it.
  id: string;
  lang: string;
  path: string;
  // The segment's English (its key) and where it lives.
  key: string;
  scope: string | null;
  source: Source;
  kind: SegmentKind;
  where: string;
  // What the translator saw as the current translation (the English while the
  // copy has English there).
  current: string;
  // The whole new translation of the segment.
  new: string;
  comment?: string;
}

export interface Reviewer {
  name: string;
  email: string;
}

export interface SubmitBody extends Reviewer {
  notes: Note[];
  turnstileToken: string;
}

// How a correction is applied to the files in beekeeper-studio/web.
export type Apply =
  | { action: "set-common"; file: string; set: [scope: string, key: string, translation: string] }
  | { action: "replace-explicit" | "add-explicit"; file: string; entry: Record<string, string> };

// A note as it goes into an issue, after the Function has checked it against
// the live page.
export interface Report {
  note: Note;
  // The page's fingerprint when the note was filed.
  fingerprint: string | null;
  // The English is no longer on the page: skip it when applying.
  stale: boolean;
  warnings: string[];
  // The current translation is not the one the translator saw (it changed
  // since): what it is now.
  changedTo?: string;
  apply: Apply;
}

export interface NoteProblem {
  id: string;
  errors: string[];
  warnings: string[];
}

export interface IssueRef {
  lang: string;
  number: number;
  url: string;
  title: string;
}

export type SubmitResponse =
  // `stale`: how many notes were filed as stale (their English is gone).
  | { ok: true; issues: IssueRef[]; stale: number }
  // `issues` and `filed` (the notes' ids) say what was filed before it failed,
  // so a retry doesn't file those again.
  | { ok: false; error: string; notes?: NoteProblem[]; issues?: IssueRef[]; filed?: string[] };

export const LIMITS = {
  notes: 100,
  text: 5000,
  // All the text of a submission's notes, which bounds what it costs to check
  // and how many issues it can become.
  total: 200_000,
  name: 100,
  email: 254,
  id: 64,
} as const;
