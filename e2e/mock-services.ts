// The services the app's Functions call, mocked for the end to end tests:
//
//   the site                 /pricing/, /es/pricing/, /ja/pricing/, /, /es/ ... (the pages in
//                            e2e/fixtures, made by the translation Worker's own code), and
//                            its assets (the pages' stylesheet and image)
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
const PORT = Number(process.env.MOCK_PORT ?? 8799);

// What the site serves: a page, or a redirect (a site with no copy of a page
// answers with its English one).
type Route = { file: string } | { redirect: string };
const originals: Record<string, Route> = {
  "/": { file: "home.en.html" },
  "/es/": { file: "home.es.html" },
  "/pricing/": { file: "pricing.en.html" },
  "/es/pricing/": { file: "pricing.es.html" },
  "/ja/pricing/": { file: "pricing.ja.html" },
  // A page with no copy.
  "/get": { file: "home.en.html" },
  "/es/get": { redirect: "/get" },
};

let routes: Record<string, Route> = structuredClone(originals);
let calls: { site: { path: string; headers: Record<string, string | string[] | undefined> }[]; github: any[]; turnstile: any[] } = { site: [], github: [], turnstile: [] };
let githubFail: number[] = [];
let nextIssue = 4242;

function reset(): void {
  routes = structuredClone(originals);
  calls = { site: [], github: [], turnstile: [] };
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
      // Fail the Nth GitHub request from now (1 is the next).
      if (body.failGithub) githubFail = body.failGithub.map((n: number) => calls.github.length + n);
      // A page the site stops serving.
      if (body.drop) delete routes[body.drop];
      // A page the site serves another file for: { "/pricing/": "home.en.html" }.
      for (const [path, file] of Object.entries<string>(body.serve ?? {})) routes[path] = { file };
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
    const route = routes[path];
    if (route) {
      calls.site.push({ path: path + url.search, headers: req.headers });
      if ("redirect" in route) {
        res.writeHead(302, { location: route.redirect });
        return res.end();
      }
      return text(res, 200, fixture(route.file), "text/html");
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
