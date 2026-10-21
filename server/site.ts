// The pages under review: an English page of a site and its copy under the
// language's prefix (/pricing/ and /es/pricing/), fetched from the site itself.
// Nothing about them is secret, and nothing is sent along with the request.
import { annotate, NotAPage, type Annotated } from "./annotate.ts";
import { translationsUrl, type Env } from "./env.ts";
import { readText } from "./http.ts";
import { LANGUAGES } from "../shared/types.ts";

const MAX_PAGE = 8_000_000;
const TIMEOUT_MS = 20_000;

export class SiteError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// The origin to read pages from: the one asked for (a link's ?site=, or what the
// translator typed), else the default. Null if what was asked for is not a web address.
export function resolveSite(env: Env, requested: string | null | undefined): string | null {
  const text = (requested ?? "").trim();
  if (!text) return translationsUrl(env);
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

async function fetchPage(url: string, what: string): Promise<{ html: string; finalUrl: string }> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new SiteError(502, `Couldn't reach ${url} (${error instanceof Error ? error.name : "error"}).`);
  }
  if (!response.ok) throw new SiteError(response.status === 404 ? 404 : 502, `The ${what} page, ${url}, answered ${response.status}.`, response.status === 404 ? "not-found" : undefined);
  if (!/html/i.test(response.headers.get("content-type") ?? "")) throw new SiteError(502, `${url} is not a web page.`);
  const html = await readText(response, MAX_PAGE);
  if (html === null) throw new SiteError(502, `The ${what} page, ${url}, is too large.`);
  return { html, finalUrl: response.url || url };
}

// The page in a language, both sides marked up (see annotate.ts), not yet made safe to show.
export async function loadPage(site: string, lang: string, path: string): Promise<Annotated> {
  if (!Object.hasOwn(LANGUAGES, lang)) throw new SiteError(404, `There is no language "${lang}".`, "unknown-language");
  if (!path.startsWith("/") || /[\u0000- \u007f#]/.test(path)) throw new SiteError(400, "That is not a page address: it should start with / (like /pricing/).", "bad-path");
  const english = `${site}${path}`;
  const translated = `${site}/${lang}${path}`;
  const [en, tr] = await Promise.all([fetchPage(english, "English"), fetchPage(translated, LANGUAGES[lang].label)]);
  // A site with no copy of the page answers with the English one.
  if (!new URL(tr.finalUrl).pathname.startsWith(`/${lang}/`) && new URL(tr.finalUrl).pathname !== `/${lang}`) {
    throw new SiteError(404, `There is no ${LANGUAGES[lang].label} copy of ${path} (${translated} leads to ${tr.finalUrl}).`, "not-translated");
  }
  try {
    return annotate(en.html, tr.html);
  } catch (error) {
    if (error instanceof NotAPage) throw new SiteError(502, `That is not a page: ${error.message}.`);
    throw error;
  }
}
