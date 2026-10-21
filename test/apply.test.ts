import { test } from "vitest";
import assert from "node:assert/strict";
import { applyFor, scopeLabel } from "../shared/apply.ts";

const base = { lang: "es", path: "/pricing/", key: "Pay once.", scope: null, translation: "Paga una vez." };

test("a string in a shared include: set it under its scope, in the language's json file", () => {
  assert.deepEqual(applyFor({ ...base, path: "/", key: "Blog", scope: "footer", translation: "Blog técnico" }), {
    action: "set-common",
    file: "bin/translations/common/es.json",
    set: ["footer", "Blog", "Blog técnico"],
  });
});

test("any other string: an explicit entry for the page, keyed by the language code", () => {
  assert.deepEqual(applyFor({ ...base, lang: "pt-br", translation: "Pague uma vez." }), {
    action: "set-explicit",
    file: "bin/translations/explicit/pt-br.yml",
    entry: { path: "/pricing/", en: "Pay once.", "pt-br": "Pague uma vez." },
  });
});

test("scopes have names for people", () => {
  assert.equal(scopeLabel("footer"), "the site footer");
  assert.match(scopeLabel("brand-new"), /"brand-new"/);
});
