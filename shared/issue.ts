// The GitHub issue a submission becomes: a short human summary, one section
// per note, and one machine-readable YAML block with everything an agent needs
// to apply the notes without searching (which file, which entry).
//
// The repository is public and the issue is written from text a stranger
// typed, so the translator's words only ever appear inside code spans: no
// @mentions, no #123 links, no markdown or html of theirs is rendered. The
// translator's email never gets here.
import { knownScope } from "./apply.ts";
import type { Report } from "./types.ts";

// GitHub rejects an issue body over 65,536 characters; stay well under.
export const BODY_LIMIT = 60_000;

export interface IssueInput {
  lang: string;
  // The language's name for people: Español.
  label: string;
  name: string;
  submitted: Date;
  reports: Report[];
  // Where the notes came from.
  appUrl: string;
  // The site whose pages they are about.
  site: string;
  part?: { n: number; of: number };
}

export interface Issue {
  title: string;
  body: string;
  labels: string[];
  reports: Report[];
}

// ---- text -----------------------------------------------------------------

const oneLine = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/ {2,}/g, " ").trim();

// Inline code that can hold anything: a backtick run longer than any inside.
export function code(text: string): string {
  const flat = oneLine(text);
  const longest = Math.max(0, ...(flat.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = flat.startsWith("`") || flat.endsWith("`") || (flat.startsWith(" ") && flat.endsWith(" ")) ? " " : "";
  return `${fence}${pad}${flat}${pad}${fence}`;
}

// A fenced block that cannot be closed by its own content.
function fenced(info: string, text: string): string {
  const longest = Math.max(2, ...(text.match(/`{3,}/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${info}\n${text}\n${fence}`;
}

// Where a shared include is, for people. An unknown scope is text from whoever
// sent the note (a note whose English has gone is filed as the browser sent it),
// so it goes in a code span.
const scopeText = (scope: string): string => knownScope(scope) ?? `the shared ${code(scope)} include`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---- YAML -----------------------------------------------------------------

// A double-quoted YAML scalar. JSON strings are valid ones; the characters
// YAML 1.1 parsers treat as line breaks or reject are escaped too.
export function quote(text: string): string {
  return JSON.stringify(text).replace(/[\u007f-\u009f\u2028\u2029\ufeff\ufffe\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

const RESERVED = /^(?:true|false|null|yes|no|on|off|y|n)$/i;

// Plain when it is safe as one (a path, a language code, a scope), else quoted.
export function scalar(text: string): string {
  return /^[A-Za-z/][A-Za-z0-9_/.-]*$/.test(text) && !RESERVED.test(text) ? text : quote(text);
}

function entry(report: Report, indent: string): string[] {
  const { note } = report;
  const lines = [
    `path: ${scalar(note.path)}`,
    `key: ${quote(note.key)}`,
    `scope: ${note.scope === null ? "null" : scalar(note.scope)}`,
    `where: ${quote(note.where)}`,
    `current: ${quote(note.current)}`,
    `new: ${quote(note.new)}`,
  ];
  if (note.comment) lines.push(`comment: ${quote(note.comment)}`);
  if (report.warnings.length) lines.push("warnings:", ...report.warnings.map((w) => `  - ${quote(w)}`));
  const a = report.apply;
  lines.push("apply:", `  action: ${a.action}`, `  file: ${a.file}`);
  if (a.action === "set-common") {
    lines.push(`  set: [${scalar(a.set[0])}, ${quote(a.set[1])}, ${quote(a.set[2])}]`);
  } else {
    lines.push(`  entry: { ${Object.entries(a.entry).map(([k, v]) => `${scalar(k)}: ${k === "path" ? scalar(v) : quote(v)}`).join(", ")} }`);
  }
  return lines.map((line, i) => `${indent}${i === 0 ? "- " : "  "}${line}`);
}

function machineBlock(input: IssueInput): string {
  const lines = [`lang: ${scalar(input.lang)}`, `site: ${quote(input.site)}`, `submitted: ${input.submitted.toISOString().replace(/\.\d+Z$/, "Z")}`];
  if (input.part) lines.push(`part: ${input.part.n}`, `parts: ${input.part.of}`);
  lines.push("notes:", ...input.reports.flatMap((r) => entry(r, "  ")));
  return fenced("yaml", lines.join("\n"));
}

// ---- the issue ------------------------------------------------------------

function section(report: Report, index: number): string {
  const { note } = report;
  const where = note.scope
    ? `${code(note.scope)} (every page) · ${code(note.path)}`
    : `${code(note.path)} · ${code(note.where)}`;
  const lines = [
    `### ${index + 1}. ${where}`,
    `English: ${code(note.key)}`,
    `Now: ${code(note.current)}`,
    `New: ${code(note.new)}`,
  ];
  if (note.comment) lines.push(`Comment: ${code(note.comment)}`);
  if (report.warnings.length) lines.push(`Lint warnings: ${report.warnings.map(code).join(" · ")}`);
  if (note.scope) lines.push(`This text is in ${scopeText(note.scope)}: the change applies on every page.`);
  // Two trailing spaces: a markdown line break, so the fields stay one per line.
  return lines.map((l, i) => (i === 0 || i === lines.length - 1 ? l : `${l}  `)).join("\n");
}

const FOOTER = `---
**Applying these notes** (for the agent or person picking this up)

1. Read the YAML block above. For each note, apply its \`apply\` to the named file in this repository:
   - \`set-common\`: set \`common[<scope>][<key>]\` in the JSON file. It changes that string on every page with the include. Keep the file sorted by scope.
   - \`set-explicit\`: in the YAML file, set the language's value of the entry whose \`path\` and \`en\` match, or append the entry if there is none, as \`node bin/translations.mjs pin\` does.

   The notes were written against the live site, which doesn't say where a translation comes from: if something more specific overrides the change (an explicit entry for the page, say, over a common one), change that instead.

   Keep \`explicit/<lang>.yml\` in its existing format (\`yaml.dump\` with \`forceQuotes\`, as \`pin\` does).
2. A note whose English (\`key\`) is no longer on the page is out of date: skip it, and say so on this issue.
3. Run \`node bin/translations.mjs lint\`: it must pass.
4. Commit and open a pull request that closes this issue. The next deploy renders the affected pages again.`;

// A name for a title, which is not code: cut by characters (not halves of an
// emoji), and without what would link or mention.
function titleName(name: string): string {
  return Array.from(name.replace(/[#@`\[\]<>]/g, "")).slice(0, 60).join("").trim() || "a reviewer";
}

export function renderIssue(input: IssueInput): Issue {
  const { lang, label, reports } = input;
  const pages = new Set(reports.map((r) => r.note.path)).size;
  const name = oneLine(input.name);
  const part = input.part ? `, part ${input.part.n} of ${input.part.of}` : "";
  const summary = [
    `Translation notes from ${code(name)} for **${lang}** (${label}), ${plural(reports.length, "note")} on ${plural(pages, "page")}${part}.`,
    `Submitted with ${input.appUrl.replace(/^https?:\/\//, "")}, from the pages on ${code(input.site)}.`,
  ].join("\n");
  const body = [
    summary,
    reports.map(section).join("\n\n"),
    `<details><summary>Machine-readable notes</summary>\n\n${machineBlock(input)}\n\n</details>`,
    FOOTER,
  ].join("\n\n");
  const suffix = input.part ? ` (part ${input.part.n} of ${input.part.of})` : "";
  return {
    title: `Translation notes (${lang}): ${plural(reports.length, "note")} from ${titleName(name)}${suffix}`,
    body,
    labels: ["translation", `lang:${lang}`],
    reports,
  };
}

export class NoteTooLarge extends Error {
  readonly id: string;
  constructor(id: string) {
    super("this note is too long to file");
    this.id = id;
  }
}

// One issue for the notes, or several when the body would pass GitHub's limit:
// notes fill each in order.
export function splitIssues(input: Omit<IssueInput, "part">, limit = BODY_LIMIT): Issue[] {
  const whole = renderIssue(input);
  if (whole.body.length <= limit) return [whole];
  const groups: Report[][] = [];
  let group: Report[] = [];
  for (const report of input.reports) {
    const next = [...group, report];
    if (renderIssue({ ...input, reports: next, part: { n: 1, of: 99 } }).body.length <= limit) {
      group = next;
    } else if (group.length) {
      groups.push(group);
      group = [report];
    } else {
      throw new NoteTooLarge(report.note.id);
    }
    if (group.length === 1 && renderIssue({ ...input, reports: group, part: { n: 1, of: 99 } }).body.length > limit) throw new NoteTooLarge(report.note.id);
  }
  if (group.length) groups.push(group);
  return groups.map((reports, i) => renderIssue({ ...input, reports, part: { n: i + 1, of: groups.length } }));
}
