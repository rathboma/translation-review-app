// How a correction is applied to beekeeper-studio/web, from where the string's
// current translation comes from (see "Translated Pages" in its CLAUDE.md):
//
//   common      set common[<scope>][<key>] in bin/translations/common/<lang>.json
//               (it changes the string on every page that has the include)
//   explicit    replace the <lang> value of the entry in
//               bin/translations/explicit/<lang>.yml (matched on path and en)
//   generated   add an explicit entry, as `bin/translations.mjs pin` does
//   english     the same: the copy has English there
import type { Apply, Source } from "./types.ts";

export interface ApplyInput {
  lang: string;
  path: string;
  key: string;
  scope: string | null;
  source: Source;
  // source explicit: the path of the entry that wins (it may be a glob or *).
  entryPath?: string;
  translation: string;
}

export function commonFile(lang: string): string {
  return `bin/translations/common/${lang}.json`;
}

export function explicitFile(lang: string): string {
  return `bin/translations/explicit/${lang}.yml`;
}

export function applyFor(input: ApplyInput): Apply {
  const { lang, key, scope, source, translation } = input;
  if (source === "common") {
    if (!scope) throw new Error("a common translation needs its scope");
    return { action: "set-common", file: commonFile(lang), set: [scope, key, translation] };
  }
  if (source === "explicit") {
    return { action: "replace-explicit", file: explicitFile(lang), entry: { path: input.entryPath ?? input.path, en: key, [lang]: translation } };
  }
  return { action: "add-explicit", file: explicitFile(lang), entry: { path: input.path, en: key, [lang]: translation } };
}

// Where a segment sits, for the reader of an issue or the editor.
const SCOPES: Record<string, string> = {
  header: "the site header",
  footer: "the site footer",
  "lang-switcher": "the language switcher",
  newsletter: "the newsletter signup",
  "post-pitch": "the pitch at the end of every blog post",
  "blog-modal": "the blog signup popup",
  "cta-download": "the download call to action",
  testimonials: "the testimonials",
  mission: "the mission statement",
  "download-section": "the download section",
  "sales-qualifier": "the sales form",
  "exit-popup": "the exit popup",
};

export function scopeLabel(scope: string): string {
  return SCOPES[scope] ?? `the shared "${scope}" include`;
}
