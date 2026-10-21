// A fake world for the Functions: an in-memory KV and the three services they
// call (the site whose pages are reviewed, Turnstile, GitHub), recorded.
import { vi } from "vitest";
import type { Env } from "../server/env.ts";

export class MemoryKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) {
    const value = this.data.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }
  async put(key: string, value: string) {
    this.data.set(key, value);
  }
  async delete(key: string) {
    this.data.delete(key);
  }
}

export const SITE = "http://site.test";
export const GITHUB = "http://github.test";
export const TURNSTILE = "http://turnstile.test/verify";

export function env(overrides: Partial<Env> = {}): Env & { REVIEWERS: MemoryKV } {
  return {
    REVIEWERS: new MemoryKV() as unknown as KVNamespace,
    GITHUB_TOKEN: "gh-token",
    TURNSTILE_SECRET: "ts-secret",
    TRANSLATIONS_URL: SITE,
    GITHUB_REPO: "beekeeper-studio/web",
    GITHUB_API_URL: GITHUB,
    TURNSTILE_VERIFY_URL: TURNSTILE,
    APP_URL: "https://translate.beekeeperstudio.io",
    ...overrides,
  } as Env & { REVIEWERS: MemoryKV };
}

// A built page and its Spanish copy, as the site serves them: a heading, a
// paragraph, a paragraph with a link, the footer include, an image with a title,
// and a head.
export const PRICING_EN = `<!DOCTYPE html><html lang="en"><head><title>Pricing plans</title><meta name="description" content="What it costs.">
<script src="/a.js"></script></head><body onload="x()">
<h1>Pricing</h1>
<p>Pay once, use the paid features forever.</p>
<p>Get <a href="/get">Beekeeper Studio</a> now</p>
<p>Pay once, use the paid features forever.</p>
<img src="/i.png" alt="The editor">
<footer data-i18n-scope="footer"><a href="/blog">Blog</a></footer>
</body></html>`;

export const PRICING_ES = `<!DOCTYPE html><html lang="es-MX"><head><title>Planes y precios</title><meta name="description" content="Lo que cuesta.">
<script src="/a.js"></script></head><body onload="x()">
<h1>Precios</h1>
<p>Paga una vez, usa las funciones de pago para siempre.</p>
<p>Obtén <a href="/get">Beekeeper Studio</a> ya</p>
<p>Paga una vez, usa las funciones de pago para siempre.</p>
<img src="/i.png" alt="El editor">
<footer data-i18n-scope="footer"><a href="/blog">Blog</a></footer>
</body></html>`;

type Served = string | { status: number } | { redirectedTo: string; html: string };

export interface World {
  // What a site is asked: every url fetched, and the headers sent with it.
  site: { calls: { url: URL; headers: Headers }[]; pages: Record<string, Served>; down: boolean };
  turnstile: { calls: { secret: string; response: string; remoteip: string | null }[]; pass: boolean };
  github: { calls: { url: string; authorization: string | null; body: { title: string; body: string; labels: string[] } }[]; fail: (call: number) => boolean; nextNumber: number };
}

// Replaces fetch with the fake services. Any host that is not GitHub or Turnstile
// is a site, serving `pages` by path (a path it doesn't have is a 404).
export function world(pages: Record<string, Served> = { "/pricing/": PRICING_EN, "/es/pricing/": PRICING_ES }): World {
  const w: World = {
    site: { calls: [], pages, down: false },
    turnstile: { calls: [], pass: true },
    github: { calls: [], fail: () => false, nextNumber: 100 },
  };
  const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const headers = new Headers(init?.headers);
    if (url.href === TURNSTILE) {
      const form = init?.body as FormData;
      w.turnstile.calls.push({ secret: String(form.get("secret")), response: String(form.get("response")), remoteip: form.get("remoteip") as string | null });
      return Response.json({ success: w.turnstile.pass });
    }
    if (url.origin === GITHUB) {
      const body = JSON.parse(String(init?.body));
      w.github.calls.push({ url: url.pathname, authorization: headers.get("authorization"), body });
      if (w.github.fail(w.github.calls.length)) return Response.json({ message: "Validation Failed" }, { status: 422 });
      const number = w.github.nextNumber++;
      return Response.json({ number, html_url: `https://github.com/beekeeper-studio/web/issues/${number}` }, { status: 201 });
    }
    w.site.calls.push({ url, headers });
    if (w.site.down) throw new TypeError("connection refused");
    const served = w.site.pages[url.pathname + url.search];
    if (served === undefined) return new Response("<html><body>Not found</body></html>", { status: 404, headers: { "content-type": "text/html" } });
    if (typeof served === "string") return html(served);
    if ("status" in served) return new Response("", { status: served.status });
    // A redirect that was followed: the page it led to, at that address.
    const response = html(served.html);
    Object.defineProperty(response, "url", { value: new URL(served.redirectedTo, url).href });
    return response;
  });
  return w;
}

export function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://translate.test/api/submit", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export const submission = (notes: unknown[], overrides: Record<string, unknown> = {}) => ({
  name: "María López",
  email: "maria@example.com",
  turnstileToken: "token-1",
  notes,
  ...overrides,
});
