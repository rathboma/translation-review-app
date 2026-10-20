// Writes e2e/fixtures/*.json: what the translation Worker's
// GET /_translations/annotated and /_translations/manifest answer for a small
// site, made by the Worker's own render() and annotate() (the end to end tests
// serve these from a mock Worker, so the pages they show are real output).
//
//   node --experimental-strip-types worker/make-fixtures.ts --worker <web>/workers/translate
//
// (with worker/annotated-endpoint.patch applied there, and `yarn install` run).
// Run it again, and commit the result, when the Worker's output changes shape.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const arg = process.argv.indexOf("--worker");
if (arg === -1) throw new Error("usage: make-fixtures.ts --worker <path to workers/translate>");
const worker = resolve(process.argv[arg + 1]);
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../e2e/fixtures");
const load = (file: string) => import(pathToFileURL(join(worker, "src", file)).href);

const { render } = await load("render.ts");
const { FixtureTranslator } = await load("claude.ts");
const { MemorySegmentStore } = await load("store.ts");
const { Layer } = await load("resolve.ts");
const { annotate } = await load("annotate.ts");

const SITE = "https://www.beekeeperstudio.io";
const DIGEST = "a".repeat(64);

const manifest = {
  site: SITE,
  english: { lang: "en", locale: "en_US", hreflang: ["en"], label: "English" },
  languages: {
    es: { lang: "es-MX", locale: "es_MX", hreflang: ["es", "es-MX"], label: "Español", style: "Mexican Spanish, informal tú." },
    ja: { lang: "ja", locale: "ja_JP", hreflang: ["ja"], label: "日本語" },
  },
  live: true,
  pages: ["/", "/pricing/", "/get"],
  common: {
    es: { header: { Download: "Descargar", Pricing: "Precios", Blog: "Blog" }, footer: { Blog: "Blog" } },
    ja: { header: { Download: "ダウンロード", Pricing: "料金", Blog: "ブログ" } },
  },
  explicit: {
    es: [{ path: "/pricing/**", en: "Opens the download page", translation: "Abre la página de descarga" }],
    ja: [],
  },
  glossary: { keep: ["Beekeeper Studio"], terms: { Download: { es: "Descarga", ja: "ダウンロード" } } },
};

const filler = Array.from({ length: 40 }, (_, i) => i + 1);

function pricing(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Beekeeper Studio Pricing</title>
<meta name="description" content="Pay once, use the paid features forever.">
<meta name="robots" content="noindex">
<link rel="canonical" href="${SITE}/pricing/">
<link rel="stylesheet" href="/assets/css/main-${DIGEST}.css" crossorigin="anonymous" integrity="sha384-abc">
<link rel="preload" href="/assets/fonts/inter.woff2" as="font" crossorigin>
<script>document.documentElement.setAttribute("data-script-ran", "yes")</script>
<script src="/assets/js/main-ABCD1234.js" defer></script>
</head>
<body class="page" data-lang="en" onload="document.body.setAttribute('data-onload-ran', 'yes')">
<noscript><img src="https://tracker.example/pixel.gif" alt="tracker"></noscript>
<header data-i18n-scope="header"><a href="/get">Download</a> <a href="/pricing/">Pricing</a> <a href="/blog/">Blog</a></header>
<main>
<h1>Pricing</h1>
<p>Pay once, use the paid features forever.</p>
<p>Read the <a href="/docs">documentation</a> and <strong>start for free</strong>.</p>
<p>Only $99 a year for one user.</p>
Loose words in the page
<div><p>The Business plan covers your whole team.</p></div>
<img src="/img/logo.png" alt="Beekeeper Studio logo" width="120" height="40">
<button title="Opens the download page" onclick="alert('hi')">Download</button>
<p>Pay once, use the paid features forever.</p>
${filler.map((n) => `<p>Feature ${n}: a handy tool for your database work.</p>`).join("\n")}
<p>Questions? <a href="mailto:hello@beekeeperstudio.io">Write to us</a>.</p>
</main>
<footer data-i18n-scope="footer"><a href="/blog/">Blog</a><p>Made by the Beekeeper Studio team.</p></footer>
</body>
</html>`;
}

function home(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>The SQL Editor You Will Love</title><meta name="description" content="A modern SQL editor."><link rel="stylesheet" href="/assets/css/main-${DIGEST}.css"></head>
<body><header data-i18n-scope="header"><a href="/get">Download</a></header>
<main><h1>The SQL Editor You Will Love</h1><p>Fast, simple and free to start.</p></main>
<footer data-i18n-scope="footer"><a href="/blog/">Blog</a></footer></body></html>`;
}

