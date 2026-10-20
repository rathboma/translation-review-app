// The app's state: who is reviewing, the manifest, the page on show, the queue
// of notes (kept in localStorage across pages, languages and days) and what is
// being edited.
import { reactive, watch } from "vue";
import { Lint } from "../../vendor/translate/lint.ts";
import { normalize } from "../../vendor/translate/text.ts";
import type { AnnotatedPage, IssueRef, ManifestInfo, Note, NoteProblem, Reviewer, Segment, SegmentKind, Source } from "../../shared/types.ts";
import { LIMITS } from "../../shared/types.ts";
import { parseNote, parseReviewer } from "../../shared/validate.ts";
import * as api from "./api.ts";
import { load, save } from "./storage.ts";

// A note being written: the segment it is about, and what the translator has
// typed so far. `id` is null until it is saved.
export interface Draft {
  id: string | null;
  lang: string;
  path: string;
  key: string;
  scope: string | null;
  source: Source;
  kind: SegmentKind;
  where: string;
  current: string;
  new: string;
  comment: string;
}

export interface Anchor {
  top: number;
  bottom: number;
  left: number;
  right: number;
  side: "english" | "translated";
}

export interface Editing {
  draft: Draft;
  // Where it was opened from: a page (next to the segment) or a list (centered).
  origin: "english" | "translated" | "drawer" | "queue";
  anchor: Anchor | null;
  // The text selected on the translated page, to select in the editor.
  preselect: { text: string; hint: number } | null;
}

// What was kept in the browser, checked as the server checks a submission: a
// corrupt or hand-edited entry is dropped, not a reason for the app not to start.
function savedReviewer(): Reviewer | null {
  const parsed = parseReviewer(load<unknown>("reviewer", null));
  return parsed.ok ? parsed.value : null;
}

function savedNotes(): Note[] {
  const saved = load<unknown>("notes", []);
  if (!Array.isArray(saved)) return [];
  return saved.flatMap((raw) => {
    const { note } = parseNote(raw);
    return note ? [note] : [];
  });
}

export const state = reactive({
  reviewer: savedReviewer(),
  manifest: null as ManifestInfo | null,
  manifestError: "",
  lang: "",
  path: "",
  page: null as AnnotatedPage | null,
  loading: false,
  pageError: null as { message: string; code?: string } | null,
  notes: savedNotes(),
  // What the server said about notes it refused (or warned about), by note id.
  problems: {} as Record<string, NoteProblem>,
  editing: null as Editing | null,
  // Bumped each time an editor opens, so a new one is a fresh component.
  editingSeq: 0,
  drawer: false,
  queueOpen: false,
  submit: { open: false, busy: false, error: "", issues: [] as IssueRef[] },
});

watch(() => state.notes, (notes) => save("notes", notes), { deep: true });

// ---- the reviewer -----------------------------------------------------------

export function setReviewer(reviewer: Reviewer): void {
  state.reviewer = reviewer;
  save("reviewer", reviewer);
}

// The queue stays: it is theirs, not the next person's to see, but it is on
// this browser, so signing out keeps it for the same browser's next sign in.
export function signOut(): void {
  state.reviewer = null;
  save("reviewer", null);
}

// ---- pages ------------------------------------------------------------------

export async function loadManifest(): Promise<void> {
  state.manifestError = "";
  try {
    state.manifest = await api.getManifest();
    linters.clear();
  } catch (error) {
    state.manifestError = error instanceof Error ? error.message : String(error);
  }
}

export function pathQuery(lang: string, path: string): string {
  return `?lang=${encodeURIComponent(lang)}&path=${encodeURI(path).replace(/[?#&]/g, encodeURIComponent)}`;
}

let loading = 0;

// Shows a language's page: loads it from the Functions, remembers it, and puts
// it in the address so the link can be shared.
export async function openPage(lang: string, path: string): Promise<void> {
  state.lang = lang;
  state.path = path;
  state.editing = null;
  state.drawer = false;
  save("last", { lang, path });
  try {
    history.replaceState(history.state, "", path ? pathQuery(lang, path) : lang ? `?lang=${encodeURIComponent(lang)}` : location.pathname);
  } catch {
    // Not worth failing for.
  }
  if (!lang || !path) {
    state.page = null;
    state.pageError = null;
    return;
  }
  const mine = ++loading;
  state.loading = true;
  state.pageError = null;
  try {
    const page = await api.getPage(lang, path);
    if (mine !== loading) return;
    state.page = page;
  } catch (error) {
    if (mine !== loading) return;
    state.page = null;
    state.pageError = { message: error instanceof Error ? error.message : String(error), code: error instanceof api.ApiError ? error.code : undefined };
  } finally {
    if (mine === loading) state.loading = false;
  }
}

