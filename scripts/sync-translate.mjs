#!/usr/bin/env node
// The app splits a page into segments and lints every new translation with the
// translation Worker's own code, so those files (segments.ts and what it
// imports, and lint.ts) are vendored byte for byte into vendor/translate/. This
// repo is not a part of beekeeper-studio/web, so it cannot import them from there.
//
//   node scripts/sync-translate.mjs [--from <web checkout>] [--ref <git ref>]
//       copies the files and records where they came from in SOURCE.json
//       (--from reads a local checkout, else they are fetched from GitHub at
//       --ref, default master)
//   node scripts/sync-translate.mjs --check
//       fails if a vendored file no longer matches SOURCE.json (someone
//       edited it by hand); offline
//   node scripts/sync-translate.mjs --check --upstream [--ref <git ref>]
//       also fails when upstream's files differ (the Worker's code changed:
//       sync again)
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, "vendor/translate");
const sourceFile = join(vendor, "SOURCE.json");
const REPO = "beekeeper-studio/web";
const FILES = ["assets.ts", "dom.ts", "head.ts", "lint.ts", "page.ts", "segments.ts", "text.ts", "translator.ts"];
const UPSTREAM_DIR = "workers/translate/src";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const sha = (text) => createHash("sha256").update(text).digest("hex");

async function upstream(name, ref) {
  const from = option("from");
  if (from) return readFileSync(join(resolve(from), UPSTREAM_DIR, name), "utf8");
  const url = `https://raw.githubusercontent.com/${REPO}/${ref}/${UPSTREAM_DIR}/${name}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.text();
}

function readSource() {
  return JSON.parse(readFileSync(sourceFile, "utf8"));
}

async function check() {
  const source = readSource();
  let bad = 0;
  for (const name of FILES) {
    const local = readFileSync(join(vendor, name), "utf8");
    if (sha(local) !== source.files[name]) {
      console.error(`vendor/translate/${name} was edited by hand (it no longer matches SOURCE.json): run \`yarn sync:translate\` instead`);
      bad++;
    }
  }
  if (flag("upstream")) {
    const ref = option("ref") ?? "master";
    for (const name of FILES) {
      const theirs = await upstream(name, ref);
      if (sha(theirs) !== source.files[name]) {
        console.error(`${REPO}@${ref} has a different workers/translate/src/${name} than vendor/translate/${name} (synced from ${source.commit?.slice(0, 8) ?? source.ref}): run \`yarn sync:translate\``);
        bad++;
      }
    }
  }
  if (!bad) console.log("vendored translation code is in sync");
  process.exit(bad ? 1 : 0);
}

async function sync() {
  const ref = option("ref") ?? "master";
  const from = option("from");
  mkdirSync(vendor, { recursive: true });
  const files = {};
  for (const name of FILES) {
    const text = await upstream(name, ref);
    writeFileSync(join(vendor, name), text);
    files[name] = sha(text);
  }
  let commit;
  if (from) {
    commit = execFileSync("git", ["-C", resolve(from), "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } else {
    const response = await fetch(`https://api.github.com/repos/${REPO}/commits/${ref}`, { headers: { accept: "application/vnd.github+json" } });
    if (response.ok) commit = (await response.json()).sha;
  }
  const source = { repo: REPO, path: UPSTREAM_DIR, ref: from ? "local checkout" : ref, commit, files };
  writeFileSync(sourceFile, JSON.stringify(source, null, 2) + "\n");
  console.log(`vendored ${FILES.join(", ")} from ${REPO}${commit ? ` @ ${commit.slice(0, 8)}` : ""}`);
}

await (flag("check") ? check() : sync());