const es: Record<string, string> = {
  "Beekeeper Studio Pricing": "Precios de Beekeeper Studio",
  "Pay once, use the paid features forever.": "Paga una vez, usa las funciones de pago para siempre.",
  Pricing: "Precios",
  'Read the <a href="/docs">documentation</a> and <strong>start for free</strong>.': 'Lee la <a href="/docs">documentación</a> y <strong>empieza gratis</strong>.',
  "Only $99 a year for one user.": "Solo $99 al año para un usuario.",
  "Loose words in the page": "Palabras sueltas en la página",
  "Beekeeper Studio logo": "Logotipo de Beekeeper Studio",
  'Questions? <a href="mailto:hello@beekeeperstudio.io">Write to us</a>.': '¿Preguntas? <a href="mailto:hello@beekeeperstudio.io">Escríbenos</a>.',
  "Made by the Beekeeper Studio team.": "Hecho por el equipo de Beekeeper Studio.",
  "The SQL Editor You Will Love": "El editor SQL que vas a querer",
  "A modern SQL editor.": "Un editor SQL moderno.",
  "Fast, simple and free to start.": "Rápido, simple y gratis para empezar.",
  // ("The Business plan covers your whole team." is left out: that copy has English in it.)
  ...Object.fromEntries(filler.map((n) => [`Feature ${n}: a handy tool for your database work.`, `Función ${n}: una herramienta útil para tu trabajo con bases de datos.`])),
};

const ja: Record<string, string> = {
  "Beekeeper Studio Pricing": "Beekeeper Studio の料金",
  "Pay once, use the paid features forever.": "一度のお支払いで、有料機能をずっと使えます。",
  Pricing: "料金",
  'Read the <a href="/docs">documentation</a> and <strong>start for free</strong>.': '<a href="/docs">ドキュメント</a>を読んで、<strong>無料で始めましょう</strong>。',
  "Only $99 a year for one user.": "1ユーザーあたり年間 $99 だけ。",
  "Loose words in the page": "ページ内のことば",
  "The Business plan covers your whole team.": "Business プランならチーム全員が使えます。",
  "Beekeeper Studio logo": "Beekeeper Studio のロゴ",
  "Opens the download page": "ダウンロードページを開く",
  'Questions? <a href="mailto:hello@beekeeperstudio.io">Write to us</a>.': 'ご質問は <a href="mailto:hello@beekeeperstudio.io">こちら</a> へ。',
  "Made by the Beekeeper Studio team.": "Beekeeper Studio チームが作っています。",
  ...Object.fromEntries(filler.map((n) => [`Feature ${n}: a handy tool for your database work.`, `機能 ${n}: データベース作業に役立つ道具。`])),
};

async function annotated(html: string, path: string, lang: string, strings: Record<string, string>) {
  const result = await render({ html, path, lang, manifest, store: new MemorySegmentStore(), translator: new FixtureTranslator(strings) });
  const page = annotate(html, result.segments, new Layer(manifest, lang, path));
  return { lang, path, fingerprint: result.fingerprint, ...page };
}

mkdirSync(out, { recursive: true });
const write = (name: string, data: unknown) => writeFileSync(join(out, name), JSON.stringify(data, null, 1) + "\n");
write("manifest.json", manifest);
write("pricing.en.html", pricing());
write("pricing.es.json", await annotated(pricing(), "/pricing/", "es", es));
write("pricing.ja.json", await annotated(pricing(), "/pricing/", "ja", ja));
write("home.es.json", await annotated(home(), "/", "es", es));
console.log(`wrote ${out}`);
