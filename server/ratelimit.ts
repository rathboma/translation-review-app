// At most 5 submissions per visitor per hour: the times of a visitor's last
// submissions, in KV under a hash of the address. (Cloudflare's rate limiting
// binding only counts over 10 or 60 seconds.)
//
// KV has no atomic update, so deciding and charging are done together under a
// lock held by the isolate, which serializes a burst of requests that one
// isolate serves. Two isolates can still read the same state, so this stops a
// person, not a determined script: that is what Turnstile is for.
//
// A visitor is an IPv4 address, or an IPv6 /64 (the block one connection owns:
// each address in it is free to them).
import { sha256 } from "./http.ts";
import type { Env } from "./env.ts";

export const MAX_PER_HOUR = 5;
const WINDOW_MS = 3_600_000;

// The part of an address that is one visitor's.
export function ipBucket(ip: string): string {
  if (!ip.includes(":")) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  const [head, tail = ""] = ip.split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...front, ...Array<string>(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back] : front;
  return `${groups.slice(0, 4).map((g) => parseInt(g || "0", 16).toString(16)).join(":")}::/64`;
}

const key = async (ip: string) => `rate:${(await sha256(ipBucket(ip))).slice(0, 32)}`;

async function recent(env: Env, k: string, now: number): Promise<number[]> {
  const stored = await env.REVIEWERS.get<number[]>(k, "json");
  return (Array.isArray(stored) ? stored : []).filter((t) => typeof t === "number" && now - t < WINDOW_MS);
}

const locks = new Map<string, Promise<unknown>>();

// Runs `work` after every earlier call with the same name has finished.
function locked<T>(name: string, work: () => Promise<T>): Promise<T> {
  const run = (locks.get(name) ?? Promise.resolve()).then(work, work);
  const tail = run.catch(() => {});
  locks.set(name, tail);
  void tail.then(() => locks.get(name) === tail && locks.delete(name));
  return run;
}

const retryAfter = (times: number[], now: number) => Math.max(1, Math.ceil((times[0] + WINDOW_MS - now) / 1000));

// Whether `ip` may submit now, and if not, in how many seconds: asked before the
// human check, so a visitor who is over the limit doesn't spend one.
export async function checkRate(env: Env, ip: string, now = Date.now()): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  const times = await recent(env, await key(ip), now);
  return times.length < MAX_PER_HOUR ? { allowed: true } : { allowed: false, retryAfter: retryAfter(times, now) };
}

// Takes one of the visitor's submissions (checking again, and charging, in one step).
export async function reserveSubmission(env: Env, ip: string, now = Date.now()): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  const k = await key(ip);
  return locked(k, async () => {
    const times = await recent(env, k, now);
    if (times.length >= MAX_PER_HOUR) return { allowed: false as const, retryAfter: retryAfter(times, now) };
    await env.REVIEWERS.put(k, JSON.stringify([...times, now]), { expirationTtl: 3600 });
    return { allowed: true as const };
  });
}

// Gives it back: nothing was filed (the notes were refused, or GitHub was down),
// and the visitor will try again.
export async function refundSubmission(env: Env, ip: string, at: number, now = at): Promise<void> {
  const k = await key(ip);
  await locked(k, async () => {
    const times = await recent(env, k, now);
    const i = times.indexOf(at);
    if (i === -1) return;
    times.splice(i, 1);
    if (times.length) await env.REVIEWERS.put(k, JSON.stringify(times), { expirationTtl: 3600 });
    else await env.REVIEWERS.delete(k);
  });
}
