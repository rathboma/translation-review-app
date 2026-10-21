// Checks a translation against its English key. Translators (people or
// models) rarely write bad prose; what they break is structure: a dropped
// <a href>, a translated url, a bare & where the key had &amp;, a changed
// price, a product name. Those are errors, and a generated translation with
// one is sent back to the model. Softer signs (a value identical to its key,
// a glossary term rendered differently, a wildly different length) are
// warnings.
import { BOUNDARY, CJK, escapeRegExp, length, strip, words } from "./text.ts";

export interface Glossary {
  keep?: string[];
  terms?: Record<string, Record<string, string | string[]>>;
}

export interface LintResult {
  errors: string[];
  warnings: string[];
}

const TAG = /<[^>]+>/g;
const URL = /(?:https?:\/\/|mailto:)[^ \t\n\v\f\r"'<>]+|[\w.+-]+@[\w-]+\.[\w.]+/g;
const NUMBER = /\d[\d,.]*\d|\d/g;
const BARE_AMPERSAND = /&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)/;
const LOWER_WORD = new RegExp(`${BOUNDARY}[a-z]{4,}${BOUNDARY}`, "u");

const isHtml = (str: string) => str.includes("<") || str.includes("&amp;");

// Tags with their attributes, normalized and sorted, so wrapping different
// words or reordering inline elements is fine but a lost link or a changed
// href is not.
function tags(str: string): string[] {
  return (str.match(TAG) ?? []).map((t) => t.replace(/[ \t\n\v\f\r]+/g, " ").replace(/ ?\/?>$/, ">")).sort();
}

const describe = (list: string[]) => (list.length ? list.join(" ") : "no tags");

function digits(str: string): string[] {
  return (str.replace(TAG, "").match(NUMBER) ?? []).map((n) => n.replace(/[,.]/g, "")).sort();
}

// Multiset difference a - b, respecting repeats; `accounts(x, y)` says when
// an element y of b accounts for x.
function subtract(a: string[], b: string[], accounts: (x: string, y: string) => boolean): string[] {
  const rest = [...b];
  return a.filter((x) => {
    const i = rest.findIndex((y) => accounts(x, y));
    if (i === -1) return true;
    rest.splice(i, 1);
    return false;
  });
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const count = (str: string, token: string) => str.split(token).length - 1;
const inspect = (str: string) => JSON.stringify(str);

export class Lint {
  private terms: NonNullable<Glossary["terms"]>;
  private keep: string[];
  private lang: string | undefined;

  constructor(glossary: Glossary = {}, lang?: string) {
    this.terms = glossary.terms ?? {};
    this.keep = glossary.keep ?? [];
    this.lang = lang;
  }

  check(key: string, rawValue: unknown): LintResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const value = rawValue == null ? "" : String(rawValue);
    if (strip(value) === "") return { errors: ["empty"], warnings };

    const keyTags = tags(key);
    const valueTags = tags(value);
    if (!sameList(keyTags, valueTags)) errors.push(`markup differs: key has ${describe(keyTags)}, value has ${describe(valueTags)}`);
    const keyUrls: string[] = [...(key.match(URL) ?? [])].sort();
    const valueUrls: string[] = [...(value.match(URL) ?? [])].sort();
    if (!sameList(keyUrls, valueUrls)) {
      const diff = [...keyUrls.filter((u) => !valueUrls.includes(u)), ...valueUrls.filter((u) => !keyUrls.includes(u))];
      errors.push(`urls or emails differ: ${[...new Set(diff)].join(", ")}`);
    }
    if (isHtml(key) && BARE_AMPERSAND.test(value)) errors.push("bare & in an html fragment (the key uses &amp;)");
    // A number that disappears or changes is an error (a price, a date, a
    // count). One that appears is only a warning: Japanese writes "March" as
    // 3月 and "one" as 1台. A number is still there when a translated number
    // starts with its digits (2.5 million as 250万, 1,000 as 1千).
    const keyNumbers = digits(key);
    const valueNumbers = digits(value);
    const lost = subtract(keyNumbers, valueNumbers, (k, v) => v.startsWith(k));
    const gained = subtract(valueNumbers, keyNumbers, (v, k) => v.startsWith(k));
    if (lost.length) errors.push(`numbers missing from the translation: ${lost.join(", ")}`);
    if (gained.length) warnings.push(`numbers not in the English: ${gained.join(", ")}`);
    for (const token of ["{{", "{%"]) {
      if (count(key, token) !== count(value, token)) errors.push(`${token} count differs`);
    }
    for (const name of this.keep) {
      if (key.includes(name) && !value.includes(name)) errors.push(`${inspect(name)} must stay as it is`);
    }

    // Prose left in English is suspicious; a file extension, an arch tag or a
    // proper noun that reads the same in every language is not.
    const prose = key.replace(TAG, " ");
    if (strip(value) === strip(key) && words(prose).length > 1 && LOWER_WORD.test(prose)) warnings.push("identical to the English");
    if (this.lang) {
      for (const [english, translations] of Object.entries(this.terms)) {
        const expected = [translations[this.lang] ?? []].flat();
        if (!expected.length) continue;
        // Capitalized terms are labels (Download, Pricing) and match as such;
        // lowercase ones match anywhere in the prose, never inside markup.
        const term = new RegExp(`${BOUNDARY}${escapeRegExp(english)}${BOUNDARY}`, /^[A-Z]/.test(english) ? "u" : "iu");
        if (!term.test(prose)) continue;
        if (expected.some((e) => new RegExp(escapeRegExp(e), "iu").test(value))) continue;
        warnings.push(`glossary: ${inspect(english)} is usually ${inspect(expected[0])}`);
      }
    }
    if (length(key) > 20) {
      const ratio = length(value) / length(key);
      // Chinese, Japanese and Korean say the same thing in far fewer characters.
      const shortest = CJK.test(value) ? 0.15 : 0.4;
      if (ratio > 2.5 || ratio < shortest) warnings.push(`length is ${(Math.round(ratio * 10) / 10).toFixed(1)}x the English`);
    }
    return { errors, warnings };
  }
}
