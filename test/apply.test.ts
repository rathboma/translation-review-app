import { test } from "vitest";
import assert from "node:assert/strict";
import { applyFor, scopeLabel } from "../shared/apply.ts";

const base = { lang: "es", path: "/pricing/", key: "Pay once.", scope: null, translation: "Paga una vez." };

test("common: set the string under its scope, in the language's json file", () => {
  assert.deepEqual(applyFor({ ...base, path: "/", key: "Blog", scope: "footer", source: "common", translation: "Blog técnico" }), {
    action: "set-common",
    file: "bin/translations/common/es.json",
    set: ["footer", "Blog", "Blog técnico"],
  });
});

test("common without a scope cannot be applied", () => {
  assert.throws(() => applyFor({ ...base, source: "common" }), /scope/);
});

test("explicit: replace the entry that wins, which may be a glob", () => {
  assert.deepEqual(applyFor({ ...base, source: "explicit", entryPath: "/pricing/**" }).action, "replace-explicit");
  assert.deepEqual(applyFor({ ...base, source: "explicit", entryPath: "*" }), {
    action: "replace-explicit",
    file: "bin/translations/explicit/es.yml",
    entry: { path: "*", en: "Pay once.", es: "Paga una vez." },
  });
  // Without the entry's path (an older Worker) the page's is the best guess.
  assert.deepEqual((applyFor({ ...base, source: "explicit" }) as any).entry.path, "/pricing/");
});

test("generated and english: add an explicit entry for the page, keyed by the language code", () => {
  for (const source of ["generated", "english"] as const) {
    assert.deepEqual(applyFor({ ...base, lang: "pt-br", source, translation: "Pague uma vez." }), {
      action: "add-explicit",
      file: "bin/translations/explicit/pt-br.yml",
      entry: { path: "/pricing/", en: "Pay once.", "pt-br": "Pague uma vez." },
    });
  }
});

test("scopes have names for people", () => {
  assert.equal(scopeLabel("footer"), "the site footer");
  assert.match(scopeLabel("brand-new"), /"brand-new"/);
});
