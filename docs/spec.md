# Translation review app: spec

> The spec this app was built from, as it was in `beekeeper-studio/web`
> (`.claude-instructions/translation-review-app.md`, before it moved here).
> Where the build differs from it, README.md says so under "Differences from
> the spec". "This repo" and `apps/translation-review/` below are this
> repository's root.

A small standalone app at **translate.beekeeperstudio.io** where a human
translator reviews the machine-translated copies of beekeeperstudio.io side by
side with the English, marks text that needs changing, writes the better
translation, and submits their notes as a GitHub issue on
`beekeeper-studio/web`. Each note must say exactly which string it replaces,
in a form an agent (or a person) can apply without guessing.

Read "Translated Pages" in `CLAUDE.md` first. The copies are made by the
Worker in `workers/translate/`; this app only reads them and files issues. It
never changes a translation itself.

## How translations are stored (what a note has to point at)

A copy is built from **segments**: the inner html of a text element (a `<p>`,
an `<li>`, a `<span>`...), a bare text node, an attribute (`alt`, `title`,
`placeholder`, `aria-label`, `data-tooltip`, submit `value`), or a head field
(title, meta description, structured data). A segment is identified by its
**key**: its whitespace-normalized English (`workers/translate/src/segments.ts`,
`text.ts`). Each segment's translation comes from one **source**, in this order:

| source | where it lives | how a correction is applied |
|---|---|---|
| `explicit` | `bin/translations/explicit/<lang>.yml` | edit that entry |
| `common` | `bin/translations/common/<lang>.json`, under the segment's **scope** (a shared include: header, footer, ...) | edit `common[<scope>][<key>]` |
| `generated` | Claude's output, stored by the Worker | add an explicit entry `{ path, en: <key>, <lang>: <new translation> }` |
| `english` | nothing (the copy is partial) | same as generated |

So every note must carry: language, page path, segment key (exact English),
scope (or none), source, current translation, new translation. That is
enough to apply it mechanically; `bin/translations.mjs pin` already writes the
explicit entry format.

## User flow

1. **Sign in.** Name and email (required), stored in `localStorage` so they
   aren't asked again. No accounts, no passwords.
2. **Pick a language and a page.** Language: es, pt-br, ja (from the
   manifest). Page: a searchable list of every translated page, from the
   manifest's `pages`. Deep links work: `/?lang=es&path=/pricing/`. Remember
   the last choice.
3. **Split view.** English page on the left, the translated copy on the right,
   both rendered as the real pages (styles and images included, scripts
   off), scrolling in sync by segment. Hovering a segment on either side
   highlights it and its counterpart on the other side.
4. **Mark text.** Select text on either side (or click a segment) and a note
   editor opens next to it, showing:
   - the English of the segment, and its current translation
   - where it is: the page, the element and heading (`where`), and the scope
     when it's a shared include ("This text is in the site footer: a change
     applies on every page")
   - a text box prefilled with the current translation, with the selected part
     selected, so they can retype just that part
   - an optional comment ("too formal", "wrong term for X")
   Inline markup (links, bold, code) is shown as non-editable chips in the
   text box, so they can move a link but not break or drop it.
5. **Text you can't select.** A "Hidden text" drawer lists the page's
   attribute and head segments (page title, meta description, image alt
   text, tooltips, structured data) with the same editor.
6. **Notes queue.** A panel along the bottom lists every note: page, English,
   current, new, comment. Each can be edited or deleted. The queue is kept in
   `localStorage`, across pages and languages, so a reviewer can work through
   several pages and come back the next day.
7. **Submit.** At any time, "Submit N notes" files them (see "Submitting").
   On success the queue is cleared and the issue links are shown. On failure
   the notes stay in the queue and the error is shown.

Mobile isn't a target: the split view needs a wide screen. Show a short
message below 900px.

## Architecture

- **Cloudflare Pages** project, static frontend plus **Pages Functions** for
  everything that needs a secret. Lives in this repo at
  `apps/translation-review/` (add `apps` to Jekyll's `exclude` in
  `_config.yml`). Its own `package.json`, like `workers/translate`.
