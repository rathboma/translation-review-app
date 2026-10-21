// The shapes the frontend and the Pages Functions pass around.

// html: the inner html of a text element; text: a bare text node; attr: an
// attribute (alt, title, placeholder, aria-label, data-tooltip, submit value);
// head: a field of the page's <head> (title, meta description, structured data).
// Only html segments carry inline markup.
export type SegmentKind = "html" | "text" | "attr" | "head";
export const KINDS: readonly SegmentKind[] = ["html", "text", "attr", "head"];

// The translated copies of the site, each under its own url prefix.
export const LANGUAGES: Record<string, { lang: string; label: string }> = {
  es: { lang: "es-MX", label: "Español" },
  "pt-br": { lang: "pt-BR", label: "Português" },
  ja: { lang: "ja", label: "日本語" },
};

// One translatable string of a page. A segment is a distinct (scope, key): the
// same English twice on a page is one segment, and a correction changes both.
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
  // What the translated page says there (null while it has the English).
  translation: string | null;
}

export interface AnnotatedPage {
  lang: string;
  path: string;
  // The site the two pages came from.
  site: string;
  // Whether the translated page has the English page's segments, one for one. If
  // not (the English changed since the copy was made) no segment has a
  // translation, and the translated page has no marks.
  aligned: boolean;
  // Both pages carry data-seg="<id>" on the element of every html segment
  // (text segments are wrapped in <span data-seg>), and are made safe to show:
  // no scripts, a <base>, and the review stylesheet.
  english: string;
  translated: string;
  segments: Segment[];
}

// What the config endpoint gives the frontend.
export interface Config {
  // The site reviewed unless a link or the translator says another.
  site: string;
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
  // The site the notes were written on (the default when left out).
  site?: string;
  notes: Note[];
  turnstileToken: string;
}

// How a correction is applied to the files in beekeeper-studio/web.
export type Apply =
  | { action: "set-common"; file: string; set: [scope: string, key: string, translation: string] }
  | { action: "set-explicit"; file: string; entry: Record<string, string> };

// A note as it goes into an issue, after the lint.
export interface Report {
  note: Note;
  warnings: string[];
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
  | { ok: true; issues: IssueRef[] }
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
