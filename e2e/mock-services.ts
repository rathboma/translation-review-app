// The services the app's Functions call, mocked for the end to end tests:
//
//   the translation Worker   /_translations/manifest and /_translations/annotated
//                            (answers from e2e/fixtures, made by the Worker's own code),
//                            and the site's assets (the pages' stylesheet and image)
//   GitHub                   POST /github/repos/<owner>/<repo>/issues
//   Cloudflare Turnstile     POST /turnstile/verify
//
// plus /__calls, /__control and /__health for the tests. Run by Playwright
// (playwright.config.ts); the Functions run on `wrangler pages dev`.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, "fixtures", name), "utf8");
const TOKEN = "e2e-token";
const PORT = Number(process.env.MOCK_PORT ?? 8799);

const manifest = JSON.parse(fixture("manifest.json"));
const originals: Record<string, any> = {
  "es /pricing/": JSON.parse(fixture("pricing.es.json")),
  "ja /pricing/": JSON.parse(fixture("pricing.ja.json")),
  "es /": JSON.parse(fixture("home.es.json")),
};

let pages: Record<string, any> = structuredClone(originals);
let calls: { worker: any[]; github: any[]; turnstile: any[] } = { worker: [], github: [], turnstile: [] };
let githubFail: number[] = [];
let nextIssue = 4242;

function reset(): void {
  pages = structuredClone(originals);
  calls = { worker: [], github: [], turnstile: [] };
  githubFail = [];
  nextIssue = 4242;
}

const text = (res: ServerResponse, status: number, body: string, type = "text/plain") => {
  res.writeHead(status, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" });
  res.end(body);
};
const json = (res: ServerResponse, status: number, body: unknown) => text(res, status, JSON.stringify(body), "application/json");

async function read(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  try {
    if (path === "/__health") return text(res, 200, "ok");
    if (path === "/__calls") return json(res, 200, calls);
    if (path === "/__control" && req.method === "POST") {
      const body = JSON.parse(await read(req));
      if (body.reset) reset();
      // The English changed since the copy was made: this segment is gone.
      if (body.removeSegment) {
        const page = pages[body.removeSegment.page];
        page.segments = page.segments.filter((s: any) => s.key !== body.removeSegment.key);
      }
      // Fail the Nth GitHub request from now (1 is the next).
      if (body.failGithub) githubFail = body.failGithub.map((n: number) => calls.github.length + n);
      if (body.dropPage) delete pages[body.dropPage];
      return json(res, 200, { ok: true });
    }

    // The site's assets, which the pages load through their <base>.
    if (/^\/assets\/css\/main-[0-9a-f]{64}\.css$/.test(path)) {
      return text(res, 200, "body{font-family:Georgia,serif;margin:0 1rem}h1{color:rgb(1,2,3)}p{max-width:42rem;margin:0 0 1rem}a{color:#06c}header,footer{background:#eee;padding:.5rem}img{display:block}", "text/css");
    }
    if (path === "/img/logo.png") {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(PNG);
    }
    if (path === "/__english/pricing") return text(res, 200, fixture("pricing.en.html"), "text/html");

    if (path.startsWith("/_translations/")) {
      calls.worker.push({ path: path + url.search, authorization: req.headers.authorization ?? null });
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 401, { error: "unauthorized" });
      if (path === "/_translations/manifest") return json(res, 200, manifest);
      if (path === "/_translations/annotated") {
        const lang = url.searchParams.get("lang") ?? "";
        const p = url.searchParams.get("path") ?? "";
        if (!manifest.languages[lang]) return json(res, 404, { error: `${lang} is not a translated language` });
        if (!manifest.pages.includes(p)) return json(res, 404, { error: `${p} is not a translated page` });
        const page = pages[`${lang} ${p}`];
        return page ? json(res, 200, page) : json(res, 404, { error: `${p} is not translated yet in ${lang}` });
      }
      return json(res, 404, { error: "not found" });
    }

    if (path === "/turnstile/verify" && req.method === "POST") {
      const form = new URLSearchParams(await read(req));
      // wrangler's FormData arrives as multipart: read it loosely.
      const raw = form.toString();
      calls.turnstile.push({ raw });
      return json(res, 200, { success: raw.includes("mock-token") });
    }

    const issues = /^\/github\/repos\/([^/]+)\/([^/]+)\/issues$/.exec(path);
    if (issues && req.method === "POST") {
      const body = JSON.parse(await read(req));
      calls.github.push({ repo: `${issues[1]}/${issues[2]}`, authorization: req.headers.authorization ?? null, body });
      if (githubFail.includes(calls.github.length)) return json(res, 422, { message: "Validation Failed" });
      const number = nextIssue++;
      return json(res, 201, { number, html_url: `https://github.com/${issues[1]}/${issues[2]}/issues/${number}` });
    }

    return text(res, 404, `mock: nothing at ${req.method} ${path}`);
  } catch (error) {
    return text(res, 500, `mock failed: ${error instanceof Error ? error.stack : error}`);
  }
}).listen(PORT, "127.0.0.1", () => console.log(`mock services on :${PORT}`));