- Frontend: Vue 3 + Vite + TypeScript (the site's own Vue apps are Vue 3), no
  UI framework needed. Keep it small.
- The Functions call the Worker's API on `https://www.beekeeperstudio.io`
  (configurable: `TRANSLATIONS_URL`) with the `TRANSLATIONS_TOKEN` secret, and
  GitHub with a token. The browser never sees either secret.

### Rendering the two pages

The pages can't be shown as cross-origin iframes: the app has to read
selections inside them. The Functions fetch both pages from the site and
serve them same-origin, already marked up with segment ids.

**Add one endpoint to the Worker** (`workers/translate/src/api.ts`, behind the
token like the others):

`GET /_translations/annotated?lang=es&path=/pricing/` returns

```json
{
  "lang": "es", "path": "/pricing/", "fingerprint": "…",
  "english": "<!DOCTYPE html>…",
  "translated": "<!DOCTYPE html>…",
  "segments": [
    { "id": "s12", "key": "Pay once.", "kind": "html", "where": "p (h2: Pricing)",
      "scope": null, "source": "generated", "translation": "Paga una vez." }
  ]
}
```

- `english` is the live English page and `translated` the current copy, both
  with `data-seg="<id>"` on every html segment's element. Text-node segments
  are wrapped in `<span data-seg="<id>">`. Ids are the same on both sides for
  the same segment, because both are segmented with the same library
  (`segments.ts`): segment the English page, then the copy is the same tree
  with translations applied (`translator.ts`'s `apply` walks the same
  segments in the same order), so ids can be assigned in one walk over each.
- Attribute and head segments are in `segments` (with `kind`) but not in the
  html: they go to the "Hidden text" drawer.
- `source` and `scope` come from the stored resolution (`store.resolved()`,
  what `export` returns).
- No copy yet: 404 with a clear message ("not translated yet").
- Write a test for it next to the Worker's other tests: the ids on both sides
  match, and every segment in `export` has one.

The Pages Function `GET /api/page?lang&path` calls it and then, for the
frontend: removes every `<script>` and inline event handler, adds a `<base
href="https://www.beekeeperstudio.io/">` so styles and images load from the
site, removes `noindex`/analytics tags it doesn't need, and injects a small
stylesheet for the hover and selected states. The frontend puts each html in
an `<iframe srcdoc>` with `sandbox="allow-same-origin"` (no `allow-scripts`),
and reads selections and clicks from the parent.

### Mapping a selection to a segment

- From a selection, walk up from the range's start container to the nearest
  `[data-seg]`. A selection spanning several segments makes one note per
  segment, or is refused with "select within one paragraph": pick the
  simpler one (refusing) for the first version.
- On the translated side, the selected text is a substring of the
  segment's translation: preselect it in the editor. On the English side,
  preselect the whole translation.
- The note always stores the **whole new translation of the segment**, not a
  substring edit. That's what gets applied.

## Submitting

`POST /api/submit` (Pages Function) with `{ name, email, notes[], turnstileToken }`.

The Function:

1. Verifies a **Cloudflare Turnstile** token (the form shows the widget).
2. Validates: at most 100 notes per submission, each note's fields present,
   strings under 5,000 characters, the language and path in the manifest.
3. **Lints every new translation** with the same rules the Worker uses
   (`workers/translate/src/lint.ts` with the manifest's glossary; import it,
   don't copy it). Errors (a dropped link, a changed price, a missing
   `{{ }}`...) are returned per note and shown in the queue for the
   translator to fix; nothing is filed while any note has an error. Warnings
   are included in the issue.
4. Re-fetches each page's annotated data and checks the segment still exists
   with the same English. Notes whose English is gone are marked "stale" in
   the issue rather than refused (the translator can't fix that).
5. Creates **one GitHub issue per language per submission** (split further if
   the body would pass GitHub's 65,536-character limit) on
   `beekeeper-studio/web`, with labels `translation` and `lang:<lang>`, via a
   GitHub App installation token or a fine-grained token limited to Issues:
   write on that repo (`GITHUB_TOKEN` secret).
6. Rate limits: at most 5 submissions per IP per hour (a KV counter or
   Cloudflare's rate limiting binding).

**Privacy.** The repo is public, so the issue shows the translator's
**name only**. The email is stored by the Function in a KV namespace keyed by
issue number (`{ name, email, issues, at }`), for the owner to contact them,
and is never put in the issue. Say this on the sign-in screen.

### Issue format

Title: `Translation notes (es): 7 notes from <name>`.

Body: a short human summary, then one section per note, then **one
machine-readable block** with everything an agent needs. Example:

````markdown
Translation notes from **María López** for **es** (Español), 2 notes on 2 pages.
Submitted with translate.beekeeperstudio.io.

### 1. /pricing/ · p (h2: Pricing) · generated
English: Pay once, use the paid features forever.
Now: Paga una vez, usa las funciones de pago para siempre.
New: Paga una sola vez y usa las funciones de pago para siempre.
Comment: "una sola vez" reads more naturally.

### 2. footer (every page) · common
English: Blog
Now: Blog
New: Blog técnico
Lint warnings: none

<details><summary>Machine-readable notes</summary>

```yaml
lang: es
submitted: 2026-10-21T10:14:00Z
notes:
  - path: /pricing/
    key: "Pay once, use the paid features forever."
    scope: null
    source: generated
    where: "p (h2: Pricing)"
    fingerprint: 3f2a…
    current: "Paga una vez, usa las funciones de pago para siempre."
    new: "Paga una sola vez y usa las funciones de pago para siempre."
    comment: "\"una sola vez\" reads more naturally."
    apply:
      file: bin/translations/explicit/es.yml
      entry: { path: /pricing/, en: "Pay once, use the paid features forever.", es: "Paga una sola vez y usa las funciones de pago para siempre." }
  - path: /pricing/
    key: "Blog"
    scope: footer
    source: common
    where: "a (footer)"
    current: "Blog"
    new: "Blog técnico"
    apply:
      file: bin/translations/common/es.json
      set: [footer, "Blog", "Blog técnico"]
```

</details>
````

`apply` is computed by the Function from `source`:
- `common` → set `common[<scope>][<key>]` in `common/<lang>.json` (it changes
  that string on every page that has the include; the human summary says so)
- `explicit` → replace the matching entry's `<lang>` value in
  `explicit/<lang>.yml` (match on `path` and `en`)
- `generated` / `english` → append an explicit entry (as `pin` does), path
  exact

### Applying a submission (for the agent or person picking it up)

Document this in the issue template's footer and in `CLAUDE.md`
("Translated Pages" → "Day to day"):

1. Read the YAML block. For each note, apply `apply` to the named file.
   Keep YAML entries in `explicit/<lang>.yml` in the existing format
   (`yaml.dump` with `forceQuotes`, as `pin` does); keep `common/<lang>.json`
   sorted by scope.
2. Skip notes marked stale, and say so on the issue.
3. Run `node bin/translations.mjs lint` (must pass).
4. Commit, open a PR that closes the issue. The next deploy re-renders the
   affected pages (their fingerprints change because the explicit and common
   entries that apply to them are part of the fingerprint).

Nice to have, not required for the first version: `node bin/translations.mjs
apply-issue <number>` doing steps 1 to 3.

## Configuration

Pages project `translation-review`, root `apps/translation-review`, custom
domain `translate.beekeeperstudio.io`. Secrets and variables:

- `TRANSLATIONS_URL` (default `https://www.beekeeperstudio.io`) and
  `TRANSLATIONS_TOKEN` (the Worker's token)
- `GITHUB_TOKEN` (Issues: write on `beekeeper-studio/web` only) and
  `GITHUB_REPO` (default `beekeeper-studio/web`)
- `TURNSTILE_SITE_KEY` (public) and `TURNSTILE_SECRET`
- KV binding `REVIEWERS` (name, email and issue numbers) and the rate limit

Deploy from GitHub Actions (`wrangler pages deploy`) on pushes to master that
touch `apps/translation-review/**` or `workers/translate/src/**` (it imports
the lint), with a per-PR preview like the site's.

The app itself is `noindex` (`X-Robots-Tag` in `_headers`) and has no
analytics.

## Tests

- Unit: selection → segment mapping (including a selection inside a link
  inside a paragraph), the editor's chip handling of inline tags (the html
  round-trips), issue body generation (snapshot), `apply` per source, splitting
  long submissions.
- The Worker's `annotated` endpoint, as above.
- End to end with Playwright (Chromium is at `/opt/pw-browsers/chromium`):
  against `wrangler pages dev` with the Worker's API and GitHub mocked, sign
  in, pick a page, select text on the translated side, write a note, submit,
  check the GitHub request body.

## Acceptance

- A translator with only the link can review any translated page in any
  language and file notes without help.
- Every filed note can be applied by following the YAML alone, with no
  searching, and the lint passes afterwards.
- No secret reaches the browser, no email reaches GitHub, and a submission
  with a broken translation (lost link, changed number) is refused with the
  reason shown next to the note.