// Where to start: the link's page, else the last one, else nothing chosen.
export function startingPlace(search: string): { lang: string; path: string } {
  const params = new URLSearchParams(search);
  const lang = params.get("lang");
  const path = params.get("path");
  const languages = state.manifest?.languages ?? {};
  if (lang && languages[lang]) return { lang, path: path && state.manifest!.pages.includes(path) ? path : "" };
  const last = load<{ lang: string; path: string } | null>("last", null);
  if (last && languages[last.lang]) return { lang: last.lang, path: state.manifest!.pages.includes(last.path) ? last.path : "" };
  return { lang: "", path: "" };
}

// ---- notes ------------------------------------------------------------------

export const currentOf = (segment: Pick<Segment, "translation" | "key">): string => segment.translation ?? segment.key;

export function noteFor(lang: string, path: string, scope: string | null, key: string): Note | undefined {
  return state.notes.find((n) => n.lang === lang && n.path === path && n.scope === scope && n.key === key);
}

export const notesOnPage = (lang: string, path: string): Note[] => state.notes.filter((n) => n.lang === lang && n.path === path);

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function draftFor(segment: Segment, lang = state.lang, path = state.path): Draft {
  const existing = noteFor(lang, path, segment.scope, segment.key);
  return {
    id: existing?.id ?? null,
    lang,
    path,
    key: segment.key,
    scope: segment.scope,
    source: segment.source,
    kind: segment.kind,
    where: segment.where,
    current: currentOf(segment),
    new: existing?.new ?? currentOf(segment),
    comment: existing?.comment ?? "",
  };
}

export function draftOfNote(note: Note): Draft {
  return { id: note.id, lang: note.lang, path: note.path, key: note.key, scope: note.scope, source: note.source, kind: note.kind, where: note.where, current: note.current, new: note.new, comment: note.comment ?? "" };
}

export function openEditor(editing: Editing): void {
  state.editing = editing;
  state.editingSeq++;
  state.drawer = false;
}

export function closeEditor(): void {
  state.editing = null;
}

// The note keeps the whole new translation, whitespace as the Worker keys it.
export function saveNote(draft: Draft): Note {
  const comment = draft.comment.trim().slice(0, LIMITS.text);
  const fields = {
    lang: draft.lang,
    path: draft.path,
    key: draft.key,
    scope: draft.scope,
    source: draft.source,
    kind: draft.kind,
    where: draft.where,
    current: draft.current,
    new: normalize(draft.new),
    ...(comment ? { comment } : {}),
  };
  const existing = draft.id ? state.notes.find((n) => n.id === draft.id) : undefined;
  let note: Note;
  if (existing) {
    // Replace it whole, so a comment that was cleared is gone.
    note = { id: existing.id, ...fields };
    state.notes.splice(state.notes.indexOf(existing), 1, note);
  } else {
    note = { id: newId(), ...fields };
    state.notes.push(note);
  }
  delete state.problems[note.id];
  return note;
}

export function deleteNote(id: string): void {
  const i = state.notes.findIndex((n) => n.id === id);
  if (i !== -1) state.notes.splice(i, 1);
  delete state.problems[id];
  if (state.editing?.draft.id === id) state.editing = null;
}

// ---- lint (the server's, run here so mistakes show as they are made) ---------

const linters = new Map<string, Lint>();

export function lint(lang: string, key: string, value: string): { errors: string[]; warnings: string[] } {
  let linter = linters.get(lang);
  if (!linter) linters.set(lang, (linter = new Lint(state.manifest?.glossary ?? {}, lang)));
  return linter.check(key, value);
}

// What is wrong with a note: the lint's verdict now, and what the server said
// when it last refused it. The server's reasons that the lint repeats are dropped.
export function problemsFor(note: Pick<Note, "id" | "lang" | "key" | "new">): { errors: string[]; warnings: string[] } {
  const own = lint(note.lang, note.key, note.new);
  const server = state.problems[note.id];
  return {
    errors: [...new Set([...own.errors, ...(server?.errors ?? [])])],
    warnings: [...new Set([...own.warnings, ...(server?.warnings ?? [])])],
  };
}

// ---- submitting -------------------------------------------------------------

export function openSubmit(): void {
  state.submit = { open: true, busy: false, error: "", issues: [] };
}

export function closeSubmit(): void {
  state.submit.open = false;
}

export async function submitNotes(turnstileToken: string): Promise<boolean> {
  const reviewer = state.reviewer!;
  state.submit.busy = true;
  state.submit.error = "";
  const { data } = await api.postSubmit({ name: reviewer.name, email: reviewer.email, notes: state.notes.map((n) => ({ ...n })), turnstileToken });
  state.submit.busy = false;
  if (data.ok) {
    state.notes.splice(0, state.notes.length);
    state.problems = {};
    state.submit.issues = data.issues;
    return true;
  }
  state.submit.error = data.error;
  // Some of it may be filed already: those notes are done.
  if (data.filed?.length) {
    for (const id of data.filed) {
      const i = state.notes.findIndex((n) => n.id === id);
      if (i !== -1) state.notes.splice(i, 1);
    }
  }
  state.submit.issues = data.issues ?? [];
  if (data.notes?.length) {
    state.problems = Object.fromEntries(data.notes.map((p) => [p.id, p]));
    state.queueOpen = true;
  }
  return false;
}
