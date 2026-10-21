// The Pages project's bindings, secrets and variables (see wrangler.toml).
export interface Env {
  // Name, email and issue numbers of whoever filed an issue; the per-IP
  // submission log.
  REVIEWERS: KVNamespace;
  // Secrets.
  TRANSLATIONS_TOKEN: string;
  GITHUB_TOKEN: string;
  TURNSTILE_SECRET: string;
  // Variables.
  TRANSLATIONS_URL?: string;
  GITHUB_REPO?: string;
  TURNSTILE_SITE_KEY?: string;
  // Where notes came from, in the issue (default: the request's own origin).
  APP_URL?: string;
  // For tests and local runs: the services the Functions talk to.
  GITHUB_API_URL?: string;
  TURNSTILE_VERIFY_URL?: string;
}

export const DEFAULT_TRANSLATIONS_URL = "https://www.beekeeperstudio.io";
export const DEFAULT_GITHUB_REPO = "beekeeper-studio/web";
export const DEFAULT_GITHUB_API = "https://api.github.com";
export const DEFAULT_TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const translationsUrl = (env: Env) => (env.TRANSLATIONS_URL || DEFAULT_TRANSLATIONS_URL).replace(/\/+$/, "");
