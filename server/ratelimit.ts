// At most 5 submissions per IP per hour: the times of an IP's last
// submissions, in KV under a hash of the address. (Cloudflare's rate limiting
// binding only counts over 10 or 60 seconds.) KV is not atomic, so two
// simultaneous submissions can both slip through: this stops a person, not a
// determined script, which Turnstile is for.
import { sha256 } from "./http.ts";
import type { Env } from "./env.ts";

export const MAX_PER_HOUR = 5;
const WINDOW_MS = 3_600_000;

const key = async (ip: string) => `rate:${(await sha256(ip)).slice(0, 32)}`;

async function recent(env: Env, k: string, now: number): Promise<number[]> {
  const stored = await env.REVIEWERS.get<number[]>(k, "json");
  return (stored ?? []).filter((t) => now - t < WINDOW_MS);
}

// Whether `ip` may submit now, and if not, in how many seconds.
export async function checkRate(env: Env, ip: string, now = Date.now()): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  const times = await recent(env, await key(ip), now);
  if (times.length < MAX_PER_HOUR) return { allowed: true };
  return { allowed: false, retryAfter: Math.max(1, Math.ceil((times[0] + WINDOW_MS - now) / 1000)) };
}

export async function recordSubmission(env: Env, ip: string, now = Date.now()): Promise<void> {
  const k = await key(ip);
  const times = await recent(env, k, now);
  times.push(now);
  await env.REVIEWERS.put(k, JSON.stringify(times), { expirationTtl: 3600 });
}
