// String helpers that behave like the Ruby ones the original library used, so
// keys and lint results match it exactly: Ruby's \s, String#strip and #split
// only know ASCII whitespace (a non-breaking space is text), while its \b is
// Unicode-aware (é and カ are word characters).

const SPACE = "[ \\t\\n\\v\\f\\r]";
const SPACES = new RegExp(`${SPACE}+`, "g");

// Collapses whitespace runs to one space and trims: the form every segment is
// keyed by.
export function normalize(str: string): string {
  return strip(str.replace(SPACES, " "));
}

export function strip(str: string): string {
  return str.replace(/^[\0 \t\n\v\f\r]+|[\0 \t\n\v\f\r]+$/g, "");
}

export function words(str: string): string[] {
  return str.split(SPACES).filter(Boolean);
}

// Text worth translating has a letter in it ("$", "x86_64" alone don't count,
// "x86_64 build" does).
export function translatable(str: string): boolean {
  return /\p{L}/u.test(str);
}

// Length in characters (code points), as Ruby counts it.
export function length(str: string): number {
  return Array.from(str).length;
}

export function truncate(str: string, max: number, keep: number): string {
  const chars = Array.from(str);
  return chars.length > max ? `${chars.slice(0, keep).join("")}...` : str;
}

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Ruby's \b as a regexp source fragment (use with the u flag).
const WORD = "[\\p{L}\\p{M}\\p{Nd}\\p{Pc}]";
export const BOUNDARY = `(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`;

export const CJK = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;

export async function sha256(str: string): Promise<string> {
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
