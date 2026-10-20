// The translation Worker's API (workers/translate in beekeeper-studio/web),
// reached with its bearer token, which never leaves the Functions.
import { translationsUrl, type Env } from "./env.ts";
import type { AnnotatedPage, Glossary } from "../shared/types.ts";

export class WorkerError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// What the Functions use of the Worker's manifest.
export interface WorkerManifest {
  site: string;
  languages: Record<string, { lang: string; label: string }>;
  pages: string[];
  glossary: Glossary;
}

const TIMEOUT_MS = 25_000;

async function call(env: Env, path: string, params: Record<string, string> = {}): Promise<Response> {
  const url = new URL(path, translationsUrl(env) + "/");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    return await fetch(url, { headers: { authorization: `Bearer ${env.TRANSLATIONS_TOKEN}`, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new WorkerError(502, `the translation service did not answer (${error instanceof Error ? error.name : "error"})`);
  }
}

async function failure(response: Response): Promise<WorkerError> {
  const body = await response.json<{ error?: string }>().catch(() => ({}) as { error?: string });
  return new WorkerError(response.status, body.error ?? `the translation service answered ${response.status}`);
}

let cached: { url: string; at: number; manifest: WorkerManifest } | null = null;

// The manifest, kept in the isolate for a minute: the page and the manifest
// endpoint need it on every request.
export async function loadManifest(env: Env, now = Date.now()): Promise<WorkerManifest> {
  const url = translationsUrl(env);
  if (cached && cached.url === url && now - cached.at < 60_000) return cached.manifest;
  const response = await call(env, "/_translations/manifest");
  if (!response.ok) throw await failure(response);
  const full = await response.json<WorkerManifest>();
  const manifest: WorkerManifest = {
    site: full.site,
    languages: Object.fromEntries(Object.entries(full.languages).map(([code, l]) => [code, { lang: l.lang, label: l.label }])),
    pages: full.pages,
    glossary: full.glossary ?? {},
  };
  cached = { url, at: now, manifest };
  return manifest;
}

export function forgetManifest(): void {
  cached = null;
}

// A page's two sides and its segments, or null while it has no copy.
export async function loadAnnotated(env: Env, lang: string, path: string): Promise<AnnotatedPage | null> {
  const response = await call(env, "/_translations/annotated", { lang, path });
  if (response.status === 404) return null;
  if (!response.ok) throw await failure(response);
  return response.json<AnnotatedPage>();
}
