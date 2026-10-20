# Changes for the translation Worker

The review app needs one endpoint the translation Worker (`workers/translate` in
[beekeeper-studio/web](https://github.com/beekeeper-studio/web)) doesn't have:
`GET /_translations/annotated?lang=es&path=/pricing/`. This repository doesn't change
`beekeeper-studio/web`, so the change is a patch.

`annotated-endpoint.patch` is against `91ba7977`, the tip of
[web#599](https://github.com/beekeeper-studio/web/pull/599) (the Worker is not on
`master` yet). From a checkout of that branch:

```sh
git apply /path/to/translation-review-app/worker/annotated-endpoint.patch
cd workers/translate
yarn install
yarn test               # 74 tests: the Worker's 58, and 16 new
yarn typecheck
yarn test:integration   # 13 tests on `wrangler dev`, one of them new
```

If it doesn't apply cleanly because the branch has moved, apply it with `git apply
--3way`; the change is small and local.

## What it adds

- `src/annotate.ts`: `annotate(html, resolved, layer)`. Parses the live English page
  twice, gives every segment an id by one walk over each (so they match), applies the
  stored translations to the second tree with the Worker's own `apply()`, and wraps bare
  text segments in `<span data-seg>`. It returns `{ english, translated, segments }`. A
  segment is a distinct (scope, key), with `id`, `key`, `kind` (`html`, `text`, `attr`
  or `head`), `where`, `scope`, `source`, `translation`, and for an explicit one the
  `entryPath` of the entry that wins (an exact url, a glob or `*`), which is where a
  correction goes. A segment the stored copy doesn't know (the English changed since) is
  `english`, untranslated.
- `src/api.ts`: the `annotated` route behind the same bearer token as the others. It
  answers 404 with `<path> is not translated yet in <lang>` while there is no copy
  (and for an unknown language or page), 409 with no manifest, 502 if the English page
  isn't available.
- Tests: `test/annotate.test.ts` (the ids on both sides match; every segment `export`
  returns has one; attribute and head segments are listed but not in the markup; the
  same English twice is one id on both elements; a translation that moves a link's text
  keeps its paragraph's id), `test/annotated-api.test.ts` (the route's statuses, with
  fakes for KV, R2 and the assets) and a case in `test/integration/worker.test.ts` on
  `wrangler dev`.
- `CLAUDE.md`: how issues from the review app are applied ("Translated Pages", "Day to
  day").
- `_headers`: `Access-Control-Allow-Origin: https://translate.beekeeperstudio.io` on
  `/assets/*`. The review app shows the site's pages from its own origin, and a web font
  only loads into another origin's page with this.

## The fixtures

`e2e/fixtures/*.json` (what the browser tests' mock Worker answers) were made by the
Worker's own code, with `make-fixtures.ts`:

```sh
node --experimental-strip-types worker/make-fixtures.ts --worker <web>/workers/translate
```

(with the patch applied there, and `yarn install` run). Run it again, and commit the
result, if the endpoint's output changes shape.
