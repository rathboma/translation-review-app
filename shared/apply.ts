// How a correction is applied to beekeeper-studio/web (see "Translated Pages"
// in its CLAUDE.md), from where the string is:
//
//   in a shared include (header, footer...)
//               set common[<scope>][<key>] in bin/translations/common/<lang>.json:
//               it changes the string on every page that has the include
//   anywhere else
//               an explicit entry for the page in bin/translations/explicit/<lang>.yml
//               (matched on path and en: set its value if there is one, else add
//               it, as `bin/translations.mjs pin` does)
//
// The app can't see which of the Worker's layers a translation came from, so
// whoever applies a note checks that nothing more specific (an explicit entry
// for the page, say) overrides what they change.
import type { Apply } from "./types.ts";

export interface ApplyInput {
  lang: string;
  path: string;
  key: string;
  scope: string | null;
  translation: string;
}

export function commonFile(lang: string): string {
  return `bin/translations/common/${lang}.json`;
}

export function explicitFile(lang: string): string {
  return `bin/translations/explicit/${lang}.yml`;
}

export function applyFor(input: ApplyInput): Apply {
  const { lang, key, scope, translation } = input;
  if (scope) return { action: "set-common", file: commonFile(lang), set: [scope, key, translation] };
  return { action: "set-explicit", file: explicitFile(lang), entry: { path: input.path, en: key, [lang]: translation } };
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

// The name of an include people know, if it is one (not a property of every object).
export const knownScope = (scope: string): string | undefined => (Object.hasOwn(SCOPES, scope) ? SCOPES[scope] : undefined);

export function scopeLabel(scope: string): string {
  return knownScope(scope) ?? `the shared "${scope}" include`;
}
