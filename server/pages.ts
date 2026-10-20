// GET /api/manifest and GET /api/page: what the frontend needs to pick a page
// and show it, from the Worker, safe to display.
import { translationsUrl, type Env } from "./env.ts";
import { fail, json } from "./http.ts";
import { sanitizePage } from "./sanitize.ts";
import { loadAnnotated, loadManifest, WorkerError } from "./worker-api.ts";
import type { ManifestInfo } from "../shared/types.ts";

function upstream(error: unknown): Response {
  if (error instanceof WorkerError) return fail(502, `Couldn't reach the translations: ${error.message}.`);
  throw error;
}

export async function manifestHandler(env: Env): Promise<Response> {
  try {
    const manifest = await loadManifest(env);
    const info: ManifestInfo = { ...manifest, turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? "" };
    return json(info, 200, { "cache-control": "private, max-age=60" });
  } catch (error) {
    return upstream(error);
  }
}

export async function pageHandler(request: Request, env: Env): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const lang = params.get("lang") ?? "";
  const path = params.get("path") ?? "";
  try {
    const manifest = await loadManifest(env);
    if (!manifest.languages[lang]) return fail(404, `There is no language "${lang}".`, { code: "unknown-language" });
    if (!manifest.pages.includes(path)) return fail(404, `${path} is not one of the translated pages.`, { code: "unknown-page" });
    const page = await loadAnnotated(env, lang, path);
    if (!page) return fail(404, "This page is not translated yet.", { code: "not-translated" });
    const base = `${translationsUrl(env)}/`;
    return json({ ...page, english: sanitizePage(page.english, base), translated: sanitizePage(page.translated, base) });
  } catch (error) {
    return upstream(error);
  }
}
