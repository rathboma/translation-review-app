#!/usr/bin/env node
// `yarn dev`: builds the frontend into dist/ again on every change (Vite's watch
// mode) and serves dist/ with the Pages Functions on http://127.0.0.1:8788 (wrangler
// pages dev), with a local KV. Reload the page by hand after a change. Secrets come
// from .dev.vars (see .dev.vars.example).
import { spawn, spawnSync } from "node:child_process";

const port = process.env.PORT ?? "8788";
const first = spawnSync("vite", ["build"], { stdio: "inherit" });
if (first.status !== 0) process.exit(first.status ?? 1);

const children = [
  spawn("vite", ["build", "--watch"], { stdio: "inherit" }),
  spawn("wrangler", ["pages", "dev", "dist", "--port", port, "--ip", "127.0.0.1", "--kv", "REVIEWERS"], { stdio: "inherit" }),
];
const stop = () => children.forEach((child) => child.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// If either ends, so does the other.
for (const child of children) child.on("exit", (code) => {
  stop();
  process.exit(code ?? 0);
});
