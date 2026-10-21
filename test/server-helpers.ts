// A fake world for the Functions: an in-memory KV and the three services they
// call (the translation Worker, Turnstile, GitHub), recorded.
import { vi } from "vitest";
import type { Env } from "../server/env.ts";
import { forgetManifest } from "../server/worker-api.ts";
import type { AnnotatedPage, Segment } from "../shared/types.ts";

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

export const WORKER = "http://worker.test";
export const GITHUB = "http://github.test";
export const TURNSTILE = "http://turnstile.test/verify";

export function env(overrides: Partial<Env> = {}): Env & { REVIEWERS: MemoryKV } {
  return {
    REVIEWERS: new MemoryKV() as unknown as KVNamespace,
    TRANSLATIONS_TOKEN: "worker-token",
    GITHUB_TOKEN: "gh-token",
    TURNSTILE_SECRET: "ts-secret",
    TRANSLATIONS_URL: WORKER,
    GITHUB_REPO: "beekeeper-studio/web",
    GITHUB_API_URL: GITHUB,
    TURNSTILE_VERIFY_URL: TURNSTILE,
    APP_URL: "https://translate.beekeeperstudio.io",
    ...overrides,
  } as Env & { REVIEWERS: MemoryKV };
}

export const manifest = () => ({
  site: "https://www.beekeeperstudio.io",
  english: { lang: "en", locale: "en_US", hreflang: ["en"], label: "English" },
  languages: {
    es: { lang: "es-MX", locale: "es_MX", hreflang: ["es"], label: "Español" },
    "pt-br": { lang: "pt-BR", locale: "pt_BR", hreflang: ["pt-BR"], label: "Português" },
    ja: { lang: "ja", locale: "ja_JP", hreflang: ["ja"], label: "日本語" },
  },
  live: true,
  pages: ["/", "/pricing/", "/get"],
  common: { es: { footer: { Blog: "Blog" } } },
  explicit: { es: [] },
  glossary: { keep: ["Beekeeper Studio"], terms: { Download: { es: "Descarga" } } },
});

export function segment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: "s1",
    key: "Pay once, use the paid features forever.",
    kind: "html",
    where: 'p, under "Pricing"',
    scope: null,
    source: "generated",
    translation: "Paga una vez, usa las funciones de pago para siempre.",
    ...overrides,
  };
}

export function annotated(lang: string, path: string, segments: Segment[] = [segment()], extra: Partial<AnnotatedPage> = {}): AnnotatedPage {
  return {
    lang,
    path,
    fingerprint: `fp-${lang}-${path.replace(/\W/g, "")}`,
    english: '<!DOCTYPE html><html><head><title>Pricing</title><script src="/a.js"></script></head><body><p data-seg="s1" onclick="x()">Pay once, use the paid features forever.</p></body></html>',
    translated: '<!DOCTYPE html><html><head><title>Precios</title></head><body><p data-seg="s1">Paga una vez, usa las funciones de pago para siempre.</p></body></html>',
    segments,
    ...extra,
  };
}

export interface World {
  worker: { calls: { url: URL; authorization: string | null }[]; pages: Record<string, AnnotatedPage | null>; manifest: ReturnType<typeof manifest>; down: boolean };
  turnstile: { calls: { secret: string; response: string; remoteip: string | null }[]; pass: boolean };
  github: { calls: { url: string; authorization: string | null; body: { title: string; body: string; labels: string[] } }[]; fail: (call: number) => boolean; nextNumber: number };
}

// Replaces fetch with the fake services. Pages not given are "not translated yet".
export function world(pages: Record<string, AnnotatedPage | null> = {}): World {
  forgetManifest();
  const w: World = {
    worker: { calls: [], pages, manifest: manifest(), down: false },
    turnstile: { calls: [], pass: true },
    github: { calls: [], fail: () => false, nextNumber: 100 },
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const headers = new Headers(init?.headers);
    if (url.origin === WORKER) {
      w.worker.calls.push({ url, authorization: headers.get("authorization") });
      if (w.worker.down) throw new TypeError("connection refused");
      if (headers.get("authorization") !== "Bearer worker-token") return Response.json({ error: "unauthorized" }, { status: 401 });
      if (url.pathname === "/_translations/manifest") return Response.json(w.worker.manifest);
      if (url.pathname === "/_translations/annotated") {
        const page = w.worker.pages[`${url.searchParams.get("lang")} ${url.searchParams.get("path")}`];
        return page ? Response.json(page) : Response.json({ error: "not translated yet" }, { status: 404 });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    }
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
    throw new Error(`unexpected fetch ${url}`);
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
