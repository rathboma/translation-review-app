# translation-review: guide for agents

translate.beekeeperstudio.io. A translator reviews the machine-translated copies of
beekeeperstudio.io next to the English and files notes as GitHub issues on
`beekeeper-studio/web`. **Read `README.md` first** (how it works, setup, differences from
the spec); `docs/spec.md` is the original spec. `beekeeper-studio/web` is a separate
repository, **read only from here**: never commit or push there. The Worker it talks to
is in `workers/translate/` there (see "Translated Pages" in its `CLAUDE.md`); changes to
it go in `worker/annotated-endpoint.patch`.

## Layout

- `src/`: the Vue 3 frontend (Vite). `src/lib/state.ts` is the store; `ChipEditor.vue` is
  the careful part.
- `functions/api/*.ts`: Pages Functions, thin wrappers. The code is in `server/`.
- `shared/`: pure TypeScript used by the browser and the Functions (types, the issue
  body, `apply`, chips, validation). No DOM, no Workers APIs.
- `vendor/translate/`: the Worker's `lint.ts` and `text.ts`, **byte for byte**. Never
  edit them: `yarn sync:translate` (and `yarn check:vendor`).
- `test/`: vitest (`test/dom/` runs in jsdom). `e2e/`: Playwright (`e2e/fixtures` come
  from the Worker's own code: `worker/make-fixtures.ts`).

## Commands

```sh
yarn typecheck && yarn test && yarn test:e2e   # all of them before a push
yarn dev                                       # rebuilds on change, serves dist + Functions on :8788; needs .dev.vars
```

`yarn test:e2e` builds the app and starts `wrangler pages dev` and the mock services
itself. Each test gets its own visitor address (the rate limit counts per address).

## Conventions and traps

- **LF line endings, always.** No raw invisible characters in source (zero-width
  space, U+2028/9, BOM): write them as escapes (`\u200b`). A heredoc or an editor can
  turn an escape into the raw character; check with a scan before committing.
- **Erasable TypeScript only** (`erasableSyntaxOnly`): no parameter properties, enums or
  namespaces, so Node can run a `.ts` file directly. Imports of `.ts` files name the
  extension.
- **The pages are in iframes**, so their nodes are from another realm: use `nodeType`,
  never `instanceof`, on them (`src/lib/selection.ts`).
- **`ChipEditor` is delicate.** A browser edits a contenteditable with non-editable chips
  badly where they meet. It keeps a zero-width guard character on the chip side of every
  text node beside a chip, does anything that touches a chip itself, and keeps its own
  undo. Caret-from-point is wrong in the middle of a drag (the drop position comes from
  character geometry). After a change there, run `e2e/editor.spec.ts`: it covers
  retyping a link's words, deleting them, select all, drag, undo, paste and IME.
- **Everything a stranger types goes into the issue inside code spans** (`code()` in
  `shared/issue.ts`), and the fence around the YAML is longer than any in its content.
  Keep it so (`test/issue.test.ts` checks).
- Playwright's mouse can't drag across a sandboxed (`allow-same-origin`) iframe: it
  waits for the button to come up. Tests set a selection there and send the mouse-up
  (`selectPhrase`); double and triple clicks are real.
- No secret reaches the browser: `TRANSLATIONS_TOKEN`, `GITHUB_TOKEN` and
  `TURNSTILE_SECRET` are read only in `server/`. `e2e/notes.spec.ts` checks the
  responses and the built files.

## Git

Author commits as Matthew Rathbone, with no Claude co-author or trailer. Pull request
titles are short (about 80 characters) and the body is a few bullets of simple 80
character lines.
