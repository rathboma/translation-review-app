import type { Note, Report } from "../shared/types.ts";
import { applyFor } from "../shared/apply.ts";

export function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    lang: "es",
    path: "/pricing/",
    key: "Pay once, use the paid features forever.",
    scope: null,
    source: "generated",
    kind: "html",
    where: 'p, under "Pricing"',
    current: "Paga una vez, usa las funciones de pago para siempre.",
    new: "Paga una sola vez y usa las funciones de pago para siempre.",
    ...overrides,
  };
}

export function report(overrides: Partial<Note> = {}, extra: Partial<Report> = {}): Report {
  const n = note(overrides);
  return {
    note: n,
    fingerprint: "3f2a9c",
    stale: false,
    warnings: [],
    apply: applyFor({ lang: n.lang, path: n.path, key: n.key, scope: n.scope, source: n.source, translation: n.new }),
    ...extra,
  };
}

import yaml from "js-yaml";

// The machine-readable block of an issue body, parsed the way an agent would.
export function machineNotes(body: string): any {
  const match = /(`{3,})yaml\n([\s\S]*?)\n\1\n/.exec(body);
  if (!match) throw new Error("no yaml block in the issue body");
  return yaml.load(match[2]);
}
