# translation-review

**translate.beekeeperstudio.io**: a human translator reads the machine-translated
copies of beekeeperstudio.io next to the English, marks text that should change,
writes a better translation, and submits their notes as a GitHub issue on
`beekeeper-studio/web`. Each note says exactly which string it replaces, in a form
an agent or a person can apply without searching. The app never changes a
translation itself.

The copies are made by the Worker in `workers/translate/` in
[beekeeper-studio/web](https://github.com/beekeeper-studio/web) (see "Translated
Pages" in its `CLAUDE.md`). This app only reads them, through the Worker's API, and
files issues. The original spec is in [`docs/spec.md`](docs/spec.md).

## How it works

```
browser ──► Cloudflare Pages ──── static frontend (Vue 3, Vite)        src/
                 │
                 └── Pages Functions                                   functions/ → server/
                       GET  /api/manifest   languages, pages, glossary, Turnstile site key
                       GET  /api/page       both pages, made safe to show, with their segments
                       POST /api/submit     Turnstile, limits, lint, live check, GitHub issues
                          │            │
        translation Worker┘            └─► GitHub (issues: write on one repo)
        (bearer token)                     KV `REVIEWERS` (email by issue number, rate limit)
```

- **A segment** is one translatable string of a page: the inner html of a text
  element, a bare text node, an attribute (`alt`, `title`...) or a head field. Its
  **key** is its whitespace-normalized English. Each segment has a **source**
  (`explicit`, `common`, `generated`, `english`) saying where its current translation
  lives, which decides how a correction is applied.
- **Both pages carry the same `data-seg="<id>"`** on the element of every segment.
  The Worker's `GET /_translations/annotated` makes them (see "The Worker's side").
  `/api/page` fetches that and makes both pages safe to show: scripts, handlers,
  `noindex`, analytics and `<noscript>` are removed, a `<base>` is added so styles and
  images load from the site, and the hover and selected states are injected
  (`server/sanitize.ts`). The frontend shows each in `<iframe srcdoc
  sandbox="allow-same-origin">`: no scripts run in them, and the app reads
  selections and clicks from outside.
- **A note** is the *whole* new translation of one segment, with the language, page,
  key, scope, source, what the translator saw, and an optional comment. Notes are
  kept in `localStorage` across pages, languages and days until they are submitted.
- **The editor** (`src/components/ChipEditor.vue`) shows an html translation as text
  with its inline tags as chips. A link or bold can be dragged (or moved with
  Alt+arrows) but not deleted or broken; replacing a selection that has chips in it
  replaces the text and leaves the chips. Japanese IME input works.
- **Submitting** (`server/submit.ts`): rate limit, Turnstile, the shape of the
  submission (at most 100 notes, strings under 5,000 characters), then every new
  translation through the Worker's own lint (`vendor/translate/`) and a check of
  its own that the tags are nested as in the English (the lint compares tags as a
  list, so it can't see a link closed before it is opened). Errors are
  returned per note and nothing is filed while any note has one. Then each page's
  live data is fetched again: a note whose English has gone is filed as **stale**,
  and how a correction is applied is worked out from the string's source *now*.
  One issue is filed per language (more if the body would pass GitHub's limit), with
  the labels `translation` and `lang:<lang>`.
- **Privacy.** The repository is public: the issue shows the translator's **name
  only**. Their email is stored in KV under the issue number
  (`{ name, email, issues, at }`) for the owner to get in touch, and is never put in an
  issue or sent to GitHub. The sign-in screen says so.

## Applying a submission

Each issue ends with these steps, and a YAML block with one entry per note:

```yaml
notes:
  - path: /pricing/
    key: "Pay once, use the paid features forever."
    scope: null
    source: generated
    where: "p, under \"Pricing\""
    fingerprint: "3f2a…"
    current: "Paga una vez, usa las funciones de pago para siempre."
    new: "Paga una sola vez y usa las funciones de pago para siempre."
    comment: "\"una sola vez\" reads more naturally."
    apply:
      action: add-explicit
      file: bin/translations/explicit/es.yml
      entry: { path: /pricing/, en: "Pay once, use the paid features forever.", es: "Paga una sola vez y usa las funciones de pago para siempre." }
```

`apply.action` is one of:

| source | action | what to do in `beekeeper-studio/web` |
|---|---|---|
| `common` | `set-common` | `common[<scope>][<key>]` in `bin/translations/common/<lang>.json` (changes the string on every page with that include; keep the file sorted by scope) |
| `explicit` | `replace-explicit` | in `bin/translations/explicit/<lang>.yml`, set the `<lang>` value of the entry whose `path` and `en` match (`path` is the entry that wins, which may be a glob or `*`) |
| `generated`, `english` | `add-explicit` | append the entry to `bin/translations/explicit/<lang>.yml`, as `bin/translations.mjs pin` does |

Then: skip notes marked `stale: true` (and say so on the issue), run `node
bin/translations.mjs lint` (it must pass), and open a pull request that closes the
issue. The next deploy renders the affected pages again. (`worker/annotated-endpoint.patch`
adds these steps to web's `CLAUDE.md`, "Translated Pages".)

Everything a stranger typed appears in the issue **inside code spans** (no
`@mentions`, no `#123` links, no markdown or html of theirs), and the YAML block's fence
cannot be closed by its own content.

## The Worker's side

The app needs one endpoint the Worker doesn't have yet:
`GET /_translations/annotated?lang=es&path=/pricing/`. It lives in
`beekeeper-studio/web`, which this repo does not change, so it is delivered as a patch:
[`worker/annotated-endpoint.patch`](worker/annotated-endpoint.patch), made against the
tip of [web#599](https://github.com/beekeeper-studio/web/pull/599) (`91ba7977`, where
the Worker lives until it merges). See [`worker/README.md`](worker/README.md) to apply
it. It adds `src/annotate.ts`, the route in `src/api.ts`, 16 unit tests and one
integration test (all of the Worker's own tests pass with it: 74 unit, 13 integration),
the notes in web's `CLAUDE.md`, and an `Access-Control-Allow-Origin` header on the
site's `/assets/*` so fonts load in the review pages.

The ids on both sides are assigned by one walk over each of two parses of the live
English page, and the copy is that second tree with its translations applied (the
Worker's own `apply()`). It is **not** the stored copy walked again: a translation that
moves a link's text into the link would stop its paragraph being a segment and shift
every id after it. A segment is a distinct (scope, key): the same English twice on a
page has one id, on every element that holds it, because a correction changes both.

## Develop

```sh
yarn install
yarn dev            # rebuilds on change, serves dist + the Functions on :8788; needs .dev.vars (.dev.vars.example)
yarn typecheck      # vue-tsc (app), tsc (server, e2e)
yarn test           # vitest: shared logic, the Functions with fake services, selection in jsdom
yarn test:e2e       # Playwright on `wrangler pages dev` with mocks of the Worker, GitHub and Turnstile
yarn check:vendor   # vendored lint files are as they were synced
```

The browser tests build the app and serve it on `wrangler pages dev` (the real
Functions, a local KV) against `e2e/mock-services.ts`, which answers as the Worker
(from `e2e/fixtures/*.json`, made by the Worker's own `render()` and `annotate()`:
`worker/make-fixtures.ts`), GitHub and Turnstile. They cover sign in, picking a page,
selecting on the translated side (and double and triple clicks), the chip editor
(retyping a link's words, deleting and backspacing them, select all, protection of the
chips, drag, Alt+arrows, undo, paste, IME), hidden text, every note source and the
YAML it files, refusal with the reason next to the note, stale notes, GitHub failing
part way, the rate limit, scroll sync, and that no secret reaches the browser. Chromium
is `CHROMIUM_PATH`, or `/opt/pw-browsers/chromium` if it exists, or Playwright's own.

**The Worker's lint is vendored.** `functions` lint every note with the Worker's
`lint.ts` (and the `text.ts` it imports), which can't be imported from another
repository, so `vendor/translate/` holds them byte for byte, with where they came from
in `SOURCE.json`. `yarn sync:translate [--from <web checkout>] [--ref <ref>]` updates
them; `yarn check:vendor` fails if they were edited by hand, and with `--upstream` also
if the Worker's have changed (CI runs that weekly).

## Setup, once

1. **Pages project** `translation-review`, production branch `main`:
   `npx wrangler pages project create translation-review --production-branch main`.
   Then a custom domain, `translate.beekeeperstudio.io` (dashboard → the project → Custom
   domains). Create the project before the first push to `main`: CI's deploy fails without it.
2. **KV**, two namespaces: `npx wrangler kv namespace create REVIEWERS` (production) and
   one more for previews (`... create REVIEWERS-preview`). Put the ids in `wrangler.toml`:
   the top-level `[[kv_namespaces]]` and `[[env.preview.kv_namespaces]]`. They hold
   reviewers' details and the per-IP submission log, hashed.
3. **Turnstile**: a widget for `translate.beekeeperstudio.io` and `translation-review.pages.dev`
   (previews are subdomains of it; if the widget refuses one, add its hostname). Its site key goes in `wrangler.toml`
   (`TURNSTILE_SITE_KEY`, public, in `[vars]` and `[env.preview.vars]`). The committed
   key is Cloudflare's always-passes test key, which protects nothing: replace it.
4. **Secrets**, with `npx wrangler pages secret put <NAME> --project-name
   translation-review`:
   - `TRANSLATIONS_TOKEN`: the Worker's bearer token (the same as its own
     `TRANSLATIONS_TOKEN` secret)
   - `GITHUB_TOKEN`: a fine-grained token limited to **Issues: read and write on
     `beekeeper-studio/web`**, nothing else
   - `TURNSTILE_SECRET`: the widget's secret key

   Secrets are not in `wrangler.toml`, and a preview has its own: add them under the
   project's Settings → Variables and secrets → Preview (that command sets production's).
   A preview with no `GITHUB_TOKEN` cannot file anything, which is the safe way to leave it.
   If you give it one, make it for the scratch repository.
5. **Variables** in `wrangler.toml`, which is the source of truth (the dashboard shows
   them but won't edit them): `TRANSLATIONS_URL` (default `https://www.beekeeperstudio.io`)
   and `GITHUB_REPO` (`beekeeper-studio/web`), and for previews `GITHUB_REPO` is a scratch
   repository (`[env.preview.vars]`: replace `OWNER/SCRATCH-REPO`).
6. **GitHub Actions** secrets `CLOUDFLARE_API_TOKEN` (Pages: edit) and
   `CLOUDFLARE_ACCOUNT_ID`. `.github/workflows/ci.yml` tests every push and pull
   request, deploys `main` to production and each pull request to a preview, and
   comments the preview's url.
7. In `beekeeper-studio/web`: apply `worker/annotated-endpoint.patch` and deploy the
   Worker, or the app can't show any page.

The app is `noindex` (`X-Robots-Tag` in `public/_headers`, `robots.txt`) and has no
analytics. Its Content-Security-Policy is in `public/_headers`: scripts only from the
app and Turnstile; the pages shown get styles, images and fonts from the site.

## Limits, and what is not solved

- **One submission holds at most 100 notes and 200,000 characters of note text** (which
  bounds the work of checking it, and the issues it can become: about eight). The queue
  can hold more: a submit sends as many from the start as fit, and says so, and the rest
  stay for the next.
- **The rate limit is a sliding hour per visitor** (an IPv4 address, or an IPv6 /64),
  in KV. A submission takes one of the five when the human check passes, and gives it
  back unless something is filed, so refused notes and GitHub being down cost nothing.
  KV has no atomic update: a lock in the isolate serializes a burst it serves, but two
  isolates can still read the same count, so this stops a person, not a determined script.
- **A note whose English has gone from the page is filed as stale** (and so are a page's
  notes if the Worker has no copy of it at that moment). The translator is told how many
  were, in the answer. Anything about such a note that the browser sent (its scope, its
  text) can't be checked against the page, so it is only ever shown inside code spans.
- **A translator's name is on a public issue**, and the browser's queue is theirs: "Not
  you?" asks first, and then deletes the unsent notes, so the next person at the
  browser doesn't send them under their own name.
- **A zero-width space in a translation is dropped** when that translation is edited: the
  editor uses one as a place to put the caret beside a tag, and cannot tell it from the
  one in the text. Any other entity (`&mdash;`, `&nbsp;`) comes back as the character.
- **If GitHub times out after creating an issue**, the response says the notes are still
  queued, and sending them again files a second issue. GitHub offers no way to make the
  request idempotent.
- `GET /api/page` is not cached or authenticated (the Worker fetches and parses the live
  page on each request); put Cloudflare's rate limiting rules in front if that matters.
- A page with thousands of segments gets slower to hover (about 35 ms a move at 3,000; at
  600 it is not measurable).
- Not run against the real services: Turnstile, GitHub and the deployed Worker are mocked
  in every test, and the real pages of beekeeperstudio.io were not available, so how they
  look with their scripts removed is unseen.

## Differences from the spec

- **A repository of its own.** The root is the Pages project, not
  `apps/translation-review/` of `beekeeper-studio/web`; nothing here changes that
  repository (so no `exclude` in its `_config.yml`). It deploys on pushes to `main`
  (this repo's default branch), not on changes to `workers/translate/src/**`.
- **The Worker's lint is vendored, not imported** (see above), and **the Worker
  endpoint is a patch**, because of that split.
- **The issue's wording**: the translator's English, "Now", "New", comment and name are
  in code spans (a public repository, text from strangers); "Lint warnings" appears
  only when there are some; `apply` gets an `action` field, and a note whose current
  translation changed since it was written has `current_now`. `where` is the Worker's
  own (`p, under "Pricing"`).
- **Segments are distinct (scope, key)**, so one id covers repeated English; head fields
  have `kind: "head"`.
- **A note must change something**, except for a string the copy left in English (a
  translator can confirm that English is right: that adds an explicit entry that ends
  the page being partial). A translation with tags but no words is refused (the Worker's
  lint checks markup, not words).
- **Rate limit**: a sliding hour per address (KV; Cloudflare's rate limiting binding
  only counts over 10 or 60 seconds), charged when a submission is about to be filed, so
  fixing lint errors is free.
- **Partial failure**: if GitHub fails after some issues are filed, the response lists
  which notes were filed, and they leave the queue, so a retry doesn't file them twice.
- **Not done**: `bin/translations.mjs apply-issue` (the "nice to have"); the issue's
  YAML is made to be applied by hand or by an agent. The token for GitHub is a
  fine-grained token, not a GitHub App.
- Selecting across paragraphs is refused ("Select within one paragraph"), as the spec
  suggests for a first version.
