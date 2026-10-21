// GET /api/config and GET /api/page: what the frontend needs to show a page,
// made safe to display.
import type { Env } from "./env.ts";
import { fail, json } from "./http.ts";
import { sanitizePage } from "./sanitize.ts";
import { loadPage, resolveSite, SiteError } from "./site.ts";
import type { Config } from "../shared/types.ts";

export function configHandler(env: Env): Response {
  const config: Config = { site: resolveSite(env, null)!, turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? "" };
  return json(config, 200, { "cache-control": "private, max-age=60" });
}

export async function pageHandler(request: Request, env: Env): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const lang = params.get("lang") ?? "";
  const path = params.get("path") ?? "";
  const site = resolveSite(env, params.get("site"));
  if (!site) return fail(400, "That is not a web address: it should start with https:// (or http://).", { code: "bad-site" });
  try {
    const page = await loadPage(site, lang, path);
    const base = `${site}/`;
    return json({ lang, path, site, aligned: page.aligned, segments: page.segments, english: sanitizePage(page.english, base), translated: sanitizePage(page.translated, base) });
  } catch (error) {
    if (error instanceof SiteError) return fail(error.status, error.message, error.code ? { code: error.code } : {});
    throw error;
  }
}
