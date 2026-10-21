> **Moved.** This app now lives in [beekeeper-studio/web](https://github.com/beekeeper-studio/web)
> at `/admin/translate/` of the site itself (`pages/admin/translate.html`,
> `_javascript/src/vue/apps/translation-review/`, `workers/translate/src/review/`): see
> "Translation Review" in its `CLAUDE.md`. On the site's own origin the pages' fonts, images
> and styles load without CORS, and the Pages Functions here are not needed. This repository
> is kept for its history only.

# translation-review

**translate.beekeeperstudio.io**: a human translator reads the machine-translated
copies of beekeeperstudio.io next to the English, marks text that should change,
writes a better translation, and submits their notes as a GitHub issue on
`beekeeper-studio/web`. Each note says exactly which string it replaces, in a form
an agent or a person can apply without searching. The app never changes a
translation itself.

The copies are made by the Worker in `workers/translate/` in
[beekeeper-studio/web](https://github.com/beekeeper-studio/web) (see "Translated
Pages" in its `CLAUDE.md`), and served by the site under `/es/`, `/pt-br/` and `/ja/`.
This app needs nothing from that Worker but its pages: it reads the English page
(`/pricing/`) and its copy (`/es/pricing/`) from the site like any visitor, with no
token. The original spec is in [`docs/spec.md`](docs/spec.md).

## How it works

```
browser ──► Cloudflare Pages ──── static frontend (Vue 3, Vite)        src/
                 │
                 └── Pages Functions                                   functions/ → server/
                       GET  /api/config   the default site, the Turnstile site key
                       GET  /api/page     both pages, made safe to show, with their segments
                       POST /api/submit   Turnstile, limits, lint, GitHub issues
                          │            │
     the site (any address)┘            └─► GitHub (issues: write on one repo)
     /pricing/ and /es/pricing/             KV `REVIEWERS` (email by issue number, rate limit)
```

- **The site, the language and the page** are what a translator picks: the language
  from a list (`es`, `pt-br`, `ja`), the page by typing its path (`/pricing/`: an
  address pasted from the browser works too, a copy's included), and the site, which
  is `https://www.beekeeperstudio.io` unless a link says `?site=<address>` or an address
  is typed in the bar, to review a preview or another build. There is no list of pages
  and no manifest: a page that isn't there says so. The Functions fetch
  `<site><path>` and `<site>/<lang><path>`, with nothing sent along.
- **A segment** is one translatable string of a page: the inner html of a text
  element, a bare text node, an attribute (`alt`, `title`...) or a head field. Its
  **key** is its whitespace-normalized English. The two pages are cut into segments
  by the Worker's own code (`vendor/translate/`, below), and the nth segment of the copy
  is taken to be the nth of the English: the copy is the English page with its text
  replaced. When they don't line up (the English changed since the copy was made) nothing
  is paired, the translated page says so, and no segment has a translation: one extra
  paragraph would otherwise put every translation after it on the wrong English
  (`server/annotate.ts`).
- **Both pages carry the same `data-seg="<id>"`** on the element of every segment
  (a bare text node is wrapped in a `<span>`). `/api/page` makes both pages safe to
  show: scripts, handlers, `noindex`, analytics and `<noscript>` are removed, a
  `<base>` is added so styles and images load from the site, and the hover and selected
  states are injected (`server/sanitize.ts`). The frontend shows each in `<iframe srcdoc
  sandbox="allow-same-origin">`: no scripts run in them, and the app reads
  selections and clicks from outside.
- **A note** is the *whole* new translation of one segment, with the language, page,
  key, scope, what the translator saw, and an optional comment. Notes are
  kept in `localStorage` across pages, languages and days until they are submitted.
- **The editor** (`src/components/ChipEditor.vue`) shows an html translation as text
  with its inline tags as chips. A link or bold can be dragged (or moved with
  Alt+arrows) but not deleted or broken; replacing a selection that has chips in it
  replaces the text and leaves the chips. Japanese IME input works.
- **Submitting** (`server/submit.ts`): rate limit, Turnstile, the shape of the
  submission (at most 100 notes, strings under 5,000 characters), then every new
  translation through the Worker's own lint (without its glossary, which the app can't
  read) and a check of its own that the tags are nested as in the English (the lint
  compares tags as a list, so it can't see a link closed before it is opened). Errors are
  returned per note and nothing is filed while any note has one. Nothing is checked
  against the site again: the notes say what the translator saw. One issue is filed per
  language (more if the body would pass GitHub's limit), with the labels `translation`
  and `lang:<lang>`.
- **Privacy.** The repository is public: the issue shows the translator's **name
  only**. Their email is stored in KV under the issue number
  (`{ name, email, issues, at }`) for the owner to get in touch, and is never put in an
  issue or sent to GitHub. The sign-in screen says so.

## Applying a submission

Each issue ends with these steps, and a YAML block with one entry per note:

```yaml
lang: es
site: "https://www.beekeeperstudio.io"
notes:
  - path: /pricing/
    key: "Pay once, use the paid features forever."
    scope: null
    where: "p, under \"Pricing\""
    current: "Paga una vez, usa las funciones de pago para siempre."
    new: "Paga una sola vez y usa las funciones de pago para siempre."
    comment: "\"una sola vez\" reads more naturally."
    apply:
      action: set-explicit
      file: bin/translations/explicit/es.yml
      entry: { path: /pricing/, en: "Pay once, use the paid features forever.", es: "Paga una sola vez y usa las funciones de pago para siempre." }
```

`apply.action` is one of:

| where the string is | action | what to do in `beekeeper-studio/web` |
|---|---|---|
| a shared include (`scope` is set: header, footer...) | `set-common` | `common[<scope>][<key>]` in `bin/translations/common/<lang>.json` (changes the string on every page with that include; keep the file sorted by scope) |
| anywhere else | `set-explicit` | in `bin/translations/explicit/<lang>.yml`, set the `<lang>` value of the entry whose `path` and `en` match, or append the entry, as `bin/translations.mjs pin` does |

The app can't see which of the Worker's layers a translation came from (an explicit
entry, a common one, or one the model made), so whoever applies a note checks that
nothing more specific overrides what they change. A note whose English (`key`) is no
longer on the page is out of date: skip it and say so on the issue. Then run `node
bin/translations.mjs lint` (it must pass), and open a pull request that closes the
issue. The next deploy renders the affected pages again.

Everything a stranger typed appears in the issue **inside code spans** (no
`@mentions`, no `#123` links, no markdown or html of theirs), and the YAML block's fence
cannot be closed by its own content.

## Develop

```sh
yarn install
yarn dev            # rebuilds on change, serves dist + the Functions on :8788; needs .dev.vars (.dev.vars.example)
yarn typecheck      # vue-tsc (app), tsc (server, e2e)
yarn test           # vitest: shared logic, the Functions with fake services, selection in jsdom
yarn test:e2e       # Playwright on `wrangler pages dev` with mocks of the site, GitHub and Turnstile
yarn check:vendor   # vendored Worker files are as they were synced
```

The browser tests build the app and serve it on `wrangler pages dev` (the real
Functions, a local KV) against `e2e/mock-services.ts`, which serves a small site (the
pages in `e2e/fixtures/*.html`, made by the Worker's own `render()`:
`scripts/make-fixtures.ts`), GitHub and Turnstile. They cover sign in, typing a page and
a site, selecting on the translated side (and double and triple clicks), the chip editor
(retyping a link's words, deleting and backspacing them, select all, protection of the
chips, drag, Alt+arrows, undo, paste, IME), hidden text, the YAML each kind of note
files, refusal with the reason next to the note, a copy that doesn't line up, GitHub
failing part way, the rate limit, scroll sync, and that no secret reaches the browser.
Chromium is `CHROMIUM_PATH`, or `/opt/pw-browsers/chromium` if it exists, or Playwright's own.

**The Worker's code is vendored.** The Functions cut pages into segments and lint notes
with the Worker's own files (`segments.ts`, `lint.ts` and what they import), which can't
be imported from another repository, so `vendor/translate/` holds them byte for byte, with
where they came from in `SOURCE.json`. `yarn sync:translate [--from <web checkout>]
[--ref <ref>]` updates them; `yarn check:vendor` fails if they were edited by hand, and
with `--upstream` also if the Worker's have changed (CI runs that weekly).

## Setup, once

1. **Pages project** `translation-review`, from the dashboard (Workers & Pages → Create →
   Pages → Connect to Git): this repository, production branch `main`, build command
   `yarn build`, output directory `dist`. Cloudflare builds and deploys every push to
   `main`; `.node-version` picks Node 22. Under Settings → Builds → Branch control set
   preview branches to None: there are no previews, and one would share production's KV
   and settings. Then a custom domain, `translate.beekeeperstudio.io` (the project →
   Custom domains). Don't create the project with `wrangler pages project create`: that
   makes a Direct Upload project, which can't be connected to Git afterwards.
2. **KV**: `npx wrangler kv namespace create REVIEWERS`. Put the id in
   `wrangler.toml` (`[[kv_namespaces]]`, binding `REVIEWERS`: the binding is the name the
   code reads, whatever the namespace is titled). It holds reviewers' details and the
   per-IP submission log, hashed.
3. **Turnstile**: a widget for `translate.beekeeperstudio.io`. Its site key goes in
   `wrangler.toml` (`TURNSTILE_SITE_KEY`, public); its secret is `TURNSTILE_SECRET` below.
4. **Secrets**, with `npx wrangler pages secret put <NAME> --project-name
   translation-review`:
   - `GITHUB_TOKEN`: a fine-grained token limited to **Issues: read and write on
     `beekeeper-studio/web`**, nothing else
   - `TURNSTILE_SECRET`: the widget's secret key
5. **Variables** in `wrangler.toml`, which is the source of truth (the dashboard shows
   them but won't edit them): `TRANSLATIONS_URL` (the default site,
   `https://www.beekeeperstudio.io`) and `GITHUB_REPO` (`beekeeper-studio/web`). To try
   the app without filing real issues, point `GITHUB_REPO` at a scratch repository (and the
   token at it) first.

Nothing is needed in `beekeeper-studio/web`, and no token for it. The copies have to
exist on the site (once the Worker is deployed there), or be somewhere else: a link with
`?site=https://pr-599-beekeeper-web.<account>.workers.dev` reviews a preview of it.

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
- **Nothing the browser sends is checked against the site**: not that the English is on
  the page, not the current translation, not the scope. Whatever a note says is shown only
  inside code spans, and whoever applies it sees if the page has changed.
- **The site can be any address**, from a link or the bar, and the Functions fetch it (and
  show it, with its scripts removed, in a sandboxed frame). There is no secret to send it,
  but it makes the app a fetcher of pages for whoever has the link, and a stranger's page
  can be reviewed and filed as notes: fine for an app shared with a few translators, not
  for the open web.
- **The pages are paired by position** (see above), which holds while the copy is the
  English page with its text replaced. A copy made from an older build, or one that
  rewrote the markup, doesn't line up and shows no translations.
- **A translator's name is on a public issue**, and the browser's queue is theirs: "Not
  you?" asks first, and then deletes the unsent notes, so the next person at the
  browser doesn't send them under their own name.
- **A zero-width space in a translation is dropped** when that translation is edited: the
  editor uses one as a place to put the caret beside a tag, and cannot tell it from the
  one in the text. Any other entity (`&mdash;`, `&nbsp;`) comes back as the character.
- **If GitHub times out after creating an issue**, the response says the notes are still
  queued, and sending them again files a second issue. GitHub offers no way to make the
  request idempotent.
- `GET /api/page` is not cached or authenticated (it fetches and parses two pages on each
  request); put Cloudflare's rate limiting rules in front if that matters.
- A page with thousands of segments gets slower to hover (about 35 ms a move at 3,000; at
  600 it is not measurable).
- Not run against the real services: Turnstile and GitHub are mocked in every test, and
  the pages are fixtures made by the Worker's code, not the real pages of
  beekeeperstudio.io, so how those look with their scripts removed is unseen.

## Differences from the spec

- **A repository of its own.** The root is the Pages project, not
  `apps/translation-review/` of `beekeeper-studio/web`; nothing here changes that
  repository (so no `exclude` in its `_config.yml`). It deploys on pushes to `main`
  (this repo's default branch), not on changes to `workers/translate/src/**`.
- **The Worker's code is vendored, not imported** (see above), and **the app doesn't
  call the Worker at all**: the spec had it read the manifest and a new `annotated`
  endpoint; it reads the site's pages instead (no token, no patch, no page list), and cuts
  them into segments itself.
- **No source, no stale notes.** The notes don't say whether a translation is explicit,
  common or generated (the app can't tell), so `apply` is `set-common` for a shared
  include and `set-explicit` for the rest, and the applier checks for overrides. Notes
  aren't checked against the site when they are submitted, so there is no `stale`, no
  `fingerprint`, and no `current_now`.
- **The site is a parameter**, to review a preview or another build.
- **The issue's wording**: the translator's English, "Now", "New", comment and name are
  in code spans (a public repository, text from strangers); "Lint warnings" appears
  only when there are some; `apply` gets an `action` field, and the issue says which
  site the pages were on. `where` is the Worker's own (`p, under "Pricing"`).
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
